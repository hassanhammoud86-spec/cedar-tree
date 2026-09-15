# Cedar Tree 🌲

Cedar Tree is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server
that aggregates a set of AI-assisted dev tools/skills — file I/O, code search, shell
execution, test running, read-only git inspection, and web search/fetch — behind a
single stdio MCP server, for use with **GitHub Copilot** in **Visual Studio** and
**Visual Studio Code**.

It's built as a plugin-style registry: each tool lives in its own module under
`src/tools/`, and adding a new tool just means writing a new module and listing it in
`src/tools/index.ts` — no changes to the server or transport layer required.

## Tools included in this phase

| Tool | Description |
|---|---|
| `read_file` | Read a UTF-8/base64 file, scoped to the workspace root. |
| `write_file` | Create/overwrite a file (creates parent dirs), scoped to the workspace root. |
| `search_code` | ripgrep-backed text/regex search across the workspace. |
| `run_shell` | Run a shell command in a working directory with a timeout, capturing stdout/stderr/exit code. |
| `run_tests` | Thin wrapper over `run_shell` with shortcuts for common test runners (npm/yarn/pnpm/pytest/go/cargo/dotnet). |
| `git_ops` | Read-only git inspection: `status`, `diff`, `log`, `branch`. No destructive operations. |
| `web_search` | Pluggable web search (defaults to the key-free DuckDuckGo Instant Answer API). |
| `web_fetch` | Fetch a URL and return status/content-type/text (HTML stripped to plain text). |

All filesystem and shell-cwd operations are scoped to a **workspace root**
(`CEDAR_TREE_WORKSPACE_ROOT` env var, defaults to the server's current working
directory) and cannot escape it via `..` or absolute paths outside the root.

## Build

Requires Node.js >= 18.

```powershell
npm install
npm run build
```

This compiles TypeScript from `src/` into `dist/` (entrypoint: `dist/server.js`).

Run the unit tests with:

```powershell
npm test
```

Run the server directly (useful for manual smoke-testing over stdio):

```powershell
npm start
```

## Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `CEDAR_TREE_WORKSPACE_ROOT` | Root directory that `read_file`/`write_file`/`run_shell`/`run_tests`/`git_ops` are scoped to. Defaults to the process's current working directory. |
| `CEDAR_TREE_SEARCH_API_KEY` | Optional. If set, `web_search` uses the API-key provider stub (see `src/providers/index.ts`) instead of the default key-free DuckDuckGo provider. |

## Wiring into VS Code Copilot

VS Code's Copilot Chat supports MCP servers via a workspace `.vscode/mcp.json` file
(or the equivalent `mcp` setting in user/workspace settings). Create
`.vscode/mcp.json` in the project you want Cedar Tree available in:

```json
{
  "servers": {
    "cedar-tree": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\cedar-tree\\dist\\server.js"],
      "env": {
        "CEDAR_TREE_WORKSPACE_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

Then reload the window, open Copilot Chat, and enable the `cedar-tree` tools from the
tools picker (🛠️ icon).

## Wiring into Visual Studio

Visual Studio 17.14+ supports MCP servers for Copilot via an `mcp.json` file. Place it
at the solution root (or `%USERPROFILE%\.mcp.json` for a user-wide config):

```json
{
  "inputs": [],
  "servers": {
    "cedar-tree": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\cedar-tree\\dist\\server.js"],
      "env": {
        "CEDAR_TREE_WORKSPACE_ROOT": "C:\\absolute\\path\\to\\your\\solution"
      }
    }
  }
}
```

Reopen the solution and Copilot Chat's tool picker should list Cedar Tree's tools.

## Registering Cedar Tree globally (one-time, all workspaces)

Instead of adding `.vscode/mcp.json` to every project, you can register Cedar Tree
once for your Windows user account so it's automatically available to Copilot agent
mode in **every** VS Code workspace and Visual Studio solution:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-global-mcp.ps1
```

This writes/merges a `cedar-tree` entry into:

- VS Code's global user config: `%APPDATA%\Code\User\mcp.json`
- Visual Studio's global user config: `%USERPROFILE%\.mcp.json`

It's **idempotent** — safe to re-run any time (e.g. after moving the repo or
rebuilding), and it only touches the `cedar-tree` entry, leaving any other MCP
servers already configured in those files untouched. Restart VS Code / Visual
Studio (or reload the window) afterwards to pick up the change.

Once registered, GitHub Copilot's **agent/autopilot mode** in both editors
auto-discovers every server listed in the applicable `mcp.json`(s) — no extra
enablement step is required beyond the one-time restart, and no per-project setup
is needed for future workspaces.

## Project layout

```
src/
  server.ts            MCP stdio server entrypoint; registers all tools
  registry.ts           Plugin-style ToolRegistry (registerTool pattern)
  workspace.ts          Workspace-root path safety helper
  providers/            Pluggable web search/fetch provider interfaces + implementations
  tools/
    index.ts            List of all tool modules
    file-io.ts           read_file / write_file
    search-code.ts       search_code (ripgrep)
    run-shell.ts         run_shell
    run-tests.ts         run_tests
    git-ops.ts           git_ops
    web.ts               web_search / web_fetch
test/
  file-io.test.ts
  search-code.test.ts
```

## Adding a new tool

1. Create `src/tools/my-tool.ts` exporting `register(registry: ToolRegistry): void`
   that calls `registry.registerTool({ name, description, inputSchema, handler })`.
2. Add it to the `allToolModules` array in `src/tools/index.ts`.
3. Rebuild (`npm run build`) — no other wiring needed.

See `ROADMAP.md` for planned future phases, including a real-time voice/face
interaction mode.
