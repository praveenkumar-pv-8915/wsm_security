# wsm-security — Goal & Task List

Extracted from the stated intent for this app, plus what's already in the codebase, on 2026-08-07.

## Goal

Turn `wsm-security` into the **WSM Security team's common management dashboard and workspace** — one place, built on Catalyst, that covers:

1. **Task management** for the team.
2. **Internal tool coordination** across the multiple ManageEngine WSM products the team supports.
3. **Credential management** (already the most built-out part) — securely storing and serving the API credentials used to integrate the team's internal tools with each other.

More capabilities should be added under this same app as the team's needs come up.

## Task list

### 0. Security remediation — do before the next `git push`

The 32 unpushed local commits currently contain two secrets that would go public the moment they're pushed (repo remote is public on GitHub). Nothing here should be started without the user's explicit go-ahead, but it should happen before anyone pushes:

- [x] Rotate the real credential currently sitting in `review_request_local.md` (commit `74312e8`). *(rotated by Pk 2026-08-07 — it had been pushed publicly that day)*
- [x] Remove that credential from the file/commit. *(history rewritten with git filter-repo + force-pushed 2026-08-07; zips and npm-debug logs scrubbed too)*
- [x] ~~Rotate `CRED_ENC_KEY`~~ *(not needed — the key was never actually committed; it only existed in the local working tree)*
- [x] Stop committing `CRED_ENC_KEY` in `catalyst-config.json`. *(guarded with git skip-worktree; key exists only locally and is injected by CLI deploys)*
- [x] Decide what to do with the stale `.github/workflows/deploy.yml`. *(rewritten 2026-08-07 to build-validate `functions/welcome` + `frontend` only)*

### 1. Foundation

- [x] Decide the fate of `backend/`. *(decision 2026-08-10: dead code, deleted; schema recoverable via `git show 0cac67c:backend/catalyst.json`)*
- [x] Confirm authenticated git push actually works. *(works over SSH after `ssh-add --apple-load-keychain`; see CLAUDE.md Git section)*
- [x] Decide the deploy path going forward. *(local `catalyst deploy` via CLI — GitHub auto-deploy demonstrably did not fire on 2026-08-07)*

### 2. Task management module (not yet built)

- [ ] Design the task data model — `backend/catalyst.json` already has a draft `tasks` table (user_id, title, description, status, priority, due_date) that can likely be reused almost as-is under `functions/welcome`.
- [ ] Build the API endpoints (create/list/update/close tasks, assign to team members).
- [ ] Build the UI — the current frontend only has the Credential Vault view; this needs its own view/section, with the vault becoming one tab among several rather than the whole app.
- [ ] Decide on team-visibility model: personal tasks vs. team-shared tasks/boards.

### 3. Internal tool coordination module (not yet built)

- [ ] Nail down what "coordination" means concretely for this team — e.g., a directory of internal tools with status/health, links, owners; or a place to track which tool integrations are pending/broken.
- [ ] `oauth-service.js` already handles OAuth connections to Zoho accounts (multi-DC) — this is likely the integration mechanism these tools would hang off of. Confirm which internal tools need OAuth vs. plain API-key credentials (the vault already supports `api_key`, `password`, `token`, `ssh_key`, `certificate`, `other`).
- [ ] Build a UI surface for this once the concrete requirement is confirmed.

### 4. Credential management — harden what already exists

- [ ] Address the two leaked-secret items in section 0.
- [ ] `credential_audit_logs` table exists in the `backend/` schema but isn't wired into the active `functions/welcome` credential service — decide if audit logging (who viewed/revealed which credential, when) should be turned on.
- [ ] Confirm the reveal-secret flow in the UI (`App.jsx` "Reveal" button, returns plaintext to the browser) is acceptable for this team's threat model, or whether it needs additional gating (re-auth, logging, time-limited display).

### 5. Platform / cleanup

- [x] Remove/replace `deploy-function.js` at the repo root. *(deleted 2026-08-07 — was never even committed)*
- [x] Clean up committed `npm-debug.log` files. *(scrubbed from history and disk 2026-08-07)*
- [x] `README.md` expanded to a real project overview. *(2026-08-07)*

### 6. Documentation

- [x] `CLAUDE.md` added at repo root with project structure, active-vs-legacy code map, deployment mechanics, and known security issues.
- [ ] Once the security items in section 0 are resolved, update `WEBHOOK_SETUP.md` (still describes a TODO webhook flow with no signature verification) to reflect final state.
