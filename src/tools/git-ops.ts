/**
 * git_ops - read-focused git operations: status, diff, log, branch.
 *
 * Intentionally does not expose destructive operations (reset --hard, force
 * push, checkout that discards changes, etc). If more git functionality is
 * needed later, add narrowly-scoped, explicitly-safe subcommands rather than
 * a generic "run any git command" escape hatch.
 */
import { z } from "zod";
import type { ToolRegistry } from "../registry.js";
import { jsonResult, textResult } from "../registry.js";
import { resolveSafePath } from "../workspace.js";
import { runShellCommand } from "./run-shell.js";

const TIMEOUT_MS = 30_000;

const SUBCOMMANDS = ["status", "diff", "log", "branch"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function buildArgs(subcommand: Subcommand, opts: { staged?: boolean; maxCount?: number; ref?: string; all?: boolean }): string[] {
  switch (subcommand) {
    case "status":
      return ["status", "--porcelain=v1", "--branch"];
    case "diff":
      return opts.staged ? ["diff", "--staged"] : ["diff", ...(opts.ref ? [opts.ref] : [])];
    case "log":
      return [
        "log",
        `--max-count=${opts.maxCount ?? 20}`,
        "--pretty=format:%H%x09%an%x09%ad%x09%s",
        "--date=iso-strict",
      ];
    case "branch":
      return ["branch", ...(opts.all ? ["--all"] : []), "--verbose"];
  }
}

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "git_ops",
    description:
      "Read-focused git inspection: status, diff, log, or branch listing for a repository within the workspace root. No destructive operations (no reset/force-push/checkout-discard).",
    inputSchema: {
      subcommand: z.enum(SUBCOMMANDS).describe("Which read-only git operation to run."),
      cwd: z
        .string()
        .optional()
        .describe("Repository directory, relative to the workspace root. Defaults to the workspace root."),
      staged: z.boolean().optional().describe("For `diff`: show staged changes instead of working tree changes."),
      ref: z.string().optional().describe("For `diff`: a specific ref/commit/path to diff against."),
      maxCount: z.number().int().positive().max(500).optional().describe("For `log`: max number of commits. Defaults to 20."),
      all: z.boolean().optional().describe("For `branch`: include remote-tracking branches."),
    },
    handler: async (args: {
      subcommand: Subcommand;
      cwd?: string;
      staged?: boolean;
      ref?: string;
      maxCount?: number;
      all?: boolean;
    }) => {
      try {
        const resolvedCwd = resolveSafePath(args.cwd ?? ".");
        const gitArgs = buildArgs(args.subcommand, args);
        const command = ["git", ...gitArgs.map(quoteArg)].join(" ");
        const result = await runShellCommand(command, resolvedCwd, TIMEOUT_MS);
        return jsonResult(result, result.exitCode !== 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`git_ops failed: ${message}`, true);
      }
    },
  });
}

function quoteArg(arg: string): string {
  if (/^[A-Za-z0-9_\-./:=%]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}
