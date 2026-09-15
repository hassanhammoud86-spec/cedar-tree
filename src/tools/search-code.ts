/**
 * search_code - ripgrep-based text/regex search across a workspace root.
 *
 * Uses the `@vscode/ripgrep` package, which vendors a prebuilt `rg` binary,
 * so the tool works without requiring ripgrep to be separately installed.
 */
import { z } from "zod";
import { spawn } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";
import type { ToolRegistry } from "../registry.js";
import { jsonResult, textResult } from "../registry.js";
import { resolveSafePath } from "../workspace.js";

interface SearchMatch {
  file: string;
  line: number;
  column: number;
  text: string;
}

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "search_code",
    description:
      "Search for a text or regex pattern across files in the workspace using ripgrep. Returns matching file, line, column, and text.",
    inputSchema: {
      pattern: z.string().describe("Text or regular expression to search for."),
      path: z
        .string()
        .optional()
        .describe("Directory (relative to workspace root) to search within. Defaults to the workspace root."),
      globs: z
        .array(z.string())
        .optional()
        .describe("Optional glob filters, e.g. ['*.ts', '!*.test.ts']."),
      caseSensitive: z.boolean().optional().describe("Defaults to false (case-insensitive)."),
      fixedStrings: z.boolean().optional().describe("Treat `pattern` as a literal string, not a regex."),
      maxResults: z.number().int().positive().max(2000).optional().describe("Cap on number of matches returned. Defaults to 200."),
    },
    handler: async (args: {
      pattern: string;
      path?: string;
      globs?: string[];
      caseSensitive?: boolean;
      fixedStrings?: boolean;
      maxResults?: number;
    }) => {
      const searchRoot = resolveSafePath(args.path ?? ".");
      const maxResults = args.maxResults ?? 200;

      const rgArgs = ["--json", "--line-number", "--column"];
      if (!args.caseSensitive) rgArgs.push("--ignore-case");
      if (args.fixedStrings) rgArgs.push("--fixed-strings");
      for (const g of args.globs ?? []) {
        rgArgs.push("--glob", g);
      }
      rgArgs.push("--max-count", String(maxResults));
      rgArgs.push(args.pattern, searchRoot);

      try {
        const { stdout, exitCode } = await runRg(rgArgs);
        // rg exit code 1 means "no matches", which is not an error for us.
        if (exitCode !== 0 && exitCode !== 1) {
          return textResult(`ripgrep exited with code ${exitCode}: ${stdout.slice(0, 2000)}`, true);
        }
        const matches = parseRgJsonLines(stdout).slice(0, maxResults);
        return jsonResult({ pattern: args.pattern, root: searchRoot, matchCount: matches.length, matches });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`search_code failed: ${message}`, true);
      }
    },
  });
}

function runRg(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(rgPath, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && code !== 1 && stderr) {
        stdout += stderr;
      }
      resolvePromise({ stdout, exitCode: code ?? -1 });
    });
  });
}

function parseRgJsonLines(stdout: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.type !== "match") continue;
    const data = parsed.data;
    matches.push({
      file: data.path?.text ?? "",
      line: data.line_number,
      column: data.submatches?.[0]?.start !== undefined ? data.submatches[0].start + 1 : 0,
      text: (data.lines?.text ?? "").replace(/\n$/, ""),
    });
  }
  return matches;
}
