#!/usr/bin/env node
/**
 * Cedar Tree MCP server entrypoint.
 *
 * Starts an MCP server over stdio and registers every tool module in
 * src/tools/index.ts. Wire this up in VS Code / Visual Studio by pointing
 * an MCP client config at `node dist/server.js` (see README.md).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToolRegistry } from "./registry.js";
import { allToolModules } from "./tools/index.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "cedar-tree",
    version: "0.1.0",
  });

  const registry = new ToolRegistry(server);
  for (const registerModule of allToolModules) {
    registerModule(registry);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`cedar-tree MCP server started with tools: ${registry.toolNames.join(", ")}`);
}

main().catch((err) => {
  console.error("Fatal error starting cedar-tree MCP server:", err);
  process.exit(1);
});
