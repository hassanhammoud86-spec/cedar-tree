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

## Phase 3: Real-time voice + face interaction mode

The long-term vision for Cedar Tree is a mode where a developer can talk to (and be
seen by) their AI assistant live — speak a request, see/hear it acknowledged, and
have it drive the same MCP tools this server exposes today.

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

This phase would likely live in a **new sibling project** (e.g. `cedar-tree-voice`)
rather than inside this MCP server, since it has a fundamentally different runtime
model (long-lived, device-attached, UI-driven) versus this server's on-demand,
stdio, request/response tool model.
