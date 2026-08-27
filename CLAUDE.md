# wsm_security — Project Instructions for Claude

This file orients any Claude session working in this repo. Read it before touching code.

## What this project is

`wsm-security` is a Zoho Catalyst serverless app for the **WSM Security team** (part of ManageEngine's WSM department, which owns multiple products). It started as a credentials vault and is being grown into that team's **common management dashboard / workspace**: task management, internal tool coordination, and credential storage used to integrate the team's internal tools via their APIs.

- Catalyst project: `wsm-security` (project ID `47976000000083005`, env `Development`, ID `60073792083`)
- Base URL: `https://wsm-security-60073792083.development.catalystserverless.in`
- GitHub remote: `https://github.com/praveenkumar-pv-8915/wsm_security.git` (**public** repo — see Security Notes)

## Architecture — active vs legacy

There used to be two parallel backend implementations; only one remains.

- **`functions/welcome/`** — the currently-deployed Catalyst function (`catalyst.json` at repo root targets `"welcome"`, stack `node18`, type Advanced I/O). This is the active backend. It has:
  - `index.js` — Express app, mounted under `/server/welcome/`, gated by Catalyst's built-in user auth (`catalystApp.userManagement().getCurrentUser()`), admin-scoped Catalyst SDK calls with app-layer `owner_id` checks.
  - `credential-service.js` — Credential Vault CRUD against the `credentials` DataStore table. Secrets encrypted with AES-256-GCM before they touch DataStore.
  - `oauth-service.js` — OAuth connection handling against Zoho accounts (multi-DC), for `oauth_connections` table. Looks like the foundation for connecting external/internal tool APIs.
  - `auth-ui.js` — server-rendered dashboard shell.
  - The React app in `frontend/` (Vite) is built to `frontend/dist` and served as the Catalyst client; it currently only implements the Credential Vault UI (add/reveal/deactivate credentials).

- **`backend/` was deleted on 2026-08-10** (user decision: dead code, superseded by `functions/welcome/`). Its draft DataStore schema (`creators`, `tasks`, `hacksaw_credentials`, `user_credentials`, `credential_audit_logs`) remains useful prior art for the task-management and audit-logging modules — recover it from history with `git show 0cac67c:backend/catalyst.json` (last commit before deletion). The legacy helper scripts `start-backend.sh` and `setup-local.sh` went with it.

Treat `functions/welcome` + `frontend` as the thing that's actually running.

## Deployment

- **The working deploy path is the local Catalyst CLI** (`catalyst deploy`, v1.27+ installed on this Mac and logged in as praveenkumar.pv@zohocorp.com) — reached through the `catalyst-cli` MCP server described below, not by shelling out to it directly. It is driven by `.catalystrc` and `catalyst.json` (`functions.targets: ["welcome"]`, `client.source: "frontend/dist"`). A CLI deploy also injects `CRED_ENC_KEY` from the *local* `functions/welcome/catalyst-config.json` (see Security notes) — the committed version deliberately omits it, so the CLI from this machine is the only deploy path known to configure the key correctly.
- **Catalyst's GitHub auto-deploy on push to `main` is NOT confirmed working** (verified 2026-08-07: 20+ minutes after a push, the live function still served old code; a CLI deploy is what landed it). Don't assume a push deployed anything — deploy with the CLI, then verify against the live URL.
- **Client deploy quirks** (learned 2026-08-07): Catalyst requires `client-package.json` inside the client source (`frontend/dist`). It lives in `frontend/public/` so every Vite build copies it in. Its `name` must be exactly `wsm-security-frontend` (Catalyst 400s on anything else), and its `version` must strictly increase on every client deploy — bump it or the client deploy is skipped with a 400.
- `.github/workflows/deploy.yml` only build-validates (`functions/welcome` + `frontend`); it never deploys.
- **Deploy through the `catalyst-cli` MCP server — that is the preferred path, ahead of raw CLI
  commands.** It lives in this repo at `mcp/catalyst-cli/` and shells out to the `catalyst` binary
  installed and logged in on this Mac, with `cwd` = repo root so `.catalystrc` and `catalyst.json`
  apply. See `mcp/catalyst-cli/README.md` for the full tool table. In short:
  - `catalyst_deploy` — the one to reach for. Wraps `.claude/skills/deploy/deploy.sh`: detects
    changed targets, bumps `client-package.json`, builds the client, refuses to deploy `welcome`
    without `CRED_ENC_KEY`, deploys, curls the live endpoints, then pushes (never force). Pass
    `dryRun` first when the target set isn't obvious, and `--no-push` semantics when the work
    isn't committed yet.
  - Read-only: `catalyst_whoami`, `catalyst_project_list`, `catalyst_apig_status`.
  - Data: `catalyst_ds_export` / `catalyst_ds_import` / `catalyst_ds_status`. `ds_import` **writes
    rows** — confirm with the user first. `catalyst_pull` with `overwrite` can clobber local files.
  - Deliberately not exposed: `login`/`logout`/`token:*`, `functions:delete`, `client:delete`,
    `project:reset`, `iac:import`, `serve`, `init`. Don't work around those by shelling out.
  - There is no Catalyst CLI or API for function **logs** — read them in the console.
- **The MCP is registered in `.mcp.json`, which is a Claude Code, repo-scoped mechanism.** It is
  picked up by a Claude Code session started inside this repo. It is **not** visible to a Cowork /
  desktop-app session reaching this Mac over the device bridge, and it is not visible to a session
  that started before `npm install` was run in `mcp/catalyst-cli/`. A session that can't see the
  `catalyst-cli` tools should say so plainly rather than improvising — the fallback is to ask the
  user to run `.claude/skills/deploy/deploy.sh` themselves.
- **Why a cloud session can't just run the CLI itself**: `device_bash` reaches this Mac only through
  an isolated Linux VM that mounts the connected folders. It has network, but no `zcatalyst-cli` and
  none of the Mac's Catalyst login state, so `catalyst deploy` cannot run there. Never install the
  CLI into the user's mounted folders to get around this. When a change needs deploying and the MCP
  isn't reachable: make the change, write it back via the device bridge, and hand the deploy to the
  user.
- To verify a UI change is actually live, use the Claude-in-Chrome browser tools against the base URL above rather than assuming a deploy worked.

## Git

- Read/write access to the repo works for **local, offline git operations** (status, log, diff, local commit) via the device bridge.
- **Pushing works over SSH, not HTTPS** (verified 2026-08-07): there are no HTTPS credentials on this Mac (no keychain `github.com` entry, no `gh` CLI/`~/.git-credentials`/token env — HTTPS push fails with `could not read Username`). The account-level SSH key is `~/.ssh/id_ed25519`, passphrase-protected with the passphrase in the login Keychain. In a non-interactive session, run `ssh-add --apple-load-keychain` first (loads the key without prompting), and make sure the remote is the SSH URL (`git@github.com:praveenkumar-pv-8915/wsm_security.git`). `~/.ssh/config` routes `github.com` via `ssh.github.com:443`.

## Security notes (remediated 2026-08-07 — incident record and standing rules)

The secrets previously flagged here were dealt with on 2026-08-07:

1. **Leaked Zoho repo credential — rotated and scrubbed.** `review_request_local.md` (plaintext username/password, introduced in commit `74312e8`) was accidentally pushed to the public repo on 2026-08-07 at 12:08 IST. The password was rotated the same day, and the file was rewritten out of all git history with `git filter-repo` (along with committed zip artifacts and `npm-debug.log*` files). **Check before assuming the remote is clean**: if `git ls-remote origin main` doesn't match local `main`, the rewritten history hasn't been force-pushed yet — `git push --force origin main` (needs the user's auth, see Git section) is the outstanding step. GitHub may keep pre-rewrite commits fetchable by direct hash until GC or a support-ticket purge; residual risk is low because the password is rotated.
2. **`CRED_ENC_KEY` (the AES-256-GCM vault master key) was never in git history** — an earlier version of this file overstated that. The key exists ONLY in the local working copy of `functions/welcome/catalyst-config.json`, which has `git update-index --skip-worktree` set so the edit is invisible to git and can't be committed by accident. Do not clear that flag or commit the key. If that file ever needs a committed change: `git update-index --no-skip-worktree` it, make the change *without* the key, commit, restore the key locally, re-set the flag. The better long-term home is Catalyst's console/CLI env config.

Standing rules going forward:

- `.gitignore` ignores `*.zip` globally; use `git add -f` to include an archive deliberately.
- The legacy `backend/functions/server/.env` and `backend/.credentials/` (local-only secrets/DBs, gitignored) were deleted on 2026-08-07 at the user's request. The legacy OAuth client secrets are recoverable from the Zoho API console if `backend/` ever gets reconnected.
- Never commit real credentials anywhere in this repo — the remote is public. Reference env vars in committed config; real values go in gitignored/local files or Catalyst env config only.

## Operating rules for this project (from the user)

- **If the user's message is just a question, answer it — do not start implementing.** Only build/change things when explicitly asked to.
- Claude may read local files under `~/otherProducts/` and `~/LOG360CLOUD/` when asked, for cross-project context.
- Prefer checking real behavior (browser check against the deployed URL, actual git/CLI output) over assuming a change worked.

## DataStore conventions (standing rule — 2026-08-27)

**All application column names are UPPERCASE_SNAKE_CASE.** Decided 2026-08-27 when the
`task_manager` and connections tables were added; applies to every table created from here on.

- App columns: `SERVICE_KEY`, `DUE_DATE`, `IS_ARCHIVED`, `ASSIGNEE_ID` — uppercase, words separated by
  underscores.
- Catalyst's own system columns are already uppercase and are auto-created: `ROWID`, `CREATORID`,
  `CREATEDTIME`, `MODIFIEDTIME`. Never create these, and never write to `ROWID`/`CREATORID`.
- Secret-bearing columns use the native **`encrypted text`** data type (as `credentials.credential_value`
  does), on top of the app-level AES-256-GCM in `crypto-util.js`. Defence at rest in both layers.
- Dates that only need day precision are stored as `varchar` `'YYYY-MM-DD'` — string ordering sorts
  correctly and it sidesteps ZCQL date/timezone handling. Use `datetime` only when time of day matters.
- Table names stay lowercase snake_case (`task_activity`, `connection_credentials`). Catalyst allows
  alphanumerics and underscores, no leading digit.

**Legacy exception:** the original `credentials` table predates this rule and still uses lowercase
(`credential_name`, `credential_type`, `credential_value`, `owner_id`, `is_active`). Renaming it is
feasible but console-only — see "Renaming DataStore columns" below.

### Renaming DataStore columns

Verified against the Catalyst docs 2026-08-27:

- **Column Name IS editable** after creation (Data Store → table → Schema View → ellipsis → Edit).
  What cannot be changed: Column ID, Data Type, IsUnique.
- **There is no API, SDK or CLI to rename a column.** Console-only and manual, which means it must be
  repeated by hand in development and production — it cannot be scripted or replayed.
- **The docs never promise that row data survives a rename.** Prove it on a dev table with test rows
  before touching a table that matters.
- ZCQL and the row APIs address columns **by name**, so a rename breaks every query referencing the
  old name. Code and console rename must ship together, in that order: rename in console, then deploy
  the matching code — deploying first breaks the live app.
- ZCQL case-sensitivity is **not documented**. Treat a casing-only rename as risky and test it.
- Fallback if data is lost on rename: add the new column → CLI export to CSV → rewrite the header →
  CLI import in `update` mode with `find_by=ROWID` → delete the old column. Note `UPDATE t SET a = b`
  (column-to-column) is *not* documented in ZCQL; use the CSV route.
- Dev-environment ceilings: 100 columns per table, 5,000 rows per table, 25,000 rows per project.

### No-PII identity (2026-08-27 decision)

There is **no `members` table**. Identity is always the Catalyst-issued `user_id`, never email:
`credentials.owner_id`, `connection_credentials.OWNER_ID`, `tasks.ASSIGNEE_ID`/`REPORTER_ID`,
`task_activity.ACTOR_ID` all store `user_id`. Display name and role are read live from the Catalyst
session / `userManagement()` API each request, never persisted. Email is used for exactly one thing
in `auth.js` — confirming the session's email ends in `@zohocorp.com` — and is never stored, logged,
or returned. See the project KB (`claude/datastore-conventions.md`) for the full rationale.

### Fail-closed auth gates

`functions/welcome/auth.js` and `functions/task_manager/auth.js` deny on any exception. If a request
returns `403 "Authorisation check failed"` rather than `403 "Access restricted to @zohocorp.com
accounts"`, the auth middleware itself **threw** — historically a missing table or mismatched column
name from the old `members`-table design — not a real authorisation decision. Check the function
logs at level `error` for the underlying exception message.
