# MrSvin application patches

This source fork is based on Mr. Mak Workspace 0.5.1, commit
`c7c9fbfd0d9c4f961536392fbd50b71ff0b0c528`. The patches below are part of the
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

Tests: `usage.test.mjs`, `claude-usage.test.mjs`, `codex-usage.test.mjs` and `ui.mjs`.
Usage becomes available only after the CLI has recorded it. A missing status
line or native session record is reported as unavailable.

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

## Checks and source-only build limits

Run the checks listed in the README. `desktop:test:patches:ui` includes the three
local UI suites that the upstream aggregate script does not cover. UI checks
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
