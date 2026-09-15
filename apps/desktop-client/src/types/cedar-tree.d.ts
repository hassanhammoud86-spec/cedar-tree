/**
 * Minimal ambient typing for the subset of the `cedar-tree` package's
 * compiled output that the desktop client imports dynamically. Cedar Tree
 * itself is built without .d.ts output (declaration: false), so we hand-type
 * just the shape mcp-bridge.ts relies on.
 */
declare module "cedar-tree/dist/tools/index.js" {
  export type ToolModule = (registry: { registerTool(def: { name: string; handler: (args: any) => any }): void }) => void;
  export const allToolModules: ToolModule[];
}
