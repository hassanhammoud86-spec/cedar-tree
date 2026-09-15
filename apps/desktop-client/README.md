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

From the **repository root** (this app is an npm workspace member):

```powershell
npm install        # installs the MCP server's deps + this app's deps (Electron etc.)
npm run build       # builds the MCP server (dist/) that this app imports from
cd apps\desktop-client
npm run build        # compiles main/preload/renderer TypeScript + copies HTML/CSS
npm start            # builds again and launches the Electron window
```

On first launch, your OS will likely prompt for microphone/camera permission
for the Electron app itself (separate from the in-app permission handler,
which auto-approves Chromium's internal `media` permission request).

## Packaging a portable Windows .exe

```powershell
cd apps\desktop-client
npm run dist:win
```

This uses `electron-builder` to produce a portable executable under
`apps/desktop-client/release/`. See the root `scripts/` folder or the task
report for where a prebuilt copy was placed on the Desktop, if applicable.

## How it relates to the MCP server

The MCP server (`../../src`) is what GitHub Copilot talks to over stdio
inside VS Code / Visual Studio — it has no UI and no audio/video access, by
design (see root README). This desktop client is a *different* program that:

1. Imports the exact same compiled tool handlers (`cedar-tree/dist/tools/*`)
   the MCP server registers, so "list files" here runs the identical
   `run_shell` implementation Copilot would use.
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
