# Extended Gotchas

> Additional Catalyst gotchas that didn't make the top 12 in SKILL.md.
> These are real issues encountered during development but are less likely to cause silent failures.

---

## Deployment & CLI

### Catalyst deploy needs interactive login
<!-- verified: 2026-02-11 -->

`catalyst deploy` requires `catalyst login` (browser-based Zoho SSO). Cannot be done from automated/non-interactive shells or by AI agents. Always deploy from your own terminal where you're already logged in.

### Deploy silently skips functions without config
<!-- verified: 2026-02-11 -->

If `catalyst.json` only has `"client"` config and no `"functions"` section, `catalyst deploy` uploads only the Web Client. No error -- just "DEPLOYMENT SUCCESSFUL" with only the client listed. Always verify the deploy output lists both sections.

### Client directory mismatch after `catalyst init`
<!-- verified: 2026-02-10 -->

`catalyst init` creates a `client/` directory with boilerplate. If your app is in `app/`, edit `catalyst.json` to point `"source"` to `"app"` and add `client-package.json` to your app directory. Delete the boilerplate `client/` directory.

---

## OAuth & Auth

### APP_ORIGIN must be domain only
<!-- verified: 2026-02-10 -->

No trailing slash, no path. Code appends `/app/index.html` itself.

- Correct: `https://myapp-60047883702.development.catalystserverless.in`
- Wrong: `https://myapp-60047883702.development.catalystserverless.in/`
- Wrong: `https://myapp-60047883702.development.catalystserverless.in/app/`

### Callback URL must match exactly in 3 places
<!-- verified: 2026-02-10 -->

The `ZOHO_REDIRECT_URI` env var, the `redirect_uri` in the auth URL, and the Redirect URI in Zoho API Console must be **identical** -- including protocol, port, and path.

### Redirect must go to /app/index.html
<!-- verified: 2026-02-10 -->

- Wrong: `/index.html` -- app doesn't live there
- Wrong: `appOrigin + 'index.html'` -- produces `...inindex.html` (missing slash)
- Wrong: `/app/` -- may not load index.html

### Catalyst passes varying paths -- normalize them
<!-- verified: 2026-02-10 -->

A request to `/server/oauth/login` may arrive as `/server/oauth/login`, `/oauth/login`, `/login`, or `/`. Strip prefixes before routing:

```javascript
path = path.replace(/^\/server\/oauth\/?/, '/').replace(/^\/oauth\/?/, '/');
if (path === '') path = '/';
```

### Scope is a query parameter, not an API Console setting
<!-- verified: 2026-02-10 -->

Put `scope=AaaServer.profile.READ` in the authorization URL query string. Don't look for "scope" in Zoho API Console -- it's not there.

### SESSION_SECRET must match between functions
<!-- verified: 2026-02-10 -->

The OAuth function sets the session cookie. The API function reads it. Both use HMAC-SHA256 with the same `SESSION_SECRET` env var. If they don't match, every API request returns 401.

---

## Data Store

### Reserved column names
<!-- verified: 2026-02-11 -->

`priority` is rejected as a column name. Other reserved words likely exist. Use descriptive suffixes (`priority_level`, `status_code`). Always test column creation before finalizing schema docs.

### CREATORID won't help with custom OAuth
<!-- verified: 2026-02-11 -->

With custom Zoho OAuth (not Catalyst Native Auth), `CREATORID` won't auto-populate with your user. Track `employee_email` as a denormalized column in user-scoped tables.

### Text columns max at 10,000 chars
<!-- verified: 2026-02-11 -->

Don't stuff large JSON blobs into Text columns. Normalize into separate tables instead.

### ZCQL max 20 columns per SELECT
<!-- verified: 2026-02-11 -->

In addition to the 300-row limit, ZCQL also limits SELECT to 20 columns. Use specific column names instead of `SELECT *` on wide tables.

---

## Seed Scripts

### Seed script idempotency
<!-- verified: 2026-02-11 -->

Before inserting, query `COUNT(ROWID)` for each table. Support modes:
- Default: skip if rows exist
- `--force`: insert anyway
- `--reset`: clear first

Always support `--dry-run`.

**Gotcha**: Tables without unique constraints (junction tables) get duplicate rows on re-run without `--reset`.

---

## Auth & Users

### Employee auto-provisioning slug collisions
<!-- verified: 2026-02-11 -->

Auth middleware that auto-creates employees from email can hit slug collisions: `john.doe@` and `john-doe@` both produce `john-doe`. Solve with MD5 hash suffix + race condition retry.

### Dev user limit is 25
<!-- verified: 2026-02-10 -->

Development environment supports only 25 users. Must promote to production for 25+ users. Production has unlimited users.

---

## Slate + Functions

### Cookie/domain mismatch
<!-- verified: 2026-02-10 -->

Slate serves frontend from `*.onslate.in`. Functions serve from `*.catalystserverless.in`. If these are different domains, cookies set by the OAuth function won't be readable by the Slate frontend.

**Mitigation**: Use Catalyst domain mapping to put both under one custom domain. Test this early in development.

---

## SDK & Credentials

### Data center domains must be set BEFORE requiring SDK
<!-- verified: 2026-02-11 -->

`X_ZOHO_CATALYST_ACCOUNTS_URL` and `X_ZOHO_CATALYST_CONSOLE_URL` must be set as environment variables **before** `require('zcatalyst-sdk-node')`. The SDK reads them at import time.

### `invalid_client` during token exchange = wrong DC
<!-- verified: 2026-02-11 -->

