/**
 * command-router.ts (Electron main process)
 *
 * A deliberately simple, regex-based command router: it maps a handful of
 * spoken phrase patterns to real Cedar Tree tool calls. This is *not* full
 * NLU (see ROADMAP.md) - it's just enough to demonstrate speech -> real
 * tool execution -> spoken result end-to-end.
 */
import { callTool } from "./mcp-bridge";
import { ipcMain } from "electron";

export interface RouteResult {
  transcript: string;
  matchedTool: string | null;
  spokenReply: string;
  raw?: unknown;
}

export async function routeCommand(transcript: string): Promise<RouteResult> {
  const text = transcript.trim();
  let match: RegExpMatchArray | null;

  try {
    if (/^(list|show)( the)? files?$/i.test(text)) {
      const command = process.platform === "win32" ? "dir" : "ls -la";
      const result = await callTool("run_shell", { command });
      return { transcript, matchedTool: "run_shell", spokenReply: summarizeShell(result), raw: result };
    }

    if ((match = text.match(/^search( the)? code for (.+)$/i))) {
      const pattern = match[2].trim();
      const result = await callTool("search_code", { pattern });
      return { transcript, matchedTool: "search_code", spokenReply: summarizeSearch(result, pattern), raw: result };
    }

    if ((match = text.match(/^read( the)? file (.+)$/i))) {
      const path = match[2].trim();
      const result = await callTool("read_file", { path });
      return { transcript, matchedTool: "read_file", spokenReply: summarizeRead(result, path), raw: result };
    }

    if (/^git status$/i.test(text)) {
      const result = await callTool("git_ops", { subcommand: "status" });
      return { transcript, matchedTool: "git_ops", spokenReply: summarizeShell(result), raw: result };
    }

    if (/^run( the)? tests?$/i.test(text)) {
      const result = await callTool("run_tests", { runner: "npm" });
      return { transcript, matchedTool: "run_tests", spokenReply: summarizeShell(result), raw: result };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { transcript, matchedTool: null, spokenReply: `Something went wrong: ${message}` };
  }

  return {
    transcript,
    matchedTool: null,
    spokenReply:
      "Sorry, I didn't understand that. Try saying: list files, search code for something, read file package dot json, git status, or run tests.",
  };
}

function textOf(result: any): string {
  try {
    return result?.content?.[0]?.text ?? "";
  } catch {
    return "";
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function summarizeShell(result: any): string {
  const text = textOf(result);
  try {
    const data = JSON.parse(text);
    if (data.exitCode === 0) {
      return `Done. ${truncate(data.stdout?.trim() || "No output.", 220)}`;
    }
    return `That command failed with exit code ${data.exitCode}. ${truncate(
      (data.stderr || data.stdout || "").trim(),
      220
    )}`;
  } catch {
    return truncate(text, 220);
  }
}

function summarizeSearch(result: any, pattern: string): string {
  const text = textOf(result);
  try {
    const data = JSON.parse(text);
    return `Found ${data.matchCount} match${data.matchCount === 1 ? "" : "es"} for "${pattern}".`;
  } catch {
    return truncate(text, 220);
  }
}

function summarizeRead(result: any, path: string): string {
  const text = textOf(result);
  try {
    const data = JSON.parse(text);
    return `Read ${data.bytes} bytes from ${path}.`;
  } catch {
    return `Could not read ${path}.`;
  }
}

/** Registers the IPC handler the preload/renderer call for a spoken command. */
export function registerCommandRouterIpcHandler(): void {
  ipcMain.handle("cedar-tree:run-command", async (_event, transcript: string) => {
    return routeCommand(transcript);
  });
}
