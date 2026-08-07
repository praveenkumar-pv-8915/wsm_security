# wsm_security — Project Instructions for Claude

This file orients any Claude session working in this repo. Read it before touching code.

## What this project is

`wsm-security` is a Zoho Catalyst serverless app for the **WSM Security team** (part of ManageEngine's WSM department, which owns multiple products). It started as a credentials vault and is being grown into that team's **common management dashboard / workspace**: task management, internal tool coordination, and credential storage used to integrate the team's internal tools via their APIs.

- Catalyst project: `wsm-security` (project ID `47976000000083005`, env `Development`, ID `60073792083`)
- Base URL: `https://wsm-security-60073792083.development.catalystserverless.in`
- GitHub remote: `https://github.com/praveenkumar-pv-8915/wsm_security.git` (**public** repo — see Security Notes)

## Architecture — active vs legacy

There are **two parallel backend implementations**. Don't assume the wrong one is live.

- **`functions/welcome/`** — the currently-deployed Catalyst function (`catalyst.json` at repo root targets `"welcome"`, stack `node18`, type Advanced I/O). This is the active backend. It has:
  - `index.js` — Express app, mounted under `/server/welcome/`, gated by Catalyst's built-in user auth (`catalystApp.userManagement().getCurrentUser()`), admin-scoped Catalyst SDK calls with app-layer `owner_id` checks.
  - `credential-service.js` — Credential Vault CRUD against the `credentials` DataStore table. Secrets encrypted with AES-256-GCM before they touch DataStore.
  - `oauth-service.js` — OAuth connection handling against Zoho accounts (multi-DC), for `oauth_connections` table. Looks like the foundation for connecting external/internal tool APIs.
  - `auth-ui.js` — server-rendered dashboard shell.
  - The React app in `frontend/` (Vite) is built to `frontend/dist` and served as the Catalyst client; it currently only implements the Credential Vault UI (add/reveal/deactivate credentials).

- **`backend/`** — an older, separate Catalyst project scaffold (its own `catalyst.json`, targets `"server"`) with a richer **DataStore schema already designed but not wired up**: `creators`, `tasks`, `hacksaw_credentials`, `user_credentials`, `credential_audit_logs`. `backend/functions/server/` has its own Express app (`credentials-manager.js`, `sensitive-data-manager.js`, `oauth.js`, `zoho-oauth.js`, `auth-middleware.js`). This looks superseded by `functions/welcome/`, but the `tasks`/`creators`/audit-log tables are relevant prior art for the task-management goal below — check with the user before deleting anything here, it may just need to be reconnected rather than rebuilt.

Treat `functions/welcome` + `frontend` as the thing that's actually running. Treat `backend/` as reference/legacy until confirmed otherwise with the user.

## Deployment

- Local CLI deploys use the Zoho Catalyst CLI (`zcatalyst-cli`), driven by `.catalystrc` (root and `backend/`) and `catalyst.json` (`functions.targets: ["welcome"]`, `client.source: "frontend/dist"`).
- `.github/workflows/deploy.yml` only builds/validates (and is stale — it still references `backend/functions/server`, not `functions/welcome`); actual deployment on push to `main` happens through **Catalyst's native GitHub integration**, not this workflow.
- **Environment limitation for Claude sessions running in the cloud sandbox**: the `device_bash` tool used to reach this Mac runs in an isolated VM that mounts only the connected folder — it has no network access and the `zcatalyst-cli` binary is not present there. That means a cloud session **cannot itself run `catalyst deploy`** against this project. When a change needs deploying: make the code change, write it back to disk via the device bridge, and either ask the user to run `catalyst deploy` themselves, or explicitly ask whether they want to hand over a Catalyst auth token so a future session can install `zcatalyst-cli` in the network-enabled cloud container and deploy from there.
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
- Never commit real credentials anywhere in this repo — the remote is public. Use env-var indirection placeholders (as `backend/connections.config.json` does).

## Operating rules for this project (from the user)

- **If the user's message is just a question, answer it — do not start implementing.** Only build/change things when explicitly asked to.
- Claude may read local files under `~/otherProducts/` and `~/LOG360CLOUD/` when asked, for cross-project context.
- Prefer checking real behavior (browser check against the deployed URL, actual git/CLI output) over assuming a change worked.
