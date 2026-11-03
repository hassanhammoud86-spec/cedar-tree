import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry, parseToolFilter, LOCAL_PROFILE_TOOLS } from "../src/registry.js";

const fakeServer = { registerTool() {} } as any;
const def = (name: string) => ({ name, description: "", inputSchema: {}, handler: () => ({ content: [] }) });

test("parseToolFilter handles unset, all, local and lists", () => {
  assert.equal(parseToolFilter(undefined), null);
  assert.equal(parseToolFilter(" ALL "), null);
  assert.deepEqual([...parseToolFilter("local")!], LOCAL_PROFILE_TOOLS);
  assert.deepEqual([...parseToolFilter("a, b,,c")!], ["a", "b", "c"]);
});

test("registry only registers allowed tools", () => {
  const r = new ToolRegistry(fakeServer, parseToolFilter("read_file,git_ops"));
  for (const n of ["read_file", "web_search", "git_ops", "ollama_ask"]) r.registerTool(def(n));
  assert.deepEqual(r.toolNames, ["read_file", "git_ops"]);
});

test("registry registers everything without a filter", () => {
  const r = new ToolRegistry(fakeServer, null);
  for (const n of ["a", "b"]) r.registerTool(def(n));
  assert.deepEqual(r.toolNames, ["a", "b"]);
});
