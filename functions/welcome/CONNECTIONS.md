# Connections

The 11 service connections from `agent-knowledge-kit/src/connections`, moved into the Catalyst app.

In the kit, each connection's token lived in the developer's **macOS Keychain** plus a local
**SQLite** file — per-person, per-machine, invisible to the team. Here the catalogue is shared and
each credential is either **team-shared** or **personal**, so the app itself can call these services
rather than only a laptop with the right Keychain entries.

## The 11 connections

| Key | Auth | Scopes | Default DC | API host |
|---|---|---|---|---|
| `zoho-logs` | OAuth | 1 | `in` | `logs.zoho.{dc}` |
| `zoho-cliq` | OAuth | 2 | `in` | `cliq.zoho.{dc}` |
| `zoho-projects` | OAuth | 10 | `in` | `projectsapi.zoho.{dc}` |
| `zoho-learn` | OAuth | 5 | `in` | `learn.zoho.{dc}` |
| `zoho-writer` | OAuth | 1 | `in` | `www.zohoapis.{dc}` |
| `zoho-sheet` | OAuth | 1 | `in` | `sheet.zoho.{dc}` |
| `zoho-creator` | OAuth | 5 | `in` | `www.zohoapis.{dc}` |
| `zoho-workdrive` | OAuth | 17 | `in` | `workdrive.zoho.{dc}` |
| `zoho-hacksaw` | OAuth | 6 | `zcc` | `hacksaw.zohocorpcloud.in` |
| `zoho-cmtools` | `PRIVATE-TOKEN` header | — | `csez` | `build.zohocorp.com` |
| `zoho-repository` | PAT, `Authorization: Zoho-zapikey` | — | `in` | `api.repository.zoho.in` |

48 OAuth scopes total across 9 services, plus 2 static-token services.

> **Note on the kit's own docs:** `SCOPES-INVENTORY.md` claims 51 scopes, but `config.json` — the
> file the scripts actually read — contains 48. This registry matches `config.json`. The inventory
> was generated 2026-07-17, before the 2026-08-10 Creator scope change, so it's stale.

**Scopes are widened, not minimal, on purpose.** Creator needs all five read scopes because
`report.READ` alone returns `401 code 2945` on the meta endpoints. Don't trim any of these without
re-testing the affected calls.

**Data centres:** 10 profiles (`in`, `eu`, `us`, `ae`, `uk`, `jp`, `au`, `ca`, `localzoho`, `zcc`).
Hacksaw exists only in `zcc`; the two static-token services are single-host. Everything else is
available in the 9 public DCs. `GET /api/connections/catalogue` reports `available_dcs` per service,
and requesting a DC a service doesn't serve is a 400.

## The scope model — shared default, personal override

| Level | Who may create | Who may use |
|---|---|---|
| `shared` | admins only | every active member |
| `user` | any member, for themselves | only that member |

Resolution is always **user-then-shared**: if you have your own credential for a service it wins for
you, otherwise the team-shared one applies. That's the override. One credential per
(service, level, owner) — re-configuring replaces rather than accumulating.

Trade-off to be aware of: a shared credential acts as whoever authorised it. Attribution at the
Zoho end is to that person, not to the member who triggered the call.

## Tables

Create these in the console alongside the vault's existing `credentials` table.

### `connections` — the catalogue

`SERVICE_KEY` (unique), `LABEL`, `AUTH_TYPE`, `DESCRIPTION`, `SCOPES`, `SCOPE_COUNT`,
`HOST_TEMPLATE`, `DEFAULT_DC`, `AVAILABLE_DCS`, `REDIRECT_PORT`, `AUTH_HEADER`,
`AUTH_HEADER_FORMAT`, `STATUS` — all Text.

Populated by `POST /api/connections/seed` from the constants in `connections-registry.js`.
Idempotent (upsert by `SERVICE_KEY`), admin-only. The code constants stay the source of truth; the
table exists so the catalogue is queryable without a redeploy.

### `connection_profiles` — the data centres

