import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withTempWorkspace<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "cedar-tree-search-test-"));
  const prevRoot = process.env.CEDAR_TREE_WORKSPACE_ROOT;
  process.env.CEDAR_TREE_WORKSPACE_ROOT = root;
  try {
    return await fn(root);
  } finally {
    if (prevRoot === undefined) delete process.env.CEDAR_TREE_WORKSPACE_ROOT;
    else process.env.CEDAR_TREE_WORKSPACE_ROOT = prevRoot;
    await rm(root, { recursive: true, force: true });
  }
}

function parseJsonContent(result: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(result.content[0].text);
}

function captureHandlers(registerModule: (registry: any) => void): Record<string, (args: any) => Promise<any>> {
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const fakeRegistry = {
    registerTool(def: { name: string; handler: (args: any) => Promise<any> }) {
      handlers[def.name] = def.handler;
    },
  };
  registerModule(fakeRegistry);
  return handlers;
}

test("search_code finds matches for a literal pattern across files", async () => {
  await withTempWorkspace(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export function needle() { return 1; }\n");
    await writeFile(join(root, "src", "b.ts"), "export const other = 2;\n");

    const { register: registerSearchCode } = await import("../src/tools/search-code.js");
    const handlers = captureHandlers(registerSearchCode);

    const result = await handlers.search_code({ pattern: "needle", fixedStrings: true });
    const data = parseJsonContent(result);

    assert.equal(data.matchCount, 1);
    assert.ok(data.matches[0].file.endsWith("a.ts"));
    assert.equal(data.matches[0].line, 1);
    assert.match(data.matches[0].text, /needle/);
  });
});

test("search_code returns zero matches for a pattern that does not exist", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "file.txt"), "nothing interesting here\n");

    const { register: registerSearchCode } = await import("../src/tools/search-code.js");
    const handlers = captureHandlers(registerSearchCode);

    const result = await handlers.search_code({ pattern: "zzz_not_present_zzz" });
    const data = parseJsonContent(result);

    assert.equal(data.matchCount, 0);
    assert.deepEqual(data.matches, []);
  });
});

test("search_code respects glob filters", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "keep.ts"), "target_token\n");
    await writeFile(join(root, "skip.md"), "target_token\n");

    const { register: registerSearchCode } = await import("../src/tools/search-code.js");
    const handlers = captureHandlers(registerSearchCode);

    const result = await handlers.search_code({ pattern: "target_token", globs: ["*.ts"] });
    const data = parseJsonContent(result);

    assert.equal(data.matchCount, 1);
    assert.ok(data.matches[0].file.endsWith("keep.ts"));
  });
});
