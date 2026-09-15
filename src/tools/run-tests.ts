/**
 * run_tests - thin, generic wrapper over run_shell tuned for common test
 * runners (npm/yarn/pnpm test, pytest, go test, cargo test, etc). It simply
 * lets the caller pick a runner (or supply a raw command) and forwards to
 * runShellCommand, so it stays generic rather than hard-coding one ecosystem.
 */
import { z } from "zod";
import type { ToolRegistry } from "../registry.js";
import { jsonResult, textResult } from "../registry.js";
import { resolveSafePath } from "../workspace.js";
import { runShellCommand } from "./run-shell.js";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 20 * 60_000;

const KNOWN_RUNNERS = {
  npm: "npm test",
  yarn: "yarn test",
  pnpm: "pnpm test",
  pytest: "pytest",
  go: "go test ./...",
  cargo: "cargo test",
  dotnet: "dotnet test",
} as const;

type KnownRunner = keyof typeof KNOWN_RUNNERS;

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "run_tests",
    description:
      "Run a project's test suite. Pick a known `runner` (npm, yarn, pnpm, pytest, go, cargo, dotnet) or supply a raw `command` for anything else. Captures stdout/stderr/exit code with a timeout.",
    inputSchema: {
      runner: z
        .enum(["npm", "yarn", "pnpm", "pytest", "go", "cargo", "dotnet"])
        .optional()
        .describe("A known test runner shortcut. Ignored if `command` is provided."),
      command: z.string().optional().describe("Raw test command to run instead of a known runner."),
      args: z.array(z.string()).optional().describe("Extra arguments appended to the resolved command."),
      cwd: z
        .string()
        .optional()
        .describe("Working directory, relative to the workspace root. Defaults to the workspace root."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(MAX_TIMEOUT_MS)
        .optional()
        .describe(`Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}, capped at ${MAX_TIMEOUT_MS}.`),
    },
    handler: async ({
      runner,
      command,
      args,
      cwd,
      timeoutMs,
    }: {
      runner?: KnownRunner;
      command?: string;
      args?: string[];
      cwd?: string;
      timeoutMs?: number;
    }) => {
      if (!runner && !command) {
        return textResult("run_tests requires either `runner` or `command`.", true);
      }
      const base = command ?? KNOWN_RUNNERS[runner as KnownRunner];
      const fullCommand = args && args.length > 0 ? `${base} ${args.join(" ")}` : base;

      try {
        const resolvedCwd = resolveSafePath(cwd ?? ".");
        const result = await runShellCommand(fullCommand, resolvedCwd, timeoutMs ?? DEFAULT_TIMEOUT_MS);
        return jsonResult(result, result.exitCode !== 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`run_tests failed: ${message}`, true);
      }
    },
  });
}
