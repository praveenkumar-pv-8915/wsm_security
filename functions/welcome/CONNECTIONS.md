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

## The one table

Connections need exactly one DataStore table: **`connection_credentials`**. Everything else about a
connection — which services exist, their scopes, their per-DC hosts — is code, in
`connections-registry.js`.

That split is deliberate. Scopes and hosts change only when someone edits that file and redeploys,
so a database copy could never be anything but identical-or-stale. Tokens are created by users at
runtime, rotated on refresh and wiped on revoke, so they can't live in a file. Config in code, data
in the database.

Scopes stay in code for a second reason: they decide what a token is allowed to do. In code that
changes in a reviewed diff. In a console-editable row it doesn't — and since `startOAuth` reads
scopes from the registry regardless, a table copy could silently disagree with what is actually
requested at consent.

> Earlier versions mirrored the catalogue into `connections` and `connection_profiles` tables "so it
> is queryable without a redeploy". Nothing ever read them, and `seedRegistry()` plus
> `POST /api/connections/seed` existed only to fill them. All three are gone (2026-08-27). If you
> want the catalogue as data, `GET /api/connections/catalogue` serves it straight from code.
>
> The general-purpose `credentials` vault is gone too, along with `credential-service.js` and the
> `/api/credentials/*` routes — the only secrets this app stores are the ones connections need.

**Create it by hand in the Catalyst console** (Data Store → Create a new Table). Catalyst has no
API, SDK or CLI for creating a table. Until it exists, `GET /api/connections` fails with
`No such Table with the given name exists.`

| Column | Type | Notes |
|---|---|---|
| `SERVICE_KEY` | Var Char 100 | index it |
| `DC` | Var Char 30 | |
| `SCOPE_LEVEL` | Var Char 10 | `shared` \| `user` |
| `OWNER_ID` | Var Char 30 | index it. Catalyst `user_id`, never email |
| `AUTH_TYPE` | Var Char 30 | `oauth` \| `private_token` \| `pat` |
| `CLIENT_ID` | Var Char 255 | |
| `CLIENT_SECRET_ENC` | **Encrypted text** | |
| `REFRESH_TOKEN_ENC` | **Encrypted text** | |
| `ACCESS_TOKEN_ENC` | **Encrypted text** | |
| `STATIC_TOKEN_ENC` | **Encrypted text** | CMTools / Repository |
| `TOKEN_EXPIRES_AT` | Var Char 20 | epoch millis as a string |
| `OAUTH_STATE` | Var Char 60 | 48 hex chars, one-time |
| `GRANTED_SCOPES` | **Text** | ⚠️ **not Var Char.** WorkDrive's scope string is 460 chars and Projects' 262 — both over the 255 cap |
| `STATUS` | Var Char 20 | `pending` \| `active` \| `revoked` |
| `LAST_USED_AT` | Var Char 20 | epoch millis as a string |

Do **not** put a unique constraint on any of these. `IsUnique` can never be changed after column
creation, and columns that get blanked on revoke (`*_ENC`, `OAUTH_STATE`) would collide the second
time a row is revoked.

Every `*_ENC` value is AES-256-GCM (`v1:iv:tag:ciphertext`) under `CRED_ENC_KEY`, *inside* the
natively-encrypted column — two layers on purpose. **No endpoint returns any of them.** `toPublic()`
in `connections-service.js` is the only shape that leaves the module for a response body.

## Re-authenticating

An OAuth grant is frozen at consent time. When a scope is added to a service in the registry, the
stored refresh token keeps refreshing happily but still carries the **old** grant — so calls needing
the new scope come back 401 and the connection looks broken rather than under-permissioned.
Refreshing never widens a grant; only a fresh consent does.

`GRANTED_SCOPES` records what was actually consented to. `listConnections` compares it (as a set, so
reordering the registry array doesn't nag anyone) against the registry's current scope string and
returns `scopes_stale`. The UI shows a **scopes changed** badge and highlights **Re-authenticate**.

`POST /api/connections/:id/reauthorize` reuses the stored client id and secret, so nobody has to dig
them out of the Zoho API console again. The existing tokens are left in place until the new consent
completes — abandon the Zoho screen and the connection keeps working on the old grant.

Rows created before `GRANTED_SCOPES` existed have it blank and are never reported stale; re-authenticate
once and they start being checked.

## Endpoints

Relative to `/server/welcome/`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/connections` | catalogue + shared/mine/effective per service |
| GET | `/api/connections/catalogue` | definitions from code, no credential state |
| GET | `/api/connections/profiles` | DC profiles |
| POST | `/api/connections/oauth/start` | `{service_key, dc?, client_id, client_secret, scope_level}` → `{auth_url}` |
| POST | `/api/connections/:id/reauthorize` | re-consent reusing the stored client id/secret → `{auth_url}` |
| GET | `/api/connections/oauth/callback` | Zoho lands here; redirects into the SPA |
| POST | `/api/connections/token` | `{service_key, dc?, token, scope_level}` for CMTools/Repository |
| DELETE | `/api/connections/:id` | revokes at Zoho, then wipes stored material |

**Scopes are never taken from the request** — `oauth/start` reads them from the registry, so a
caller can't quietly widen a grant.

## Setting up an OAuth connection

1. In the **Zoho API console** for the target DC, create a Server-based Application client.
2. Register this exact redirect URI (`oauth/start` echoes it back in its response as
   `redirect_uri`):
   ```
   https://wsm-security-60073792083.development.catalystserverless.in/server/welcome/api/connections/oauth/callback
   ```
   **No port.** Catalyst's proxy sets the `Host` header to `hostname:443`, so an earlier version
   sent `...catalystserverless.in:443/...` and Zoho answered *"Invalid Redirect Uri — Redirect URI
   passed does not match with the one configured"*. `selfHost()` in `index.js` strips the `:443`;
   443 is the default port for https, so the port-less form is the canonical one and the one to
   register.

   Zoho compares the string literally: scheme, host, port, path and trailing slash all have to
   match. The same URI is sent again at the token exchange, so a mismatch would break that too.

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

Append an entry to `SERVICES` in `connections-registry.js` and deploy. No schema change, no seed
step — the catalogue is the code. If it needs a host in a DC that isn't mapped yet, add it to that
profile's `domains`.

**Adding a scope to an existing service is different.** Everyone already connected to it keeps the
narrower grant until they re-consent, so they'll see the **scopes changed** badge and need to hit
**Re-authenticate**.

## Removed files

`oauth-service.js` and its `oauth_connections` table are gone (2026-08-27). It was written but never
wired into `index.js`; `connections-service.js` carried its OAuth logic over and added the registry
link, the shared/personal scope model, static-token support, re-authorisation and `callConnection`.
