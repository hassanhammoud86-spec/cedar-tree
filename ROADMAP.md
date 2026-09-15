# Cedar Tree Roadmap

This document tracks future phases beyond the initial MCP server (file I/O, code
search, shell/test execution, read-only git, web search/fetch).

## Phase 2: Expand the tool/skill set

Add more pluggable tool modules under `src/tools/`, following the same
`registerTool()` pattern used today. Candidates:

- **Image generation / editing** — a `generate_image` tool wrapping a provider
  (OpenAI Images, Stability, etc.) behind the same pluggable-provider pattern used
  for `web_search`/`web_fetch` (`src/providers/`).
- **Audio generation** — text-to-speech / music/sfx generation tools, again behind
  a provider interface so the concrete backend is swappable.
- **Database access** — a `db_query` tool (read-only by default, with an explicit
  opt-in for writes) supporting common drivers (Postgres, MySQL, SQLite) via a
  connection-string env var, scoped similarly to how `git_ops` restricts to
  read-only operations by default.
- **Package/dependency intelligence** — tools to inspect installed dependencies,
  check for vulnerabilities (e.g. wrapping `npm audit`/`pip-audit`), and suggest
  upgrades.
- **Structured code editing** — an AST-aware `edit_code` tool (e.g. via ts-morph or
  jscodeshift) for safer refactors than raw text replacement.
- **Multi-root workspace support** — allow `CEDAR_TREE_WORKSPACE_ROOT` to be a list
  of roots instead of a single directory, useful for multi-repo setups.

Each addition should stay a self-contained module + registry entry, keep the same
path-safety and timeout/output-cap conventions as the existing tools, and get its
own unit tests.

## Phase 3: Real-time voice + face interaction mode — 🚧 in progress / MVP built

**Status: an MVP of the always-on client described below has been built** at
[`apps/desktop-client`](apps/desktop-client) (Electron + TypeScript). See its
[README](apps/desktop-client/README.md) for setup and a full list of
limitations. Summary of what's real vs. still future work:

**Implemented in the MVP:**
- An always-on Electron desktop app, separate from the MCP server, as
  described in this roadmap.
- Continuous speech-to-text via Chromium's `webkitSpeechRecognition`, with a
  live transcript shown in the window.
- Text-to-speech via `SpeechSynthesis` for spoken replies.
- A camera-based **presence heuristic** (frame-difference + variance
  analysis on downsampled video) showing "detected" / "no motion" / "camera
  off" — explicitly a lightweight stand-in for real face recognition, not a
  trained model.
- A small regex-based command router that maps a handful of spoken phrases
  ("list files", "search code for X", "read file X", "git status", "run
  tests") to **real** Cedar Tree tool calls, executed in-process against the
  same compiled tool modules the MCP server uses, with results spoken back
  and logged in the UI.
- A portable Windows build via `electron-builder` (`npm run dist:win`).

**Still future work (not in the MVP):**
- **Real face recognition/identity**, not just motion presence — e.g.
  `face-api.js` with a downloaded model, or the browser's experimental Shape
  Detection API, to actually detect/recognize a face rather than infer
  "something moved in frame."
- **Wake-word detection** so the app can listen passively instead of
  requiring a manual "Start listening" click.
- **Full NLU** instead of fixed regex phrase matching, so arbitrary spoken
  requests can be routed to the right tool (or to a live Copilot/agent
  session) rather than only the handful of hardcoded phrases above.
- **Multi-turn conversation memory** — today each spoken command is handled
  completely independently; there's no session/context carried between
  utterances.
- **Streaming/incremental TTS and barge-in** (interrupting a spoken reply by
  talking over it) for a more natural back-and-forth.
- Tighter integration with an actual live Copilot/agent chat session, rather
  than the MVP's fixed command router, once such an integration point/API is
  available.

The original problem statement and rationale for why this needs a *separate*
client app (rather than more MCP server tools) are preserved below.

**This is out of scope for the current MCP server and requires a separate,
always-on client application** — not just additional MCP tools — because:

- An MCP server is invoked synchronously by an MCP *client* (VS Code, Visual
  Studio) in response to model tool calls; it has no independent event loop for
  continuously listening to a microphone or camera feed.
- Speech-to-text, text-to-speech, and camera-based face recognition all need
  persistent access to OS-level audio/video devices, background processing, and a
  UI (e.g. a system-tray app, overlay, or companion window) — capabilities that
  don't fit the request/response MCP tool-call model.

### Rough architecture sketch

```
┌─────────────────────────────┐        ┌────────────────────────────┐
│  Cedar Tree Voice/Face App  │        │   Cedar Tree MCP Server    │
│  (new, separate, always-on) │        │ (this repo, unchanged core)│
│                              │        │                            │
│  - Mic capture → STT engine │  MCP   │  - read_file / write_file  │
│  - Camera capture → face    │◄──────►│  - search_code             │
│    recognition / presence   │ stdio  │  - run_shell / run_tests   │
│  - Wake-word / push-to-talk │  or    │  - git_ops                 │
│  - TTS playback of replies  │  SSE   │  - web_search / web_fetch  │
│  - Talks to Copilot/agent   │        │                            │
│    session (this server's   │        │                            │
│    tools, or a chat API)    │        │                            │
└─────────────────────────────┘        └────────────────────────────┘
```

Key pieces the client app would need:

1. **Audio pipeline**: microphone capture → streaming speech-to-text (e.g. a local
   Whisper model or a cloud STT API) → transcript handed to the agent as a prompt.
2. **Video pipeline** (optional/privacy-gated): camera capture → lightweight face
   presence/recognition (e.g. to know *who* is talking or whether the user is even
   present) — this should be opt-in, locally processed where possible, and never
   silently always-on.
3. **Turn-taking / wake logic**: push-to-talk or wake-word detection so the mic
   isn't transcribing everything constantly.
4. **Output pipeline**: text-to-speech to read agent responses aloud, plus optional
   visual feedback (captions, an avatar, or a simple status indicator).
5. **Bridge to the agent**: the client app would connect to the same Copilot/agent
   session (or drive Cedar Tree's MCP tools directly for simple confirmations),
   most likely via whatever session/streaming API the surrounding product exposes,
   not by reinventing MCP transport for audio.
6. **Privacy/safety controls**: explicit mic/camera on-off indicators, local-first
   processing where feasible, and no persistent recording without consent.

This phase's MVP lives at [`apps/desktop-client`](apps/desktop-client) inside
this repo as a standalone npm project (its build step copies the MCP
server's compiled `dist/` output into its own bundle rather than depending on
it via npm workspaces, to keep `electron-builder` packaging isolated) rather
than a separate repository, since that still made it straightforward to
import the MCP server's compiled tool modules directly in-process. It still
has a fundamentally different runtime model (long-lived, device-attached,
UI-driven) from the server's on-demand, stdio, request/response tool model —
see its README for details.

## Phase 4: Global MCP registration & Copilot autopilot pickup

**Status: done.** [`scripts/install-global-mcp.ps1`](scripts/install-global-mcp.ps1)
registers Cedar Tree once for the current Windows user, so it's available to
Copilot agent/autopilot mode in every VS Code workspace and Visual Studio
solution without per-project `.vscode/mcp.json` setup. It merges a
`cedar-tree` entry into VS Code's global `%APPDATA%\Code\User\mcp.json` and
Visual Studio's global `%USERPROFILE%\.mcp.json`, is idempotent (safe to
re-run), and preserves any other MCP servers already configured in those
files. See the root [README](README.md#registering-cedar-tree-globally-one-time-all-workspaces)
for usage.
