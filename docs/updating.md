# Update MrSvin

MrSvin is a source fork. Updating the repository does not update an installed
native app by itself. Keep the code, Workspace content and local runtime state
as separate concerns.

## Bring in fork changes

1. Save or commit the local files you mean to preserve, including untracked work.
2. Fetch and merge from your configured fork remote. Do not reset a customized
   clone to a template to obtain an update.
3. Resolve changes using [PATCHES.md](../PATCHES.md). Review retained upstream
   features as well as every local patch.
4. Run `npm ci`, lint, service tests, template/public checks and the build.
   Then run the desktop UI and patch UI suites from the README.
5. Build the native app with `Setup.ps1 -Mode Desktop` when the native application
   or its bundled runtime needs updating.
6. Tell the owner when closing/restarting is required. Let active tasks finish
   and let the owner choose Quit; do not close their app from an agent process.
7. The owner runs the newly built local installer and starts MrSvin again.

An agent chat inside the app ends when the app quits. Finish the foreground
answer first, record a clear handoff, and let the owner reopen the saved chat.
Saved conversations still depend on their native CLI histories. A compiled
package is not proof that it has been installed.

## Merge upstream deliberately

The upstream base and version are in [SOURCE.json](../SOURCE.json). This source
export starts in the owner's existing independent Git history. If you need
upstream comparison, add a separate `upstream` remote pointing to
`https://github.com/witnesstodark/mr-mak-workspace` and review its changes in an
isolated checkout. Do not use an unrelated-history merge that overwrites the
fork's application identity or starter/user content without review.

Keep `com.mrsvin.workspace`, `mrsvin-workspace.exe`, the MrSvin launch script,
notification identity, native shortcuts and Rust/package lockfile names aligned.
An upstream Mr. Mak installer is a different application and does not install
MrSvin. Internal `.mrmak` and `MRMAK_*` names are intentionally compatible.

## Preserve local work

Keep `.env`, `.mrmak`, CLI sign-ins, private cards, settings and runtime receipts
out of public commits. Do not copy another owner's workspace into this fork.
When editing shared skills, change `.agents/skills` and run `npm run skills:sync`.
