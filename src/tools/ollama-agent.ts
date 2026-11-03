/**
 * ollama_agent - an offline, in-process tool-calling loop.
 *
 * Takes a plain-text task, lets a local Ollama model that natively supports tool calling
 * use Cedar Tree's own tools (via Ollama's /api/chat `tools`), and returns the final answer.
 * Only structured tool_calls emitted by the model are executed; prose is never parsed into calls.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolRegistry, ToolDefinition } from "../registry.js";
import { AGENT_TOOLS, jsonResult, textResult } from "../registry.js";
import { api, listModels, resolveName, isCloud, gb, type OllamaModel } from "./ollama.js";

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
  tool_name?: string;
}

export type ChatFn = (messages: AgentMessage[], tools: unknown[]) => Promise<AgentMessage>;

export interface AgentStep { tool: string; args: unknown; ok: boolean; result: string }

const MAX_TOOL_OUTPUT = 6000;

const SYSTEM_PROMPT =
  "You are Cedar Tree, a coding assistant with tools. Do what the user asks by calling the provided tools. " +
  "Call a tool when you need files, search, shell or git; do not claim to have done something you did not do with a tool. " +
  "When finished, reply with a short summary of what you did.";

export function decodeJsonStrings(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && /^\s*(\[|\{|-?\d|true$|false$)/.test(v)) {
      try { out[k] = JSON.parse(v); continue; } catch { /* keep original string */ }
    }
    out[k] = v;
  }
  return out;
}

export function toolSpecs(defs: ToolDefinition[]): unknown[] {
  return defs.map((d) => {
    const schema = zodToJsonSchema(z.object(d.inputSchema), { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>;
    delete schema["$schema"];
    return { type: "function", function: { name: d.name, description: d.description.slice(0, 400), parameters: schema } };
  });
}

export async function runAgent(opts: {
  task: string;
  chat: ChatFn;
  tools: ToolDefinition[];
  maxSteps?: number;
  system?: string;
}): Promise<{ answer: string; steps: AgentStep[]; finished: boolean }> {
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const specs = toolSpecs(opts.tools);
  const messages: AgentMessage[] = [
    { role: "system", content: opts.system ?? SYSTEM_PROMPT },
    { role: "user", content: opts.task },
  ];
  const steps: AgentStep[] = [];
  const max = opts.maxSteps ?? 8;

  for (let i = 0; i < max; i++) {
    const reply = await opts.chat(messages, specs);
    messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: reply.tool_calls });
    const calls = reply.tool_calls ?? [];
    if (!calls.length) return { answer: (reply.content ?? "").trim(), steps, finished: true };

    for (const call of calls) {
      const name = call.function.name;
      let args = call.function.arguments;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { /* reported below by validation */ }
      }
      let ok = false;
      let text: string;
      const def = byName.get(name);
      if (!def) {
        text = `Unknown tool "${name}". Available: ${[...byName.keys()].join(", ")}`;
      } else {
        const schema = z.object(def.inputSchema);
        let parsed = schema.safeParse(args ?? {});
        if (!parsed.success && args && typeof args === "object") {
          // Small models often send arrays/numbers/booleans as JSON-encoded strings; retry once with those decoded.
          const decoded = decodeJsonStrings(args as Record<string, unknown>);
          const retry = schema.safeParse(decoded);
          if (retry.success) parsed = retry;
        }
        if (!parsed.success) {
          text = `Invalid arguments for ${name}: ${parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
        } else {
          try {
            const res = await def.handler(parsed.data);
            ok = !res.isError;
            text = res.content.map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
          } catch (e) {
            text = `Tool ${name} threw: ${(e as Error).message}`;
          }
        }
      }
      if (text.length > MAX_TOOL_OUTPUT) text = text.slice(0, MAX_TOOL_OUTPUT) + "\n...[truncated]";
      steps.push({ tool: name, args, ok, result: text.slice(0, 500) });
      messages.push({ role: "tool", tool_name: name, content: text });
    }
  }
  return { answer: "Stopped: step limit reached before the model finished.", steps, finished: false };
}

async function supportsTools(name: string): Promise<boolean> {
  try {
    const info = await api("/api/show", { model: name }, 8000);
    return Array.isArray(info.capabilities) && info.capabilities.includes("tools");
  } catch {
    return false;
  }
}

/** Preference: CEDAR_TREE_OLLAMA_MODEL, then cedar-tree-* profiles, then the largest model up to 12 GB. */
export function chooseAgentModel(candidates: OllamaModel[], preferred = process.env["CEDAR_TREE_OLLAMA_MODEL"]): OllamaModel | undefined {
  const pref = preferred?.toLowerCase();
  return (
    (pref ? candidates.find((m) => m.name.toLowerCase() === pref) : undefined) ??
    candidates.find((m) => /^cedar-tree/i.test(m.name)) ??
    [...candidates].filter((m) => gb(m) <= 12).sort((a, b) => b.size - a.size)[0] ??
    [...candidates].sort((a, b) => a.size - b.size)[0]
  );
}

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "ollama_agent",
    description:
      "Run a task fully offline with a local Ollama model that calls Cedar Tree tools itself (read_file, write_file, search_code, run_shell, git_ops, run_tests). Give the task as plain text; returns the final answer and the tool steps taken. model = 'auto' or an exact name from ollama_models (must support tool calling).",
    inputSchema: {
      task: z.string().describe("What to do, in plain text"),
      model: z.string().default("auto").describe("Model name or 'auto' (picks a local tool-capable model)"),
      maxSteps: z.number().int().min(1).max(20).default(8),
      numCtx: z.number().int().min(2048).max(131072).default(8192).describe("Context window; keep small for speed"),
      timeoutSeconds: z.number().int().min(10).max(1800).default(300).describe("Per model call"),
    },
    handler: async ({ task, model, maxSteps, numCtx, timeoutSeconds }) => {
      try {
        const all = await listModels();
        const local = all.filter((m) => !isCloud(m) && !m.decision);
        const capable: OllamaModel[] = [];
        for (const m of local) if (await supportsTools(m.name)) capable.push(m);

        let name: string;
        if (!model || model === "auto") {
          const picked = chooseAgentModel(capable);
          if (!picked) return textResult("No installed local Ollama model supports tool calling (capability 'tools'). Pull one, e.g. a qwen3 or llama3.1 model.", true);
          name = picked.name;
        } else {
          name = await resolveName(model);
          if (!capable.some((m) => m.name === name)) {
            return textResult(`${name} is not a local model with tool-calling support. Tool-capable local models: ${capable.map((m) => m.name).join(", ") || "none"}`, true);
          }
        }

        const tools = AGENT_TOOLS.map((n) => registry.getTool(n)).filter((t): t is ToolDefinition => !!t);
        if (!tools.length) return textResult("No usable tools are registered (check CEDAR_TREE_TOOLS).", true);

        const chat: ChatFn = async (messages, specs) => {
          const data = await api("/api/chat", { model: name, messages, tools: specs, stream: false, options: { num_ctx: numCtx }, keep_alive: "10m" }, timeoutSeconds * 1000);
          return { role: "assistant", content: String(data.message?.content ?? ""), tool_calls: data.message?.tool_calls };
        };
        const out = await runAgent({ task, chat, tools, maxSteps });
        return jsonResult({ model: name, ...out }, !out.finished);
      } catch (e) {
        return textResult(`ollama_agent failed: ${(e as Error).message}`, true);
      }
    },
  });
}
