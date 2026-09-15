import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withTempWorkspace<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "cedar-tree-test-"));
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

test("write_file then read_file round-trips UTF-8 content", async () => {
  await withTempWorkspace(async (root) => {
    const { register: registerFileIo } = await import("../src/tools/file-io.js");
    const handlers = captureHandlers(registerFileIo);

    const writeResult = await handlers.write_file({ path: "hello.txt", content: "hello cedar tree" });
    const writeData = parseJsonContent(writeResult);
    assert.equal(writeData.bytesWritten, Buffer.byteLength("hello cedar tree", "utf-8"));

    const onDisk = await readFile(join(root, "hello.txt"), "utf-8");
    assert.equal(onDisk, "hello cedar tree");

    const readResult = await handlers.read_file({ path: "hello.txt" });
    const readData = parseJsonContent(readResult);
    assert.equal(readData.content, "hello cedar tree");
  });
});

test("write_file creates nested parent directories", async () => {
  await withTempWorkspace(async () => {
    const { register: registerFileIo } = await import("../src/tools/file-io.js");
    const handlers = captureHandlers(registerFileIo);

    const result = await handlers.write_file({ path: "nested/dir/file.txt", content: "nested" });
    assert.equal(result.isError, false);

    const readResult = await handlers.read_file({ path: "nested/dir/file.txt" });
    assert.equal(parseJsonContent(readResult).content, "nested");
  });
});

test("read_file and write_file reject paths that escape the workspace root", async () => {
  await withTempWorkspace(async () => {
    const { register: registerFileIo } = await import("../src/tools/file-io.js");
    const handlers = captureHandlers(registerFileIo);

    const readResult = await handlers.read_file({ path: "../outside.txt" });
    assert.equal(readResult.isError, true);
    assert.match(readResult.content[0].text, /outside of the workspace root/);

    const writeResult = await handlers.write_file({ path: "../outside.txt", content: "nope" });
    assert.equal(writeResult.isError, true);
    assert.match(writeResult.content[0].text, /outside of the workspace root/);
  });
});

test("read_file reports a clear error for a missing file", async () => {
  await withTempWorkspace(async () => {
    const { register: registerFileIo } = await import("../src/tools/file-io.js");
    const handlers = captureHandlers(registerFileIo);

    const result = await handlers.read_file({ path: "does-not-exist.txt" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Failed to access/);
  });
});

/**
 * Minimal fake ToolRegistry that just captures each tool's handler by name,
 * so tests can call handlers directly without spinning up a real MCP server.
 */
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
