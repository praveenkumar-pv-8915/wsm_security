# wsm-security

Internal management dashboard for the **WSM Security team** (ManageEngine WSM), built on [Zoho Catalyst](https://catalyst.zoho.com) serverless.

Started as a credential vault; growing into the team's common workspace: task management, internal tool coordination, and secure credential storage for integrating the team's internal tools via their APIs.

## Modules

| Module | Status |
|---|---|
| **Credential Vault** — store/reveal/deactivate API credentials, encrypted with AES-256-GCM before they reach DataStore | Live |
| **Task management** | Planned |
| **Internal tool coordination** | Planned |

## Layout

- `functions/welcome/` — the deployed Catalyst function (Node 18, Advanced I/O). Express app gated by Catalyst's built-in user auth; credential CRUD in `credential-service.js`, OAuth connections in `oauth-service.js`.
- `frontend/` — React + Vite client, built to `frontend/dist` and served by Catalyst client hosting at `/app/`.
- `backend/` — older parallel scaffold, superseded by `functions/welcome/` but kept as reference for its DataStore schema (`tasks`, `creators`, `credential_audit_logs`). Do not build on it without checking `CLAUDE.md`.

## Development

```sh
cd frontend && npm install && npm run build   # client → frontend/dist
cd functions/welcome && npm install           # function deps
```

Deployment happens through Catalyst's GitHub integration on push to `main`. The GitHub Actions workflow only build-validates. Local deploys use the `zcatalyst-cli` (`catalyst deploy`).

The credential-vault encryption key (`CRED_ENC_KEY`) is **never committed** — see the Security notes in `CLAUDE.md` before touching `functions/welcome/catalyst-config.json`.

Deployed at: https://wsm-security-60073792083.development.catalystserverless.in
