---
name: deploy
description: >
  Deploy this repo's changed Catalyst targets (functions/<name>, frontend client) with the local
  Catalyst CLI, verify them against the live URL, then push committed-but-unpushed commits to
  GitHub over SSH. Use when the user says "deploy", "push to catalyst", "ship it", "push the
  changes", or asks to get a change live. Also use for push-only ("push my commits") via --no-push
  / --no-deploy flags.
---

# deploy — Catalyst deploy + git push

Everything is done by `deploy.sh` in this directory. Run it; don't re-implement the steps by hand.

```bash
.claude/skills/deploy/deploy.sh [--only functions:<name>,client] [--all] [--no-push] [--no-deploy] [--dry-run]
```

## What the script does

1. `ssh-add --apple-load-keychain`, forces `origin` to the SSH URL, `git fetch origin main`.
2. **Detects targets** = paths changed in unpushed commits ∪ working-tree changes:
   `functions/<name>/` → `functions:<name>` (only if listed in `catalyst.json`), `frontend/` → `client`.
   Override with `--only`, or `--all`.
3. Per function: `npm install` if `node_modules` is missing, `node --check` every `.js`,
   and for `welcome` **aborts if `CRED_ENC_KEY` is missing** from the local `catalyst-config.json`
   (the committed copy omits it on purpose; deploying without it would break the vault).
4. Per client: bumps the patch version in `frontend/public/client-package.json` (Catalyst 400s
   otherwise), runs `vite build`, commits the bump.
5. `catalyst deploy --only <targets>`, then curls `/server/<fn>/health` and `/server/<fn>/`
   (401 on the latter is expected — user auth) and `/app/index.html` for the client.
6. Pushes `main` if ahead of origin. **Refuses to push if origin has commits local doesn't** —
   it never force-pushes. Prints any uncommitted/untracked paths that were left behind.

## How to use it as Claude

- Run with `--dry-run` first if the detected target set isn't obvious; otherwise just run it.
- Relay the script output to the user: which targets deployed, the verification HTTP codes,
  and which commits were pushed.
- If it warns about a dirty working tree, tell the user what's live-but-uncommitted. Don't commit
  their files for them unless asked.
- If it refuses to push because origin is ahead, show `git log main..origin/main` and stop —
  reconciling is the user's call.
- This only works on the Mac where `zcatalyst-cli` is installed and logged in. From a cloud
  sandbox, make the code change and ask the user to run the script.
