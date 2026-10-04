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
    const toCopilot = /^(?:please\s+)?(?:ask|tell)\s+copilot\b/i.test(text);
    // "open X", "launch X", "start X", optionally "... in visual studio".
    if (!toCopilot && (match = text.match(/^(?:please\s+)?(?:open|launch|start)\s+(.+?)[.!]*$/i))) {
      let target = match[1].trim().replace(/^(the|my|a)\s+/i, "");
      let inVisualStudio = false;
      const inVs = target.match(/^(.+?)\s+(?:in|with|using)\s+(?:visual studio|vs)(?:\s+2026)?$/i);
      if (inVs) {
        target = inVs[1].trim();
        inVisualStudio = true;
      }
      if (!/^tests?$/i.test(target) && target.split(/\s+/).length <= 4) {
        const result = await callTool("open_target", { target, inVisualStudio });
        const ok = !result?.isError;
        return {
          transcript,
          matchedTool: "open_target",
          spokenReply: ok ? `Opening ${target}${inVisualStudio ? " in Visual Studio" : ""}.` : textOf(result),
          raw: result,
        };
      }
    }

    if (/^(?:list|show)\s+(?:my\s+|the\s+)?(?:ollama\s+)?models$/i.test(text)) {
      const result = await callTool("ollama_models", {});
      let reply = textOf(result);
      try {
        const names = (JSON.parse(reply) as Array<{ name: string }>).map((m) => m.name);
        reply = `${names.length} models: ${names.join(", ")}`;
      } catch {
        /* keep raw text */
      }
      return { transcript, matchedTool: "ollama_models", spokenReply: truncate(reply, 400), raw: result };
    }

    // "ask all models X" / "ask everyone X" -> ensemble with a judge.
    if ((match = text.match(/^ask\s+(?:all|every)\s*(?:ollama\s+)?(?:models?|one)?\s*(?:to\s+|about\s+|:)?\s*(.+)$/i))) {
      const result = await callTool("ollama_ensemble", { prompt: match[1].trim(), judge: "auto" });
      let reply = textOf(result);
      try {
        const data = JSON.parse(reply);
        reply = data.merged ?? data.results?.map((r: any) => `${r.model}: ${r.answer ?? r.error}`).join("\n") ?? reply;
      } catch {
        /* keep raw text */
      }
      return { transcript, matchedTool: "ollama_ensemble", spokenReply: truncate(reply, 600), raw: result };
    }

    // "ask ollama X" / "ask astrea X" / "ask claude code X" -> a single local model.
    if ((match = text.match(/^ask\s+(ollama|astrea|claude[\s-]?code)\s*(?:to\s+|about\s+|:)?\s*(.+)$/i))) {
      const who = match[1].toLowerCase().replace(/\s+/, "-");
      const model = who === "ollama" ? "auto" : who;
      const kind = who === "astrea" ? "chat" : "code";
      const result = await callTool("ollama_ask", { prompt: match[2].trim(), model, kind });
      return { transcript, matchedTool: "ollama_ask", spokenReply: truncate(textOf(result), 600), raw: result };
    }
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

  // Anything not understood locally is an order for Copilot agent in Visual
  // Studio, which has every Cedar Tree tool and can handle free-form requests.
  try {
    const prompt = text.replace(/^(?:please\s+)?(?:ask|tell)\s+copilot\s+(?:to\s+)?/i, "");
    const result = await callTool("send_to_copilot", { text: prompt });
    const ok = !result?.isError;
    return {
      transcript,
      matchedTool: "send_to_copilot",
      spokenReply: ok ? "Sent to Copilot in Visual Studio." : textOf(result),
      raw: result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { transcript, matchedTool: null, spokenReply: `Could not reach Copilot: ${message}` };
  }
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
