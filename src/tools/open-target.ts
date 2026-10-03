/**
 * open_target - open an application, file, folder, URL, or a Visual Studio
 * solution/project on the user's machine. Lets Copilot agent mode (and the
 * Cedar Tree desktop client) follow orders like "open Visual Studio",
 * "open the project in Visual Studio", "open notepad" or "open github.com".
 */
import { z } from "zod";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import type { ToolRegistry } from "../registry.js";
import { jsonResult, textResult } from "../registry.js";
import { getWorkspaceRoot } from "../workspace.js";

const APP_ALIASES: Record<string, string> = {
  notepad: "notepad.exe",
  calculator: "calc.exe",
  calc: "calc.exe",
  explorer: "explorer.exe",
  "file explorer": "explorer.exe",
  paint: "mspaint.exe",
  cmd: "cmd.exe",
  "command prompt": "cmd.exe",
  powershell: "powershell.exe",
  terminal: "wt.exe",
  "task manager": "taskmgr.exe",
  chrome: "chrome.exe",
  edge: "msedge.exe",
  firefox: "firefox.exe",
  "vs code": "code",
  vscode: "code",
  "visual studio code": "code",
  word: "winword.exe",
  excel: "excel.exe",
  outlook: "outlook.exe",
  settings: "ms-settings:",
};

const VS_NAMES = new Set(["visual studio", "visual studio 2026", "vs", "vs 2026", "devenv"]);

/** Newest installed Visual Studio's devenv.exe, or null. */
export function findVisualStudio(): string | null {
  const roots = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].filter(Boolean) as string[];
  const found: Array<{ version: number; path: string }> = [];
  for (const root of roots) {
    const base = join(root, "Microsoft Visual Studio");
    if (!existsSync(base)) continue;
    for (const ver of readdirSync(base)) {
      const verDir = join(base, ver);
      if (!statSync(verDir).isDirectory()) continue;
      for (const edition of readdirSync(verDir)) {
        const exe = join(verDir, edition, "Common7", "IDE", "devenv.exe");
        if (existsSync(exe)) found.push({ version: parseInt(ver, 10) || 0, path: exe });
      }
    }
  }
  found.sort((a, b) => b.version - a.version);
  return found[0]?.path ?? null;
}

function launch(file: string, args: string[]): void {
  const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => undefined);
  child.unref();
}

function shellStart(target: string): void {
  launch("cmd.exe", ["/d", "/c", "start", '""', target]);
}

function findSolution(dir: string): string | null {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  const files = readdirSync(dir);
  const hit =
    files.find((f) => /\.slnx?$/i.test(f)) ?? files.find((f) => /\.(csproj|vbproj|vcxproj)$/i.test(f));
  return hit ? join(dir, hit) : null;
}

export interface OpenResult {
  opened: string;
  via: string;
}

export function openTarget(targetRaw: string, inVisualStudio = false): OpenResult {
  const target = targetRaw.trim().replace(/^["']|["']$/g, "");
  const lower = target.toLowerCase();
  const vs = findVisualStudio();

  if (VS_NAMES.has(lower)) {
    if (!vs) throw new Error("Visual Studio was not found on this machine.");
    launch(vs, []);
    return { opened: vs, via: "visual-studio" };
  }

  if (/^https?:\/\//i.test(target)) {
    shellStart(target);
    return { opened: target, via: "default-browser" };
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(target) && !existsSync(target)) {
    shellStart(`https://${target}`);
    return { opened: `https://${target}`, via: "default-browser" };
  }

  // Treat "this project/workspace/solution/folder" as the workspace root.
  const workspaceWords = new Set(["project", "the project", "workspace", "solution", "this project", "cedar tree"]);
  let path: string | null = null;
  if (workspaceWords.has(lower)) path = getWorkspaceRoot();
  else if (existsSync(target)) path = resolve(target);
  else if (existsSync(resolve(getWorkspaceRoot(), target))) path = resolve(getWorkspaceRoot(), target);

  if (path) {
    const isDir = statSync(path).isDirectory();
    const ext = extname(path).toLowerCase();
    const solution = isDir ? findSolution(path) : null;
    const isVsFile = [".sln", ".slnx", ".csproj", ".vbproj", ".vcxproj"].includes(ext);

    if (vs && (isVsFile || (inVisualStudio && !isDir))) {
      launch(vs, [path]);
      return { opened: path, via: "visual-studio" };
    }
    if (vs && inVisualStudio && isDir) {
      // Folder without a solution: Visual Studio opens it as a folder workspace.
      launch(vs, [solution ?? path]);
      return { opened: solution ?? path, via: "visual-studio" };
    }
    if (isDir) launch("explorer.exe", [path]);
    else shellStart(path);
    return { opened: path, via: isDir ? "explorer" : "default-app" };
  }

  const alias = APP_ALIASES[lower];
  shellStart(alias ?? target);
  return { opened: alias ?? target, via: alias ? "app-alias" : "shell-start" };
}

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "open_target",
    description:
      "Open something on the user's computer: an application (notepad, chrome, vs code...), Visual Studio itself ('visual studio'), a file, a folder, a URL/website, or a project/solution in Visual Studio (set inVisualStudio=true, or pass a .sln/.csproj path).",
    inputSchema: {
      target: z
        .string()
        .describe(
          "What to open: app name, file/folder path, URL or domain, 'visual studio', or 'project' for the current workspace."
        ),
      inVisualStudio: z
        .boolean()
        .optional()
        .describe("Open the file/folder/solution in Visual Studio instead of its default app."),
    },
    handler: async ({ target, inVisualStudio }: { target: string; inVisualStudio?: boolean }) => {
      try {
        return jsonResult(openTarget(target, inVisualStudio ?? false));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`open_target failed: ${message}`, true);
      }
    },
  });
}
