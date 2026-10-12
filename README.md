# MrSvin Workspace

A source fork of [Mr. Mak Workspace](https://github.com/witnesstodark/mr-mak-workspace)
with eight application patches. It keeps the two desktop windows, real CLI
agent terminals, Workspace reports and optional mobile access through Tailscale.

The UI calls the assistant **Mr. Свин**. The Talk coordinator and voice companion
answer in Russian by default. Workspace reports, interface controls and chat
titles remain English unless an output language is explicitly requested.

This repository contains **source code only**. There is no prebuilt installer,
bundled account, model API key or saved conversation. Its four example cards are
the public upstream samples: My Dream Game, Creative MCP Connections, Make
Workspace Yours and Arachne Character Lab.

## What the patches add

- Claude and Codex usage meters, reset times and provider usage links.
- One desktop notification when a heavily used limit resets.
- Ctrl+click web links in the desktop app to open an alternate browser.
- The Mr. Свин interface identity.
- Russian coordinator, voice instructions and quick-command replies.
- A Chats menu that saves conversations before a confirmed app restart.
- History deletion, with an optional separate confirmation for the local CLI copy.
- Yellow question/permission marks while an agent needs the owner's input.

See [PATCHES.md](PATCHES.md) for the behavior, constraints and tests of each patch.
Mobile access and the upstream 0.5.1 Workspace card controls are retained.

## Set up from source

Install at least one of Codex CLI, Claude Code CLI or OpenCode and configure
your own account. The CLIs are separate products and are not installed by setup.
For a browser preview, install Node.js 22.20 or newer. A complete Windows desktop
build also needs stable Rust with the MSVC toolchain, Microsoft C++ Build Tools
and WebView2. See [the setup guide](docs/getting-started.md).

From the repository folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Preview
```

Preview shows reports in a browser. For the full desktop app:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Desktop
```

Desktop mode builds a local package under `src-tauri/target/release/bundle/nsis`.
Install that package yourself, then open **Start MrSvin.cmd**. Setup does not
install, close or restart a running application.

MrSvin uses the native identifier `com.mrsvin.workspace`, the executable
`mrsvin-workspace.exe` and the Windows install folder `%LOCALAPPDATA%\MrSvin Workspace`.
Its native app settings and shortcuts are separate from Mr. Mak. Compatibility
names such as `.mrmak`, `MRMAK_*` and `mrmak:*` remain internal protocol names;
the repository starts with no runtime state in `.mrmak`.

## Optional connections

Typed CLI chats use your own CLI account. Copy `.env.example` to an ignored
`.env` only when you choose to configure an optional connection.

- Desktop live voice uses your own OpenAI API key.
- Mobile dictation uses your own OpenRouter or OpenAI API key and is billed separately.
- Mobile access uses Tailscale on the computer and phone, a QR code and desktop
  confirmation. Start from the phone button in Chats. See [mobile access](docs/mobile-access.md).
- Alternate browser links use Floorp when present, or `MRMAK_ALT_BROWSER`.

## Verify changes

```powershell
npm ci
npm run lint
npm run test
npm run test:template
npm run test:public
npm run build
npm run test:preview
npm run desktop:test:ui
npm run desktop:test:patches:ui
```

Windows UI tests use an isolated Edge profile and fake chats. They do not delete
real conversations, configure Tailscale, restart the installed app or make paid
model requests. Shared skills live in `.agents/skills`; keep their full Claude
copies synchronized with `npm run skills:sync`.

## Share and update

Before publishing, run `npm run test:public` and review the actual staged files.
Keep local credentials, private cards, settings, native histories and generated
outputs out of Git. See [sharing](docs/sharing.md) and [updating](docs/updating.md).

The upstream base is recorded in [SOURCE.json](SOURCE.json). No remote is
configured by this source export; add your own GitHub remote when you are ready.

## Attribution and licenses

MrSvin is an independent fork, not an official release of Mr. Mak or an agent
provider. The repository's existing [Apache 2.0 license](LICENSE) is retained.
The upstream Mr. Mak code and examples retain their
[original MIT license](LICENSE.upstream-MIT) and copyright notice. See
[NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md).
