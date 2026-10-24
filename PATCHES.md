# MrSvin application patches

This source fork is based on Mr. Mak Workspace 0.6.0, commit
`fbb4004af6eb9226ed8a26518aad78b88406d1b9`. The patches below are part of the
source and are included when the app is built. The repository contains no
previous owner's cards, chat history, account keys or saved settings.

## 1. Claude and Codex usage panel

The Usage button next to New chat opens plan-usage windows, reset times and
links to the provider's usage page. No provider API is called to fetch limits.

- Claude Code supplies rate limits to `claude-statusline.mjs`, configured in
  the settings file passed to chats at launch. `claude-usage.mjs` reads its
  locally saved summary. A status line configured by the user or project wins.
- `codex-usage.mjs` reads the newest limits recorded in local Codex session files,
  including conversations started outside the app. It does not read login keys.
- `usage.mjs`, `UsagePanel.tsx` and `/api/usage` provide the panel.

- Codex itself shows how much of a limit is left, so its meters give both
  figures, for example `70% used · 30% left`; Claude keeps the used figure.
- Codex thread IDs are UUIDv7, whose first 48 bits are the start time that names
  the rollout folder. The open Codex chats' IDs (`CodexUsage.threads`, set in
  `server.mjs`) add their folders, so a chat that continues a thread started
  more than a week ago reports the current limits.

Tests: `usage.test.mjs`, `claude-usage.test.mjs`, `codex-usage.test.mjs` and `ui.mjs`.
Usage becomes available only after the CLI has recorded it. A missing status
line or native session record is reported as unavailable. The same status line
also records each chat's context window for patch 10.

## 2. Limit-reset notifications

When a usage window that was at least 80% used reaches its recorded reset time,
the app announces it once. `UsageAlerts` checks locally recorded limits every
30 seconds and keeps announced resets in ignored runtime state.

`platform.mjs` provides the platform notification command. Windows uses the
fork's Chats identity, `com.mrsvin.workspace.windows.chats`, registered by the
native shortcut code. Service shutdown stops the watcher.

Test: `usage.test.mjs`. Tests do not send real desktop notifications.

## 3. Ctrl+click opens the alternate browser

Plain web-link clicks use the default browser. Ctrl+click uses Floorp when it is
installed, or the executable named by `MRMAK_ALT_BROWSER` in the local `.env`.
If that browser cannot start, the default browser is used.

The route covers terminal links, Markdown documents, report links and Usage
links. It accepts only HTTP/HTTPS URLs. Reports send a user-activated message
from their isolated content origin; they do not receive the service token.
On Windows, Explorer starts the browser outside the app's child-process job so
it survives app shutdown. Link-specific download handlers keep their behavior.

Implementation: `links.mjs`, `platform.mjs`, `report-chrome.mjs`, `client.ts`
and `TerminalPane.tsx`. Tests: `links.test.mjs` and `links-ui.mjs`.

## 4. Mr. Свин identity

Application UI labels, messages and the assistant display name use **Mr. Свин**.
The mobile UI and manifest keep that identity as well. Native source builds use
the product name **MrSvin Workspace**, executable `mrsvin-workspace.exe`,
identifier `com.mrsvin.workspace`, separate native settings and MrSvin shortcuts.

Internal source/protocol names such as `MakComposer`, `.mrmak`, `MRMAK_*`,
`mrmak:*` and asset filenames remain compatible. Upstream attribution and
licenses keep the original project's name. Do not rename native CLI integrations
or import someone else's settings to achieve the display identity.

After an upstream update, review new visible strings. Keep native product,
shortcut and notification identities aligned. UI tests assert renamed labels.
The macOS launcher is `Start MrSvin.command` and the bundle is
`MrSvin Workspace.app`; `Setup.ps1 -Mode Update` and `scripts/update-helpers.ps1`
look only for the MrSvin executable, uninstall entry and install folder.

## 5. Russian coordinator and voice persona

The Talk coordinator and optional voice companion introduce themselves as
**Мистер Свин** and speak Russian by default. The voice language rule overrides
an older or custom delivery style. Fixed quick-command replies are Russian.
Interface controls, error messages, stored report defaults and chat titles keep
their existing language contract.

Implementation: `coordinator.mjs`, `voice-profile.mjs`, `quick-actions.mjs`.
Tests: `voice-language.test.mjs`, `quick-actions.test.mjs` and `voice-ui.mjs`.
Automated tests use stubs and do not connect to a live model or paid voice API.

## 6. Save all chats and restart

The Chats corner menu offers **Save all chats and restart**. The user confirms
the action; the dialog warns if a chat is still working. The service captures
native conversation IDs, saves screens and settings, then requests a graceful
quit and restart through an Explorer-launched helper. Open conversations resume
when the app returns. An interrupted agent reply does not continue by itself.

