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
- `design/` — the UI mockups the frontend is built to (see **Design** below).

## Design

The UI is designed in [Claude Design](https://claude.ai/design) and implemented by hand in `frontend/`.
The mockups are the source of truth for layout, tokens and interaction; the code follows them and
documents any departure.

| What | Where |
|---|---|
| Claude Design project | **Web app UI mockups** — project id `9a803dd5-27d9-4ba5-b52d-f085f892dc62` |
| Current mockup | `design/WSM Security v5.dc.html` (the app follows this one) |
| Earlier rounds | `design/WSM Security v3.dc.html`, `design/WSM Security v4.dc.html` |
| Design-system tokens | `design/_ds/modernist-4608a7ad-2b4a-40b4-bd96-c07c4262d929/styles.css` |
| Mockup runtime | `design/support.js` (needed to open a `.dc.html` locally; generated, do not edit) |

The files in `design/` are verbatim copies pulled from the Claude Design project with the
`DesignSync` tool (`get_file`), and are only ever updated the same way — never edited by hand.
Open a `.dc.html` from inside `design/` so its relative references to `support.js` and the
stylesheet resolve.

**Updating the UI:**

1. Make the change in Claude Design, in the project above.
2. Re-pull the changed file(s) into `design/` verbatim and commit them on their own.
3. Implement the change in `frontend/`. Each view's header comment names the mockup section it
   follows and lists its deliberate departures (data the backend lacks, pagination, admin tools
   the mockup does not draw) — keep that list current.
4. `frontend/src/App.css` carries the mockup's tokens: ground `nordic`, accent `gold`, second
   accent `electric` for dark; `porcelain` for light. The mockup's theme and accent pickers are an
   exploration tool and are not shipped — only the light/dark ground is user-switchable.

**What the app covers from v5:** the shell (collapsible rail, top bar, Settings tabs), Risk
Register (table, split view, detail tabs, rule panel), DMS Manager and Settings › Connections.
Not built yet: the mockup's Repository and Hacksaw groups, and Settings › Compliance is a
placeholder in the mockup. Draft new risk, Compare vs. DPIA, Ask and the VM Manager screens are
not in the mockup and keep their own layout inside the shell.

## Development

```sh
cd frontend && npm install && npm run build   # client → frontend/dist
cd functions/welcome && npm install           # function deps
```

Deployment happens through Catalyst's GitHub integration on push to `main`. The GitHub Actions workflow only build-validates. Local deploys use the `zcatalyst-cli` (`catalyst deploy`).

The credential-vault encryption key (`CRED_ENC_KEY`) is **never committed** — see the Security notes in `CLAUDE.md` before touching `functions/welcome/catalyst-config.json`.

Deployed at: https://wsm-security-60073792083.development.catalystserverless.in
