/**
 * mcp-bridge.ts (Electron main process)
 *
 * Calls Cedar Tree MCP tools *in-process* rather than speaking full MCP
 * JSON-RPC over a child process's stdio. It dynamically imports the
 * compiled tool modules from the sibling `cedar-tree` workspace package and
 * feeds them a minimal fake "registry" (same shape used in the server's own
 * unit tests) that just captures each tool's handler function by name.
 *
 * This keeps the desktop client simple while still exercising the exact
 * same tool implementations the MCP server exposes to Copilot.
 */
import { ipcMain } from "electron";

type ToolHandler = (args: any) => Promise<any> | any;

interface FakeToolRegistry {
  registerTool(def: { name: string; handler: ToolHandler }): void;
}

let cachedHandlers: Record<string, ToolHandler> | null = null;

async function loadToolHandlers(): Promise<Record<string, ToolHandler>> {
  if (cachedHandlers) return cachedHandlers;

  const collected: Record<string, ToolHandler> = {};
  const fakeRegistry: FakeToolRegistry = {
    registerTool(def) {
      collected[def.name] = def.handler;
    },
  };

  // cedar-tree is an ESM package (compiled dist/), imported dynamically so
  // this CommonJS main-process file can consume it. The module path is
  // only materialized at build time (scripts/copy-assets.js copies the
  // repo root's dist/ into apps/desktop-client/dist/cedar-tree/), so it's
  // read from a plain variable rather than a string literal - that keeps
  // TypeScript from trying (and failing) to statically resolve a file that
  // doesn't exist until after the build's copy-assets step runs.
  const cedarTreeToolsPath: string = "./cedar-tree/tools/index.js";
  const { allToolModules } = (await import(cedarTreeToolsPath)) as {
    allToolModules: Array<(r: FakeToolRegistry) => void>;
  };
  for (const registerModule of allToolModules) {
    registerModule(fakeRegistry);
  }

  cachedHandlers = collected;
  return collected;
}

export async function listToolNames(): Promise<string[]> {
  const handlers = await loadToolHandlers();
  return Object.keys(handlers);
}

export async function callTool(name: string, args: unknown): Promise<any> {
  const handlers = await loadToolHandlers();
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`Unknown Cedar Tree tool "${name}". Available: ${Object.keys(handlers).join(", ")}`);
  }
  return handler(args);
}

/** Registers the IPC handlers the preload/renderer call into. */
export function registerIpcHandlers(): void {
  ipcMain.handle("cedar-tree:list-tools", async () => {
    try {
      return { ok: true, tools: await listToolNames() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("cedar-tree:call-tool", async (_event, name: string, args: unknown) => {
    try {
      const result = await callTool(name, args);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
