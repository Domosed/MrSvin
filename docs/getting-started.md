# Set up MrSvin from source

MrSvin is a source fork of Mr. Mak with the patches listed in
[PATCHES.md](../PATCHES.md). This repository does not include a prebuilt executable
or installer. Nothing from another owner's accounts, saved settings, chats or
private Workspace is included.

## Choose your route

Install and sign in to at least one supported agent CLI using its official setup:

- [Codex CLI](https://developers.openai.com/codex/cli)
- [Claude Code CLI](https://code.claude.com/docs/en/setup)
- [OpenCode](https://opencode.ai/docs/)

The optional Talk coordinator requires Codex specifically. A signed-in CLI can
use its own subscription; optional voice and dictation have separate API billing.

Run setup from the complete cloned repository. The folder must contain
`workspace/workspace.json`. It contains four public upstream sample cards;
replace them with your own work after reviewing the examples.

### Check prerequisites

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Check
```

This reports available tools. It does not install software, sign in to accounts,
connect MCP servers or change global configuration.

### Browser preview

Install [Node.js](https://nodejs.org/en/download) 22.20 or newer, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Preview
```

Setup installs the frontend and local-service dependencies and starts Vite.
The browser preview displays reports; real terminal chats, voice and phone
pairing belong to the desktop app.

### Windows desktop

In addition to Node.js, install stable Rust with the MSVC toolchain,
Microsoft C++ Build Tools and WebView2 as described in
[Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).
Then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Desktop
```

Setup builds the native app and a local installer. The installer is under
`src-tauri/target/release/bundle/nsis`. Run it yourself, then double-click
**Start MrSvin.cmd** in this repository. The app opens Chats and Workspace as
separate windows and starts with normal agent permission prompts enabled.

MrSvin's application identifier is `com.mrsvin.workspace`; its Windows install
folder is `%LOCALAPPDATA%\MrSvin Workspace`. It does not use Mr. Mak's native
app settings. Per-repository runtime state is generated locally in the ignored
`.mrmak` folder. Do not copy someone else's `.mrmak` or agent login files.

To ask an agent to help:

> Set up this MrSvin source fork. Read AGENTS.md, docs/getting-started.md and
> PATCHES.md. Clarify the setup route before changing anything. Use my own CLI
> accounts, leave optional paid connections off, and tell me when I need to
> close or restart an app so I can do it myself.

## Optional features

- [Mobile access](mobile-access.md): install Tailscale on both devices, sign in
  to the same account, then use Chats > phone button > Enable & show QR code.
- Usage: values appear after a signed-in Claude or Codex reply. The app preserves
  an existing user-defined Claude status line.
- Voice/dictation: copy `.env.example` to `.env` and add your own key only when
  requested. Do not commit `.env`. Typed chats do not require a transcription key.
- Alt-browser links: set `MRMAK_ALT_BROWSER` in `.env`, or install Floorp.

For another computer, clone this source and set up the tools and accounts again.
Native CLI conversations and per-machine settings do not travel with Git.