Implementation: `AppMenu.tsx`, `app-menu.css`, `sessions.save()`, the authenticated
`/api/restart` route and `restart.mjs`. Only the actual desktop entry point passes
the restart function; test services cannot restart an installed app. The voice
dock clears the mobile, pin, Workspace and menu buttons.

Tests: `restart.test.mjs` and `menu-ui.mjs`. Never call the restart helper with a
real app PID in a test. During an agent-assisted software update, tell the owner
when to close/restart and let them do it; finish an in-app answer before quit.

## 7. Delete History and optionally its local CLI copy

Each History row has a delete button and confirmation. It removes the app's
History entry and saved screen; an open chat is closed first. A separate checkbox,
off by default, can also delete the local Claude/Codex conversation and its prompt
history. OpenCode and Kimi dialogs explain that their own stores remain.

`native-delete.mjs` validates a UUID before creating any path. CLI deletion is
completed before removing the History row, so a failure keeps an entry to retry.
Test services receive a stub; only the desktop entry point can delete native data.
The CLI-history rewrite can race with a concurrent append, so avoid deleting a
conversation while another process is writing the same history file. Local
deletion does not remove data already held by a provider.

Implementation: `HistoryDelete.tsx`, `history-delete.css`, `sessions.delete()`
and the authenticated delete route. Tests: `history-delete.test.mjs` and
`history-delete-ui.mjs`, entirely inside temporary homes with fake sessions.

## 8. Question and permission marks

A tab shows a yellow **?** while its agent needs an answer and **!** while it
needs permission. An open mark replaces the red unread dot. A Codex background
question keeps the working glow beneath the question mark.

- Claude's `PermissionRequest` hook reports a tool name and timestamp to the
  current chat's own temporary file. It makes no permission decision and retains
  no tool input. Existing user hooks remain configured. Confirming keys close a
  permission mark; navigating a question dialog does not prematurely close it.
- Codex question calls and matching outputs are read from native session events.
  Background questions remain until the next user message/turn.
- A final answer ending in a question mark is treated as a question by punctuation
  and cleared when the answer is seen. This is a heuristic.

Implementation: `requests.mjs`, `claude-request-hook.mjs`, `native-events.mjs`,
`sessions.mjs`, `SessionLogo.tsx`, `chatActivity.ts` and `session-request.css`.
Tests: `requests.test.mjs` and `requests-ui.mjs`. Codex permission prompts are not
detected by this patch; global Codex hooks are not installed automatically.

## 9. Second Claude subscription profile

New chat offers **Claude 2** with a blue icon. It runs the same Claude Code CLI
with `CLAUDE_CONFIG_DIR=<workspace state>/claude-2` (normally `.mrmak/claude-2`)
and signs in to its own subscription on first use. The original Claude profile,
its command, credentials and configuration path stay unchanged; neither profile
is copied. Inherited Anthropic/Claude credential and provider overrides are
removed from the Claude 2 launch only.

The profile is stored as the chat's agent and used for launch, resume, native
IDs, effort, activity, transcripts, mobile messages, the Conversation view,
handoffs, message editing, command completion and explicit CLI-history
deletion. Identical native IDs in different profiles never read or delete the
other profile's transcript. Each profile has its own usage files and reset
notices.

Implementation: `claude-profiles.mjs` and profile-aware code in `agents.mjs`,
`sessions.mjs`, `claude-usage.mjs`, `native-events.mjs`, `native-delete.mjs`,
`mobile-transcript.mjs`, `chat-commands.mjs`, `handoff.mjs`, `message-edit.mjs`,
the UI types and pickers. Tests: `claude-profiles.test.mjs` and
`claude-profiles-ui.mjs`. No real login or paid model turn is used.

## 10. Context meter

The header of a Claude, Claude 2 or Codex chat shows how full its context window
is, for example `8 % · 75.9k / 1M`. Its panel lists the usage by category from
Claude Code's `/context` (deferred tools last) and expandable MCP tool, memory
file, skill and agent lists. **Обновить** sends `/context`, a local Claude Code
command that spends no tokens, and waits for its report.

- Claude totals come from `context_window` in the status line data, recorded per
  chat in `<state>/claude-context/<session id>.json` (`claude2-context` for
  Claude 2) only when a value changes. With a user's own status line, the total
  is estimated from the newest reply's token usage and the last report's window.
  `/compact` clears the value until the next reply. A status-line record
  without usage counts as compacted only after a transcript `compact_boundary`;
  a conversation without a reply yet (a new chat, or one just cleared with
  `/clear`, see patch 11) shows no data instead.
- The `/context` report is read from the transcript record Claude Code writes
  for it; the Conversation view already hides such meta records.
- Codex reports only its total, from the newest `token_count` session event.
- Refresh is refused unless the chat runs, the agent is idle, no CLI menu is
  open and the input box holds only the empty prompt, so a draft is never sent.

