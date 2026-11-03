import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { runAgent, toolSpecs, chooseAgentModel, type AgentMessage } from "../src/tools/ollama-agent.js";

const echo = {
  name: "echo",
  description: "echo text",
  inputSchema: { text: z.string() },
  handler: async ({ text }: any) => ({ content: [{ type: "text" as const, text: `got ${text}` }] }),
};

test("toolSpecs produces JSON-schema function specs", () => {
  const [s]: any = toolSpecs([echo]);
  assert.equal(s.function.name, "echo");
  assert.equal(s.function.parameters.properties.text.type, "string");
});

test("runAgent executes structured tool calls and returns the final answer", async () => {
  let turn = 0;
  const seen: AgentMessage[][] = [];
  const chat = async (m: AgentMessage[]): Promise<AgentMessage> => {
    seen.push(m.map((x) => ({ ...x })));
    return turn++ === 0
      ? { role: "assistant", content: "", tool_calls: [{ function: { name: "echo", arguments: { text: "hi" } } }] }
      : { role: "assistant", content: "done" };
  };
  const out = await runAgent({ task: "say hi", chat, tools: [echo] });
  assert.equal(out.answer, "done");
  assert.equal(out.finished, true);
  assert.deepEqual(out.steps.map((s) => [s.tool, s.ok, s.result]), [["echo", true, "got hi"]]);
  assert.equal(seen[1].at(-1)?.role, "tool");
});

test("runAgent does not turn prose into tool calls and rejects bad/unknown calls", async () => {
  let turn = 0;
  const chat = async (): Promise<AgentMessage> =>
    turn++ === 0
      ? { role: "assistant", content: "", tool_calls: [{ function: { name: "nope", arguments: {} } }, { function: { name: "echo", arguments: { text: 5 } } }] }
      : { role: "assistant", content: 'I will call echo({"text":"x"})' };
  const out = await runAgent({ task: "t", chat, tools: [echo] });
  assert.equal(out.steps.length, 2);
  assert.ok(out.steps.every((s) => !s.ok));
  assert.match(out.answer, /I will call echo/);
});

test("runAgent stops at the step limit", async () => {
  const chat = async (): Promise<AgentMessage> => ({ role: "assistant", content: "", tool_calls: [{ function: { name: "echo", arguments: { text: "a" } } }] });
  const out = await runAgent({ task: "t", chat, tools: [echo], maxSteps: 2 });
  assert.equal(out.finished, false);
  assert.equal(out.steps.length, 2);
});

test("chooseAgentModel prefers env, then cedar-tree profiles, then largest <=12GB", () => {
  const G = 1024 ** 3;
  const ms = [{ name: "a:big", size: 30 * G }, { name: "b:mid", size: 6 * G }, { name: "cedar-tree-x:32k", size: 2 * G }];
  assert.equal(chooseAgentModel(ms, "b:mid")?.name, "b:mid");
  assert.equal(chooseAgentModel(ms, undefined)?.name, "cedar-tree-x:32k");
  assert.equal(chooseAgentModel(ms.slice(0, 2), undefined)?.name, "b:mid");
});
