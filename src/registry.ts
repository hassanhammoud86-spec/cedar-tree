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

/**
 * Thin wrapper around McpServer that lets each tool module register itself
 * without needing to know about the underlying SDK call shape.
 */
export class ToolRegistry {
  private readonly registered = new Set<string>();

  constructor(private readonly server: McpServer) {}

  registerTool<Args extends ZodRawShape>(def: ToolDefinition<Args>): void {
    if (this.registered.has(def.name)) {
      throw new Error(`Tool "${def.name}" is already registered`);
    }
    this.registered.add(def.name);
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