If you're on the India DC but hitting `accounts.zoho.com` (US), you'll get `invalid_client`. Use `accounts.zoho.in` for India, `.eu` for EU, `.com.au` for AU.

### `ZohoCatalyst.tables.ALL` doesn't grant row access
<!-- verified: 2026-02-11 -->

Use specific scopes: `ZohoCatalyst.tables.rows.CREATE`, `.READ`, `.DELETE`. The `ALL` and `projects.ALL` scopes do NOT grant Data Store row access.

### ZAID differs between Dev and Prod
<!-- verified: 2026-02-11 -->

The ZAID (projectKey) is **different** for Development and Production environments. Always switch to the correct environment in the Console dropdown before copying the ZAID.

### Self Client credentials are separate from app OAuth
<!-- verified: 2026-02-11 -->

Zoho API Console has multiple client types. The Self Client (for scripts) has its own Client ID/Secret, separate from the Server-based Application (for user-facing OAuth). Do not mix them.

---

## Function Code Gotchas

*Promoted from SKILL.md inline section — real issues, less universally hit than the top 5.*

### Zoho userinfo returns CAPITALIZED field names
<!-- verified: 2026-02-10 -->

Unlike every other OAuth provider, Zoho's `/oauth/user/info` uses `Email`, `First_Name`, `Last_Name` (capitalized). `/oauth/v2/userinfo` uses lowercase and returns no email.

```javascript
// WRONG:
email: user.email

// CORRECT:
email: user.Email || user.email || '',
first_name: user.First_Name || user.first_name || '',
last_name: user.Last_Name || user.last_name || '',
```

### Missing `package.json` in function directory — deploy silently skipped
<!-- verified: 2026-02-11 -->

Catalyst runs `npm install` before deploying. Without `package.json`, npm fails and the function is silently skipped. Even with zero dependencies, the file is required:

```json
{ "name": "oauth", "version": "1.0.0", "main": "index.js", "dependencies": {} }
```

### `require('express')` crashes on blank template — no node_modules
<!-- verified: 2026-02-10 -->

The Catalyst blank template has no `node_modules`. `require('express')` fails immediately. Use only Node.js built-ins on blank template:

```javascript
const crypto = require('crypto');
const https  = require('https');
const url    = require('url');
```

Express IS available on the Express template. Blank template = Node built-ins only.

### `http.createServer().listen()` causes EADDRINUSE on warm starts
<!-- verified: 2026-02-10 -->

Catalyst runs the HTTP server for you. Adding `http.createServer(handler).listen(9000)` causes `EADDRINUSE` on warm starts when the port is already in use.

```javascript
// WRONG:
http.createServer(handler).listen(9000);

// CORRECT:
module.exports = handler;  // blank template
module.exports = app;      // Express template
```

### Cookie: must use `SameSite=Lax` — not Strict
<!-- verified: 2026-02-10 -->

`SameSite=Strict` blocks the cookie on redirect from Zoho (cross-site navigation). `Path=/server` means the cookie isn't sent when the frontend calls `/server/oauth/me`.

```
Set-Cookie: session=<value>; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400
```

### Set-Cookie + Location must be in ONE `writeHead` call
<!-- verified: 2026-02-10 -->

Catalyst's proxy may drop `Set-Cookie` if sent separately from `Location`. Always combine them:

```javascript
// CORRECT:
res.writeHead(302, {
  'Location': appOrigin + '/app/index.html',
  'Set-Cookie': 'session=' + value + '; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400'
});
res.end();

// WRONG (cookie may be dropped by proxy):
res.setHeader('Set-Cookie', '...');
res.writeHead(302, { 'Location': '...' });
```

### zcatalyst-sdk-node v4 does NOT exist
<!-- verified: 2026-02-11 -->

Latest published version is **3.1.1**. Version 4.x does NOT exist despite AI tools confidently generating code using it.

Always verify: `npm show zcatalyst-sdk-node version`

### `catalyst.initialize(req)` vs `catalyst.initializeApp({...})` — wrong context fails silently
<!-- verified: 2026-02-11 -->

| Method | Context | Usage |
|--------|---------|-------|
| `catalyst.initialize(req)` | Inside a Catalyst function handler | Receives Express request, auto-authenticates |
| `catalyst.initializeApp({...})` | External scripts / AppSail | Requires manual credentials (project_id, project_key, credential) |

Using `initialize()` outside a function or `initializeApp()` inside one will fail silently or throw cryptic errors.

---

## Cache Patterns

### getWithCache helper — cache-aside pattern
<!-- verified: 2026-02-11, from Zach's skill -->

The standard pattern for reducing Data Store reads on hot data. Cache misses are silent (getValue throws — catch and continue):

```javascript
const cache   = catalystApp.cache();
const segment = cache.segment(segmentId); // Segment ID from Catalyst console

async function getWithCache(key, fetchFn, ttlHours = 24) {
  try {
    const cached = await segment.getValue(key);
    if (cached) return JSON.parse(cached.cache_value);
  } catch (e) {
    // Key doesn't exist — not an error, just a cache miss
  }
  const fresh = await fetchFn();
  await segment.put(key, JSON.stringify(fresh), ttlHours);
  return fresh;
}

// Usage:
const user = await getWithCache(`user:${userId}`, () =>
  zcql.executeZCQLQuery(`SELECT * FROM Users WHERE ROWID = ${userId}`)
);
```

**Rule**: Use TTL matching data freshness requirements. Session data = short TTL (1h). Reference data = long TTL (24h). Never use Cache for data that must always be current.
