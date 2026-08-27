# wsm-security — Implementation Plan for Claude Code

Companion to `GOALS_AND_TASKS.md`. That file says *what* needs doing; this one says *how to split it* so you can run several Claude Code sessions on it at once without them stepping on each other.

## Before you start: workflow setup

- **UI verification**: enable Claude Code's Chrome integration (`/chrome` inside a session, needs the Claude in Chrome extension + a Pro/Max/Team/Enterprise login) so it can navigate the deployed app / local `catalyst serve` instance and check its own work. If you'd rather it read structured DOM than pixels, the Playwright MCP server (`npm install -g @playwright/mcp`) is the alternative. Either way it'll stop and ask you to log in manually rather than guessing credentials.
- **Parallel sessions**: one `git worktree` per stream below, each on its own branch, each with its own `claude` process in its own terminal/tmux pane. Roughly:
  ```
  git worktree add ../wsm_security-security fix/security-remediation
  git worktree add ../wsm_security-tasks    feat/task-management
  git worktree add ../wsm_security-cleanup  chore/platform-cleanup
  ```
  Run `npm install` separately in each worktree (`functions/welcome`, `frontend`, `backend` as applicable — `node_modules` isn't shared across worktrees). Verify the exact worktree flags/commands against `claude --help` and current docs before relying on them — CLI surface changes.
- **Merge order matters more than parallelism here.** Streams that only add new files can run fully in parallel. Streams that touch the same existing file (see the conflict map below) should merge back to `main` one at a time, with the others rebasing after — plan for that, don't fight it.

## Work streams

### Stream 0 — Security remediation (run first, solo, no worktree)
Do this alone on `main` before spinning up anything else, because it rewrites commits that haven't been pushed yet.
- Rotate the credential in `review_request_local.md`; rewrite it out of commit `74312e8`.
- Rotate `CRED_ENC_KEY`; move it out of `functions/welcome/catalyst-config.json` into Catalyst's env-var console/CLI config instead of a committed file; re-encrypt any credentials already stored under the old key.
- Only after this is done and you're confident nothing sensitive remains in the 32 pending commits: push.
- **Blocks**: everyone else, informally — nobody should push until this lands, and Stream 4 (vault hardening) should branch from *after* this stream, not before.

### Stream 1 — Platform cleanup (parallel-safe, no dependencies)
Touches only its own files, nothing anyone else needs.
- Remove `deploy-function.js` (dead — explicitly says it can't auth, tells you to deploy via console manually).
- Remove committed `npm-debug.log` files (root, `backend/`, `frontend/`) and confirm `.gitignore` catches future ones.
- Remove or repurpose `functions/welcome/auth-ui.js` (unused server-rendered dashboard — the real UI is `frontend/`) and `frontend/src/pages/Welcome.jsx` (leftover scaffold branded "Creator App", not wired into the current single-page vault UI).
- Fix or remove `.github/workflows/deploy.yml` (still references the retired `backend/functions/server` path).
- Expand `README.md` once the module set below is real.

### Stream 2 — Task management module (mostly parallel-safe)
New feature, mostly new files.
- Reuse the `tasks` table design already drafted in `backend/catalyst.json` (user_id, title, description, status, priority, due_date) — port it under `functions/welcome`'s DataStore.
- New file `functions/welcome/task-service.js` (mirror the shape of `credential-service.js`: CRUD + owner_id checks).
- New frontend view/route for tasks (new file(s) under `frontend/src/pages/` or a tab in `App.jsx`).
- **Conflict**: adding routes touches `functions/welcome/index.js` (shared file, see conflict map).

### Stream 3 — Internal tool coordination module (blocked on one decision)
Don't start the build until "coordination" is defined concretely — a tool directory with health/owners, or integration-status tracking, or something else. That's a 5-minute conversation, not a Claude Code task; resolve it before opening this worktree.
- Once scoped: likely built on `oauth-service.js`'s existing multi-DC OAuth handling for tools that need it, plus the credential vault for tools that just need an API key.

### Stream 4 — Credential vault hardening (branch after Stream 0 merges)
Touches existing files in `functions/welcome`.
- Wire up audit logging (the `credential_audit_logs` table already exists in `backend/catalyst.json`'s schema, unused by the active function) — log who viewed/revealed/deactivated which credential, when.
- Decide whether the "Reveal" flow (returns plaintext secret straight to the browser) needs tightening — re-auth prompt, time-limited display, or an audit entry per reveal — for this team's threat model.
- **Conflict**: edits `credential-service.js` and possibly `index.js` — coordinate with Stream 2 if both are mid-flight (see conflict map).

### Stream 5 — Resolve `backend/` (decision task, not a build task)
Before anyone builds on `backend/`'s schema (Streams 2 and 4 both want to reuse pieces of it): decide with the user whether `backend/` is dead code to delete, or whether it should be reconnected instead of re-implemented. Do this once, up front — don't let two streams guess differently.

## Conflict map — files more than one stream wants to touch

| File | Wanted by | How to avoid collisions |
|---|---|---|
| `functions/welcome/index.js` | Streams 2, 4 | Each stream adds its own router file and touches `index.js` only to add one `app.use(...)` line for its own routes — keeps the diff to one line per stream, cheap to merge/rebase in sequence. |
| `functions/welcome/catalyst-config.json` | Stream 0 (removes the key), Stream 4 (may add new env vars) | Stream 0 must merge first; Stream 4 branches after. |
| `frontend/src/App.jsx` | Stream 1 (may remove dead nav), Stream 2 (adds a tasks tab) | Same rule — small, additive edits per stream, merge in sequence rather than both rewriting the file. |

## Suggested order

1. Stream 0 (solo) → push once clean.
2. In parallel: Stream 1 (cleanup), and the Stream 5 decision conversation.
3. Once Stream 5 is decided: Streams 2 and 4 in parallel worktrees, merging `index.js`/`App.jsx` changes one at a time per the conflict map.
4. Stream 3 once its scope is defined — can run alongside 2/4 once it's clear its routes don't collide with theirs.
