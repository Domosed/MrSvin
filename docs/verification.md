# Source export verification

Checked on Windows x64 on 2026-10-12 with Node 26.4.0.

| Check | Result |
| --- | --- |
| Dependency installation | Passed; root and desktop service installed independently |
| ESLint and TypeScript/Vite build | Passed |
| Desktop service tests | 114 passed, 2 skipped |
| Asset-delivery tests | 8 passed, 1 skipped |
| Standard skill Python tests | 8 passed, with mocked provider behavior |
| Template checks | Four cards, 177 images, 8 videos, 20 shared skills; no missing sample assets |
| Codex/Claude skill parity | 375 files identical |
| Public-source checks | Passed; empty connections and key examples, separate native identity and retained licenses |
| Browser preview | Four cards, 16 steps, game navigation and failed-module recovery passed |
| Upstream desktop UI suites | All eight passed: UI, links, scroll, History, theme, voice, mobile and Workspace edits |
| Local patch UI suites | Menu, History deletion and request marks passed |
| Fork setup-card review | Rendered at 1440, 768 and 390 px; build commands and source-only instructions visible without document overflow |
| Private-data export review | No owner-specific context, private Workspace folders, chat state, saved settings or account files imported |

The standard Dev card's setup tab was adapted to this source-only fork. The
other starter cards and their media come from the public upstream tree.
Generated builds, dependency directories, browser profiles, test state, logs
and local report-serving junctions are excluded from the source export.

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
