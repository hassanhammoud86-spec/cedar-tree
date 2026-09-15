# Cedar Tree Desktop Client (Phase 3 MVP)

This is the "always-on" desktop client described in the root
[`ROADMAP.md`](../../ROADMAP.md)'s Phase 3 (voice + face interaction). It is a
separate Electron application from the Cedar Tree MCP server (`../..`), since
it needs persistent OS-level access to a microphone and camera and a visible
UI — things an on-demand, stdio-based MCP server cannot provide.

## What it does

- **Speech-to-text**: uses Chromium's built-in Web Speech API
  (`webkitSpeechRecognition`) to continuously transcribe what you say, shown
  live in the window.
- **Text-to-speech**: uses the browser `SpeechSynthesis` API to speak
  responses back.
- **Camera presence heuristic**: uses `getUserMedia` + a small canvas
  frame-difference/variance check to show a rough "is someone there and
  moving" status (`Presence: detected` / `no motion` / `camera off`). **This
  is intentionally not a trained face-recognition model** (see
  [Limitations](#limitations) below) — it's the "lightweight equivalent"
  option called out in the roadmap.
- **Real tool execution**: when speech recognition finalizes a phrase, it's
  sent to a small regex-based command router (`src/command-router.ts`) that
  maps a few spoken phrases to actual Cedar Tree MCP tool calls, executed
  **in-process** (no child process/JSON-RPC needed) via `src/mcp-bridge.ts`,
  which dynamically imports the same compiled tool modules the MCP server
  registers. The result is summarized, logged in the UI, and spoken aloud.

### Supported spoken commands (MVP command router)

| Say | Tool called |
|---|---|
| "list files" / "show files" | `run_shell` (`dir` / `ls -la`) |
| "search code for `<text>`" | `search_code` |
| "read file `<path>`" | `read_file` |
| "git status" | `git_ops` (`status`) |
| "run tests" | `run_tests` (`npm`) |

Anything else gets a "sorry, I didn't understand" spoken reply — this is a
simple router, not full NLU (see Limitations/Future work).

## Setup & running

This app is a **standalone npm project** (not an npm workspace member of the
root `cedar-tree` package) — its build script bundles the MCP server's
compiled `dist/` output directly into its own `dist/cedar-tree/` folder
(see `scripts/copy-assets.js`), so there's no live dependency link between
the two `node_modules` trees. Build the root project first, then this app:

```powershell
# 1. From the repository root: build the MCP server tool modules
npm install
npm run build

# 2. From apps/desktop-client: install this app's own deps and build/run it
cd apps\desktop-client
npm install           # installs Electron/electron-builder/TypeScript for this app only
npm run build          # compiles main/preload/renderer + copies HTML/CSS + bundles ../../dist -> dist/cedar-tree
npm start              # builds again and launches the Electron window
```

On first launch, your OS will likely prompt for microphone/camera permission
for the Electron app itself (separate from the in-app permission handler,
which auto-approves Chromium's internal `media` permission request).

## Packaging a portable Windows .exe

```powershell
cd apps\desktop-client
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"   # skip electron-builder's mac code-signing tool download
npm run dist:win
```

This uses `electron-builder` to produce a portable executable at
`apps/desktop-client/release/CedarTree <version>.exe` (typically ~70-75 MB,
since it bundles a full Chromium/Electron runtime). The `build.win`
config sets `signAndEditExecutable: false` since this is an unsigned,
locally-built portable app — no code-signing certificate is used or
required.

**Notes on this environment's packaging quirks** (useful if you hit similar
errors elsewhere):
- Keep this app's `node_modules` separate from the root project's (i.e. do
  **not** declare it as an npm workspace member and do **not** add
  `cedar-tree` as an npm dependency). `electron-builder`'s "installing
  production dependencies" pruning step does not play well with hoisted
  npm-workspace `node_modules` layouts — it was observed to delete its own
  `app-builder-bin` devDependency from a hoisted root `node_modules`,
  causing `spawn ...app-builder.exe ENOENT`. A fully standalone
  `node_modules` for this app avoids that entirely.
- `CSC_IDENTITY_AUTO_DISCOVERY=false` plus `signAndEditExecutable: false`
  avoids a `winCodeSign` binary download that can fail to extract on
  Windows accounts without the "create symbolic links" privilege
  (Developer Mode off / non-admin), since that binary isn't needed for an
  unsigned portable build anyway.

A prebuilt copy of the `.exe` (plus this README) may already be sitting on
your Desktop at `C:\Users\hassa\OneDrive\Desktop\CedarTree\` — see the task
report for confirmation of whether that step was completed.

## How it relates to the MCP server

The MCP server (`../../src`) is what GitHub Copilot talks to over stdio
inside VS Code / Visual Studio — it has no UI and no audio/video access, by
design (see root README). This desktop client is a *different* program that:

1. Imports the exact same compiled tool handlers (bundled into
   `dist/cedar-tree/tools/*` at build time from the root project's own
   `dist/`), so "list files" here runs the identical `run_shell`
   implementation Copilot would use.
2. Adds the voice/camera/UI layer the MCP protocol itself doesn't support.

They are not required to run together — you can use Copilot + the MCP server
without ever opening this app, and vice versa.

## Limitations

- **Speech recognition needs internet.** Chromium's built-in
  `webkitSpeechRecognition` sends audio to a network speech-recognition
  service; it will not work fully offline.
- **Camera "presence" is a heuristic, not face recognition.** It compares
  successive downsampled grayscale frames for motion and contrast/variance.
  It cannot tell *whose* face it is, or reliably tell a face apart from any
  other moving/textured object in frame. A real implementation (e.g.
  `face-api.js` with a downloaded model, or the browser's experimental Shape
  Detection API) is called out as future work in the root `ROADMAP.md`.
- **Command routing is regex-based**, not true natural-language
  understanding — it only recognizes the fixed phrasings listed above.
- **No wake-word detection.** You must click "Start listening"; it doesn't
  passively listen for a trigger phrase.
- **No conversation memory.** Each command is handled independently.
- Requires mic/camera OS permissions; if denied, the corresponding feature
  is disabled with a status message rather than crashing the app.