`DC` (unique), `DC_DOMAIN`, `ACCOUNTS_DOMAIN`, `DOMAINS_JSON`, `APPID`, `SERVICE`, `TIMEZONE`.

### `connection_credentials` — the secrets

`SERVICE_KEY`, `DC`, `SCOPE_LEVEL`, `OWNER_ID`, `AUTH_TYPE`, `CLIENT_ID`, `CLIENT_SECRET_ENC`,
`REFRESH_TOKEN_ENC`, `ACCESS_TOKEN_ENC`, `TOKEN_EXPIRES_AT`, `STATIC_TOKEN_ENC`, `OAUTH_STATE`,
`STATUS` (`pending`/`active`/`revoked`), `LAST_USED_AT`.

Every `*_ENC` column is AES-256-GCM (`v1:iv:tag:ciphertext`, the same format the vault uses) under
`CRED_ENC_KEY`. **No endpoint returns any of them.** `toPublic()` in `connections-service.js` is the
only shape that leaves the module for a response body — the smoke test asserts no encrypted or
plaintext secret appears in `GET /api/connections`.

Index `SERVICE_KEY` and `OWNER_ID`.

## Endpoints

Relative to `/server/welcome/`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/connections` | catalogue + shared/mine/effective per service |
| GET | `/api/connections/catalogue` | definitions from code, no credential state |
| GET | `/api/connections/profiles` | DC profiles |
| POST | `/api/connections/seed` | mirror code → tables. **admin** |
| POST | `/api/connections/oauth/start` | `{service_key, dc?, client_id, client_secret, scope_level}` → `{auth_url}` |
| GET | `/api/connections/oauth/callback` | Zoho lands here; redirects into the SPA |
| POST | `/api/connections/token` | `{service_key, dc?, token, scope_level}` for CMTools/Repository |
| DELETE | `/api/connections/:id` | revokes at Zoho, then wipes stored material |

**Scopes are never taken from the request** — `oauth/start` reads them from the registry, so a
caller can't quietly widen a grant.

## Setting up an OAuth connection

1. In the **Zoho API console** for the target DC, create a Server-based Application client.
2. Register this exact redirect URI (`oauth/start` echoes it back in its response):
   ```
   https://wsm-security-60073792083.development.catalystserverless.in/server/welcome/api/connections/oauth/callback
   ```
   The production URL is a separate registration — the host differs.
3. `POST /api/connections/oauth/start` with the client id/secret and `scope_level`.
4. Open the returned `auth_url`, approve, and Zoho returns to the callback, which stores the tokens
   and redirects to `/app/#/connections?status=connected`.

Access tokens refresh automatically with a 5-minute buffer, matching the kit's `oauth-common.sh`.

For CMTools and Repository there's no flow — `POST /api/connections/token` with the token.

## Using a connection from code

`callConnection` is the intended entry point for everything built on top of this:

```js
const conn = require('./connections-service');

const resp = await conn.callConnection(req, 'zoho-hacksaw', '/api/v1/products');
const resp = await conn.callConnection(req, 'zoho-projects', '/restapi/portals/', { dc: 'in' });
```

It resolves the caller's effective credential, refreshes the token if needed, applies the right auth
header for the auth type (`Zoho-oauthtoken`, `PRIVATE-TOKEN`, or `Zoho-zapikey`), builds the host
from the DC profile, and stamps `LAST_USED_AT`.

⚠️ **Never put a route in front of `callConnection` that accepts a caller-supplied path or service
key.** That would turn the app into an open proxy to every service the team has connected.

## Adding a new connection

Append an entry to `SERVICES` in `connections-registry.js`, deploy, and
`POST /api/connections/seed`. No schema change. If it needs a host in a DC that isn't mapped yet,
add it to that profile's `domains`.

## Relationship to `oauth-service.js`

`connections-service.js` supersedes `oauth-service.js`, which was written but never referenced by
`index.js`. Its OAuth logic carried over largely intact; what's new is the registry link, the
shared/personal scope model, static-token support, and `callConnection`. `oauth-service.js` and its
`oauth_connections` table are now redundant — left in place so you can confirm before deletion.
