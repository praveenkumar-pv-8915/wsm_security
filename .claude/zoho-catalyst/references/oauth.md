# Zoho OAuth via Catalyst Function — Implementation Guide

> **Last verified working: 2026-02-10**
> For inline gotchas (wrong endpoint, capitalized fields, cookie rules, etc.), see SKILL.md.
> This file covers the full implementation: architecture, code, setup, and debugging.

---

## Table of Contents

- [Architecture](#architecture)
- [Environment Variables](#environment-variables)
- [Routes](#routes)
- [Function Structure Rules](#function-structure-rules)
- [Cookie Configuration](#cookie-configuration)
- [Redirect Rules](#redirect-rules)
- [Client-Side Wiring](#client-side-wiring)
- [Setup Steps](#setup-steps)
- [Debugging Checklist](#debugging-checklist)
- [Why Not Catalyst Native Auth](#why-not-catalyst-native-auth)
- [Every Mistake Made](#every-mistake-made)

---

## Architecture

- Catalyst **Advanced I/O Function** (`oauth`), Node.js, **blank template** (no Express)
- Uses only Node built-ins: `crypto`, `https`, `url`
- Session stored as **signed cookie** (HMAC-SHA256), not server-side
- DC: Set to match your Zoho account (India = `accounts.zoho.in`)

**Auth flow:**
```
checkAuth() -> fetch('/server/oauth/me', { credentials: 'include' })
  -> if 200 + valid user -> continue to app
  -> if 401 -> showLoginScreen()
showLoginScreen() -> button click -> location.href = '/server/oauth/login'
/server/oauth/login -> 302 to accounts.zoho.{dc}/oauth/v2/auth
Zoho -> user signs in -> 302 to /server/oauth/callback?code=...
/server/oauth/callback -> exchange code -> get userinfo -> set signed cookie -> 302 to /app/index.html
/server/oauth/me -> read cookie -> verify HMAC -> return user JSON
/server/oauth/logout -> clear cookie -> 302 to /app/index.html
```

---

## Environment Variables

Set ALL of these in `functions/oauth/catalyst-config.json` under `env_variables`. Do NOT set them in the Console UI — `catalyst deploy` overwrites Console vars (see SKILL.md gotcha #2).

Copy `catalyst-config.example.json` -> `catalyst-config.json` and fill in real values. The real file is gitignored.

| Variable | Value | Notes |
|----------|-------|-------|
| `ZOHO_CLIENT_ID` | From Zoho API Console | |
| `ZOHO_CLIENT_SECRET` | From Zoho API Console | |
| `ZOHO_REDIRECT_URI` | `https://<domain>/server/oauth/callback` | Must match Zoho API Console redirect URI **EXACTLY** |
| `APP_ORIGIN` | `https://<domain>` | Domain only. NO trailing slash. NO `/app/` path. |
| `SESSION_SECRET` | Random 32+ char string | Used for HMAC-SHA256 cookie signing |

**APP_ORIGIN rules:**
- Correct: `https://myapp-60047883702.development.catalystserverless.in`
- Wrong: `https://myapp-60047883702.development.catalystserverless.in/` (trailing slash)
- Wrong: `https://myapp-60047883702.development.catalystserverless.in/app/` (has path)

---

## Routes

| Route | Method | What it does |
|-------|--------|-------------|
| `/server/oauth/login` | GET | 302 -> Zoho sign-in page |
| `/server/oauth/callback` | GET | Exchange code -> set signed cookie -> 302 -> app |
| `/server/oauth/me` | GET | Read cookie -> return user JSON (200) or 401 |
| `/server/oauth/logout` | GET | Clear cookie -> 302 -> app |

---

## Function Structure Rules

### Required project structure

```
project-root/
  catalyst.json                    # Must include "functions" config
  app/
    index.html
  functions/
    oauth/
      index.js                     # The handler code
      catalyst-config.json         # Function metadata + env vars (GITIGNORED)
      catalyst-config.example.json # Template with placeholders (in git)
      package.json                 # Required even with zero dependencies
```

### catalyst-config.json

```json
{
  "deployment": {
    "name": "oauth",
    "stack": "node18",
    "type": "advancedio",
    "env_variables": {
      "ZOHO_CLIENT_ID": "your-client-id",
      "ZOHO_CLIENT_SECRET": "your-client-secret",
      "ZOHO_REDIRECT_URI": "https://your-domain/server/oauth/callback",
      "APP_ORIGIN": "https://your-domain",
      "SESSION_SECRET": "random-32-char-string"
    }
  },
  "execution": {
    "main": "index.js"
  }
}
```

### Path normalization

Catalyst passes varying paths. A request to `/server/oauth/login` may arrive as `/server/oauth/login`, `/oauth/login`, `/login`, or even `/`.

```javascript
path = path.replace(/^\/server\/oauth\/?/, '/').replace(/^\/oauth\/?/, '/');
if (path === '') path = '/';
```

### Do NOT use npm packages (blank template)

```javascript
// Only these are available:
const crypto = require('crypto');
const https = require('https');
const url = require('url');
```

### Export pattern

```javascript
// CORRECT:
module.exports = handler;

// WRONG (causes EADDRINUSE on warm starts):
http.createServer(handler).listen(9000);
```

---

## Cookie Configuration

### Required attributes

```
session=<value>; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400
```

**Why each one matters:**
- `Path=/` — Cookie sent for ALL requests. Without this, `/app/` calling `/server/oauth/me` won't send the cookie.
- `SameSite=Lax` — Cookie sent on redirect from Zoho (cross-site). `Strict` blocks it.
- `HttpOnly` — Not readable by client JavaScript (security).
- `Secure` — HTTPS only (Catalyst is always HTTPS).
- `Max-Age=86400` — 24 hours.

### Set cookie and redirect in ONE call

```javascript
// CORRECT:
res.writeHead(302, {
  'Location': appOrigin + '/app/index.html',
  'Set-Cookie': 'session=' + value + '; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400'
});
res.end();
```

---

## Redirect Rules

### Always redirect to `/app/index.html`

```javascript
var dest = appOrigin + '/app/index.html';
```

- Wrong: `appOrigin + '/index.html'` -- app doesn't live there
- Wrong: `appOrigin + 'index.html'` -- produces `...inindex.html` (missing slash)
- Wrong: `appOrigin + '/app/'` -- may not load index.html

### Callback URL must match EXACTLY

The `ZOHO_REDIRECT_URI` env var, the `redirect_uri` in the auth URL, and the Redirect URI in Zoho API Console must be **identical**.

---

## Client-Side Wiring

### Sign in button

```javascript
var oauthLoginUrl = (location.origin || '') + '/server/oauth/login';
btn.addEventListener('click', function() {
  window.location.href = oauthLoginUrl;
});
```

### Auth check on page load

```javascript
async function checkAuth() {
  try {
    var res = await fetch(location.origin + '/server/oauth/me', {
      method: 'GET',
      credentials: 'include'  // REQUIRED -- sends the cookie
    });
    if (!res.ok) throw new Error('Not authenticated');
    var data = await res.json();
    STATE.currentUser = { email: data.email, firstName: data.first_name, lastName: data.last_name };
    return true;
  } catch (err) {
    showLoginScreen();
    return false;
  }
}
```

### Logout button

```javascript
logoutBtn.addEventListener('click', function() {
  window.location.href = (location.origin || '') + '/server/oauth/logout';
});
```

### Local dev detection

```javascript
if (typeof catalyst === 'undefined' || !catalyst.auth ||
    protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1') {
  // Skip OAuth, use dev user
}
```

---

## Setup Steps

Follow this exact order:

1. **Zoho API Console** (`https://api-console.zoho.{dc}/`) -> your client -> Redirect URI -> set to `https://<domain>/server/oauth/callback`
2. **Create env vars file**: Copy `catalyst-config.example.json` -> `catalyst-config.json`, fill in all 5 values
3. **Deploy from CLI**: `catalyst deploy` from project root -- deploys both function and web client
4. **Test login**: Visit app -> click Sign in -> approve on Zoho -> should land on main app
5. **Test logout**: Click Sign out -> should land on login screen
6. **Test round-trip**: Sign in again -> should work without re-approving

---

## Debugging Checklist

If the user signs in on Zoho but lands back on the login screen:

1. **Check Catalyst logs** (Function -> Logs) for callback execution
2. **Is the cookie being set?** Look for `Set-Cookie` in the 302 response headers
3. **Is userinfo returning email?** Add `console.log('userinfo:', JSON.stringify(user))` in the callback
4. **Is the cookie being sent to /me?** Add `console.log('cookies:', req.headers.cookie)` in the /me handler
5. **Is the redirect going to the right place?** Must be `/app/index.html`, not `/index.html`
6. **Is APP_ORIGIN correct?** Domain only, no trailing slash, no path

---

## Why Not Catalyst Native Auth

Catalyst Native Auth was attempted and abandoned:

- **Embedded Login** (`catalyst.auth.signIn('container-id')`): Renders a full email/password form in a white iframe. No way to style it. It's not a button -- it's an entire auth form.
- **Hosted Login** (`/__catalyst/auth/login`): Project owner isn't automatically an app user. Catalyst has separate user pools (project admin vs app users). Got "account does not exist" error.
- **Direct Zoho OAuth** (recommended): Full design control, no ugly iframes, no provisioning issues, works with any Zoho account.

---

## Every Mistake Made

14 mistakes made building this flow. Each cost real debugging time.

1. Used Express in blank template -> `Cannot find module`
2. Used `createServer().listen()` -> `EADDRINUSE` on warm starts
3. Used `/oauth/v2/userinfo` -> no email returned
4. Used lowercase field names (`user.email`) -> Zoho returns `user.Email`
5. Redirected to `/index.html` instead of `/app/index.html`
6. Set cookie via `setHeader` then redirect via `writeHead` -> cookie lost
7. Used `SameSite=Strict` -> cookie blocked on Zoho redirect
8. Missing slash in redirect URL -> `INVALID_URL_PATTERN`
9. Didn't normalize varying Catalyst paths
10. Looked for scope setting in API Console -> it's a query parameter
11. Tried `catalyst deploy` from non-interactive shell -> hangs
12. Missing `functions` section in `catalyst.json` -> function silently not deployed
13. Missing `package.json` in function dir -> deploy skipped with `ENOENT`
14. `catalyst deploy` wiped Console-set env vars -> secrets deleted

**Rule**: All 5 env vars must be in `catalyst-config.json`. Gitignore it. Keep `catalyst-config.example.json` in git.

---

## Key Zoho URLs

Replace `{dc}` with your data center domain (`.com`, `.in`, `.eu`, `.com.au`).

| Purpose | URL |
|---------|-----|
| API Console | `https://api-console.zoho.{dc}/` |
| Authorization | `https://accounts.zoho.{dc}/oauth/v2/auth` |
| Token exchange | `https://accounts.zoho.{dc}/oauth/v2/token` |
| Userinfo | `https://accounts.zoho.{dc}/oauth/user/info` |
| OAuth scope | `scope=AaaServer.profile.READ` (query param, not API Console setting) |

### Per-project routes (replace `<domain>` with your Catalyst domain)

- App: `https://<domain>/app/index.html`
- Login: `https://<domain>/server/oauth/login`
- Callback: `https://<domain>/server/oauth/callback`
- Me: `https://<domain>/server/oauth/me`
- Logout: `https://<domain>/server/oauth/logout`
