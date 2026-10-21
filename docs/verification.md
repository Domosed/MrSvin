# Source export verification

Checked on Windows x64 on 2026-10-21 with Node 26.4.0, after merging upstream
0.6.0 (`fbb4004`) and adding patches 9 and 10.

| Check | Result |
| --- | --- |
| Dependency installation | Passed; root and desktop service installed independently |
| ESLint and TypeScript/Vite build | Passed |
| Desktop service tests | 224 tests: 214 passed, 7 skipped by platform, 3 failed (see below) |
| Asset-delivery tests | 8 passed |
| Template checks | Passed; four cards and shared skills, no missing sample assets |
| Codex/Claude skill parity | 375 files identical |
| Public-source checks | Passed: 1,359 files, empty connections and key examples, MrSvin identity for Windows, macOS launcher and updater, retained licenses |
| Updater process checks | Passed; only the MrSvin executable and install folder are matched |
| Browser preview | Passed |
| Upstream desktop UI suites | All nine passed: UI, links, scroll, History, theme, voice, mobile, Workspace edits and editable cards |
| Local patch UI suites | Menu, History deletion, request marks, Claude 2 profiles and the context meter passed |
| Private-data review | No owner-specific context, private Workspace folders, chat state, saved settings, account files or local paths |

The three service-test failures are environment- or timing-dependent upstream
tests, not patch regressions: `conversation-view` expects a project search for
`game` to skip its temporary folder, which failed because the checkout path
contained "GameDev"; `quick-actions` decodes the Codex command as an encoded
PowerShell script although a native `codex.exe` starts directly; and a
`handoff` timing check failed under the full parallel run and passed when run
by itself. The first two fail identically on an untouched upstream checkout on
the same machine.

## Native build limit

Rust and the MSVC C++ build tools were not installed on the verification machine.
The renamed Tauri configuration, Rust package/lockfile, launch script, shortcuts,
notification identity and CI artifact paths were checked for consistency, but
the MrSvin native executable was not compiled or launched. No installer is
included. A future native build must be verified with the prerequisites in the
[setup guide](getting-started.md).

These checks used isolated state and fake chats. They did not restart an installed
application, delete personal CLI histories, configure a Tailscale account or make
paid provider requests. A complete remote-phone test still requires the owner's
own devices and Tailscale sign-in.
