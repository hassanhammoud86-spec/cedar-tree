/**
 * Plugin-style tool registry for Cedar Tree.
 *
 * Each tool module exports a `register(registry)` function that calls
 * `registry.registerTool(...)` with its MCP tool definition. The server
 * entrypoint simply imports every tool module and calls `register()`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

export type { CallToolResult };

export interface ToolDefinition<Args extends ZodRawShape = ZodRawShape> {
  /** Unique tool name exposed over MCP. */
  name: string;
  /** Human readable description shown to the model. */
  description: string;
  /** Zod shape describing the tool's input arguments. */
  inputSchema: Args;
  /** Handler invoked when the tool is called. */
  handler: (args: any) => Promise<CallToolResult> | CallToolResult;
}

export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

export function jsonResult(data: unknown, isError = false): CallToolResult {
  return textResult(JSON.stringify(data, null, 2), isError);
}

/** Core tools a local model can drive. */
export const AGENT_TOOLS = ["read_file", "write_file", "search_code", "run_shell", "git_ops", "run_tests"];

/** Small tool set for local models (core tools plus the offline agent): fewer schemas means a much smaller prompt. */
export const LOCAL_PROFILE_TOOLS = [...AGENT_TOOLS, "ollama_agent"];

/**
 * Parses CEDAR_TREE_TOOLS: unset/"all" = every tool (null), "local" = LOCAL_PROFILE_TOOLS,
 * otherwise a comma-separated allow-list of tool names.
 */
export function parseToolFilter(value: string | undefined): Set<string> | null {
  const v = value?.trim();
  if (!v || v.toLowerCase() === "all") return null;
  if (v.toLowerCase() === "local") return new Set(LOCAL_PROFILE_TOOLS);
  return new Set(v.split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Thin wrapper around McpServer that lets each tool module register itself
 * without needing to know about the underlying SDK call shape.
 */
export class ToolRegistry {
  private readonly registered = new Set<string>();
  private readonly definitions = new Map<string, ToolDefinition>();

  /** Looks up a registered tool so in-process agents can call it. */
  getTool(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  constructor(
    private readonly server: McpServer,
    private readonly allow: Set<string> | null = parseToolFilter(process.env["CEDAR_TREE_TOOLS"]),
  ) {}

  registerTool<Args extends ZodRawShape>(def: ToolDefinition<Args>): void {
    if (this.allow && !this.allow.has(def.name)) return;
    if (this.registered.has(def.name)) {
      throw new Error(`Tool "${def.name}" is already registered`);
    }
    this.registered.add(def.name);
    this.definitions.set(def.name, def as unknown as ToolDefinition);
    // The MCP SDK's registerTool overloads infer an internal zod-compat shape
    // type from `inputSchema` that our own `ZodRawShape`-typed generic can't
    // unify with structurally; the runtime behavior is identical (plain zod
    // shape objects), so this cast is safe.
    (this.server.registerTool as any)(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
      },
      async (args: any) => def.handler(args)
    );
  }

  get toolNames(): string[] {
    return [...this.registered];
  }
}

/** A module that contributes one or more tools to the registry. */
export type ToolModule = (registry: ToolRegistry) => void;
