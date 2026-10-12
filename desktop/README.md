# Desktop architecture

The desktop app is a Tauri 2 shell around two webviews. It starts one local Node
service, binds it to loopback and gives each window the authenticated local URL.
Workspace renders the React UI and report files. Chats renders real PTYs through
xterm.js. The windows share sessions and settings but minimize independently.

| Path | Responsibility |
| --- | --- |
| `src/` | React Workspace, document previews, files, chat and voice UI |
| `desktop/service/` | HTTP/WebSocket service, PTYs, session history, tools, voice connection |
| `src-tauri/src/` | Cross-platform shell integration plus Windows taskbar identities, native drag and optional system shortcut |
| `workspace/workspace.json` | Card registry |
| `workspace/_shared/` | Report CSS, image viewer and Help |
| `.mrmak/` | Local runtime state; ignored by Git |

`npm run desktop:build` runs `desktop/prepare.mjs`, builds the React frontend,
packages the service with a Node executable and production dependencies, then
builds the Tauri executable and platform installers. On Linux, use
`npm run desktop:build:appimage` for the distributable AppImage. The recipient
selects their own repository; its content is served from disk rather than baked
into the installer.

The service runs CLIs as the current user. Their available files and permissions
follow their launch options and native account settings. Permission bypass is
off by default. Do not expose the local service as a public web server.

The optional voice frontend uses OpenAI Live. Routine actions call local tools;
the Codex app-server coordinator handles broader orchestration with the user's
configured model. Larger execution tasks go to visible worker terminals. The
provider's native conversation ID is recorded when available for later resume.
Codex discovery checks both local and UTC date folders, keeps waiting through
delayed first prompts, and reads bounded metadata records larger than one small
buffer. Closing or resuming a tab can recover a missing ID from its exact Mr. Mak
origin marker. Shared working directories alone are not proof of ownership.

New Codex and Claude chats default to `xhigh`; explicit saved effort choices are
preserved. Terminal URLs and OSC 8 links use xterm link handlers. New-window
requests from both app windows open HTTP(S) links through the Windows default
browser association, while the current app view stays open.

Ctrl+click sends the link to `POST /api/open-link` instead, and `links.mjs`
opens it in the alternate browser: `MRMAK_ALT_BROWSER` from `.env` (a path or a
command on `PATH`), otherwise Floorp from its usual install folders. On Windows
the service runs in the app's process job, which ends every child on quit, so
the browser is started through the Explorer shell and stays open afterwards.
Reports are served from the content origin without the service token; their
prelude posts the link to the app window, which accepts it only during the
click's user activation. If no alternate browser starts, the link opens in the
default browser.

The Usage button in Chats reads subscription limits that Claude Code
passes to its status line. Claude chats start with `--settings` pointing to
`.mrmak/claude-statusline-settings.json`; its `claude-statusline.mjs` command
saves the 5-hour, weekly and spend-limit windows to `.mrmak/claude-usage.json`
and prints a short summary row. No credentials are read and no Anthropic API
is called. A `statusLine` configured in the user's or project's Claude settings
takes precedence, so Mr. Mak then leaves it unchanged and shows no usage.

Codex limits need no launch change: Codex saves `rate_limits` with every reply
in its session files, and `codex-usage.mjs` reads the newest record from the
sessions started in the last eight days under `CODEX_HOME` (default
`~/.codex`). The files are only read, and chats started outside Mr. Mak count
too. No credentials are read and no OpenAI API is called.

The running app checks both every 30 seconds. When a window that was at least
80% used passes its reset time, `usage.mjs` shows a desktop notification, once
per window; `.mrmak/usage-alerts.json` remembers the announced resets across
restarts.

A chat that waits for its user carries a mark on its icon: "?" for a question,
"!" for a permission. `requests.mjs` keeps the open requests of each chat.
Claude Code writes a tool call to its transcript only after the tool finishes,
so the `--settings` file of a Claude chat also registers a `PermissionRequest`
hook, which Claude Code runs for permission prompts and for the question
dialog. Its `claude-request-hook.mjs` command appends the tool's name to
`.mrmak/claude-requests/<chat id>.jsonl`, the file named by
`MRMAK_CLAUDE_REQUESTS`. It makes no decision, prints nothing and does not keep
the tool input, and the user's own hooks keep running. A folder with its own
status line gets the hook through `.mrmak/claude-hooks-settings.json`. Codex
records a `request_user_input` call in its session file as it asks, and that
record is the signal. Codex permission prompts are not detected. A final answer
that ends with a question mark shows "?" in place of the unread dot.

Fullscreen Claude scrolls its own conversation. Terminal snapshots preserve
both mouse tracking and the requested SGR encoding, including saved screens,
so switching tabs or reconnecting does not disable its mouse wheel. Classic
Claude and Codex continue using local terminal scrollback.

## OpenCode terminals

The service detects installed OpenCode 1.x or 2.x and launches its real TUI.
OpenCode owns model choice, provider authentication and reasoning configuration.
The optional `--auto` flag keeps OpenCode's explicit permission denials intact.

`desktop/service/opencode/` contains dependency-free event observers for both
plugin APIs. A per-process inline configuration adds the matching observer while
preserving configured plugins, models and providers. No global config is edited.
OpenCode 2.x uses `--standalone` to isolate the server for each managed terminal.

Observers save only a native session ID, launch identity and activity/completion
metadata under `.mrmak/`. They do not save prompts or provider credentials.
Root-session identity is captured from an actual native event, not inferred from
a shared working directory. Resume passes `--session` with that recorded ID.
A launch-specific marker prevents stale events from changing a new terminal's
activity. Native CLI history must remain on disk for conversation restoration.

## Checks

```powershell
npm ci
npm run lint
npm test
npm run test:template
npm run build
npm run desktop:test:ui
npm run test:preview
```

The root install also installs the locked `desktop/service` dependencies. If
you deliberately use `npm ci --ignore-scripts`, run
`npm --prefix desktop/service ci` before tests or the local service.

UI tests use an isolated repository and fake terminals. Edge must be available
on Windows, or set `MRMAK_TEST_BROWSER` to a Playwright browser channel you have
installed. Live voice and subscription smoke checks are separate scripts with
explicit opt-in flags; they are never part of the default test command.

OpenCode has a separate no-account integration test against a local mock model:

```powershell
node desktop/service/test-opencode-native.mjs --binary C:\path\to\opencode.exe --tui
```

It isolates the CLI's home and data directories, verifies two separate native
histories, then closes and resumes a real terminal. Tested with OpenCode 1.18.3
and 2.0.21 on Windows. No paid model calls are made.

Windows x64 and Linux are supported native targets. macOS remains a future target;
the shared platform boundary avoids making Linux behavior a prerequisite for it.
