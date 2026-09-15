/**
 * Central list of tool modules. To add a new tool: create a module under
 * src/tools/ that exports `register(registry: ToolRegistry): void`, then
 * add it to this array. server.ts calls each entry in order.
 */
import type { ToolModule } from "../registry.js";
import { register as registerFileIo } from "./file-io.js";
import { register as registerSearchCode } from "./search-code.js";
import { register as registerRunShell } from "./run-shell.js";
import { register as registerRunTests } from "./run-tests.js";
import { register as registerGitOps } from "./git-ops.js";
import { register as registerWeb } from "./web.js";

export const allToolModules: ToolModule[] = [
  registerFileIo,
  registerSearchCode,
  registerRunShell,
  registerRunTests,
  registerGitOps,
  registerWeb,
];