Implementation: `context-usage.mjs`, `claude-statusline.mjs`, the
`/api/sessions/<id>/context` routes, `ContextMeter.tsx` and `context-meter.css`.
Tests: `context-usage.test.mjs` and `context-ui.mjs`.

## 11. Chats follow /clear and never stay busy after local commands

Claude Code starts a new session ID and transcript on `/clear`. The settings
file passed at launch also carries a `SessionStart` hook with the patch 8
command. `claude-request-hook.mjs` appends the session ID to the chat's own
request file and prints nothing, because `SessionStart` output would enter the
model's context. `Sessions.followClaude` ignores the chat's own ID (startup)
and an ID another chat of the same profile shows, then switches the chat's
native ID and tails the new transcript. The context meter, activity, the
Conversation view and a restart resume follow the cleared conversation.

`nativeActivity` no longer starts a turn for user records that are local
commands (`/clear`, `/effort`, `/model` …), their output, `!` shell commands or
a compaction summary, which Claude Code also writes when it compacts an idle
chat by itself. Those records get no reply and left the chat looking busy.

Implementation: `claude-request-hook.mjs`, `requests.mjs`, `sessions.mjs` and
`native-events.mjs`. Tests: `requests.test.mjs`, `activity.test.mjs` and
`claude-usage.test.mjs`. `node desktop/service/test-clear.mjs --use-cli`
starts the signed-in Claude Code, runs `/clear` without a model turn, checks
that the chat follows the new ID and deletes both conversations.

## 12. Folder buttons at file paths

Files and folders an agent mentions can be shown in Explorer, with the file
selected; a folder opens. Only paths that exist get a button, absolute ones and
ones relative to the chat folder.

- Conversation: answers get a small folder button after links to local files,
  paths in `code` and paths in the text (`pathMentions.ts`, `PathReveal.tsx`).
  The user's own messages and code blocks get none. A backslash before
  punctuation inside a Windows path is kept, which Markdown would otherwise drop.
- Terminal of an agent chat: existing paths are links, and a folder icon sits on
  the first blank cell after each one, past closing punctuation, so it never
  covers text (`terminalPaths.ts`, xterm decorations). OSC 8 `file://` links
  also reveal their file.
- `POST /api/paths/check` reports which of at most 300 paths exist;
  `POST /api/reveal` accepts the chat to resolve a relative path and opens the
  nearest existing folder for a path that is gone.

Tests: `path-reveal.test.mjs` and `reveal-sound-ui.mjs`.

## 13. Quiet tones when a chat finishes or waits

The Chats window plays a soft falling pair of tones when a chat finishes its
turn and a rising pair, twice, when it starts waiting for an answer or a
permission. Several chats at once ring once; chats seen for the first time stay
silent. Settings → Chats turns it off and sets the volume (30% by default), with
previews. The tones are synthesized with Web Audio (`chatSound.ts`); no audio
file is shipped. Test: `reveal-sound-ui.mjs` with a recording Web Audio stub.

## 14. Buttons for the keys of a Codex side thread

A Codex side thread (`/btw`) names its keys in the bottom row: Ctrl+/ to switch,
Ctrl+C to close and F2 to view warnings. Agent chats use Ctrl+C for copy, and
xterm.js sends Ctrl+/ as 0x1F, which ConPTY delivers as Ctrl+Shift+-; a raw 0x03
becomes a console signal. ConPTY requests win32-input-mode, so the buttons under
the terminal send `CSI Vk;Sc;Uc;Kd;Cs;Rc _` key records, as Windows Terminal
does, and a typed Ctrl+/ in a Codex chat is sent the same way. A typed Ctrl+C
still copies. Implementation: `terminalKeys.ts` and `TerminalPane.tsx`.
Test: `reveal-sound-ui.mjs`. A live side thread needs a model turn and was not
part of the automated checks.

## 15. Reasoning effort in New chat

New chat shows Medium, High, XHigh and Max for Codex, Claude, Claude 2 and
Antigravity. The chat starts with that effort, and the last choice is the next
default (XHigh at first). The settings route validates `defaultEffort`.
Test: `effort-ui.mjs`.

## Checks and source-only build limits

Run the checks listed in the README. `desktop:test:patches:ui` includes the
seven local UI suites that the upstream aggregate script does not cover. UI checks
use isolated state, fake agents and temporary browser profiles. The theme UI
suite can time out at the system-theme emulation step; rerun that suite and run
the later voice/mobile/Workspace suites independently if the aggregate stops.

The fork retains only the four public upstream cards and the original twenty
shared skills. `test:template` checks media closure and skill parity;
`test:public` checks source-distribution invariants and empty connection/key
examples. Review staged files before any public commit or release.

A frontend/service build is not a native desktop build. Rust/MSVC build tools
are required to verify the newly branded native binary. No installer or native
binary is supplied with this source export.
