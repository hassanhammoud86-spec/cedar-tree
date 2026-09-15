/**
 * run_shell - execute a shell command in a working directory, capturing
 * stdout/stderr/exit code, bounded by a timeout.
 *
 * The working directory is resolved against the workspace root and must not
 * escape it, but the command itself is otherwise unrestricted (this tool is
 * intentionally powerful; callers should be trusted, same as any other
 * shell-executing dev tool).
 */
import { z } from "zod";
import { spawn } from "node:child_process";
import type { ToolRegistry } from "../registry.js";
import { jsonResult, textResult } from "../registry.js";
import { resolveSafePath } from "../workspace.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 200_000;

export interface RunShellResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<RunShellResult> {
  return new Promise((resolvePromise) => {
    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn("cmd.exe", ["/d", "/s", "/c", command], { cwd, windowsHide: true })
      : spawn("/bin/sh", ["-c", command], { cwd });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        command,
        cwd,
        exitCode: null,
        timedOut,
        stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
        stderr: `${stderr}\n${err.message}`.slice(0, MAX_OUTPUT_CHARS),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        command,
        cwd,
        exitCode: code,
        timedOut,
        stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
        stderr: stderr.slice(0, MAX_OUTPUT_CHARS),
      });
    });
  });
}

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "run_shell",
    description:
      "Execute a shell command in a working directory (scoped to the workspace root), capturing stdout, stderr, and exit code. Bounded by a timeout.",
    inputSchema: {
      command: z.string().describe("Shell command to execute."),
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
    handler: async ({ command, cwd, timeoutMs }: { command: string; cwd?: string; timeoutMs?: number }) => {
      try {
        const resolvedCwd = resolveSafePath(cwd ?? ".");
        const result = await runShellCommand(command, resolvedCwd, timeoutMs ?? DEFAULT_TIMEOUT_MS);
        return jsonResult(result, result.exitCode !== 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`run_shell failed: ${message}`, true);
      }
    },
  });
}
