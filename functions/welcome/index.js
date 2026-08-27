/**
 * welcome — WSM Security credential vault + connections registry.
 *
 * Catalyst Advanced I/O function (node18), mounted at:
 *   https://wsm-security-60073792083.development.catalystserverless.in/server/welcome/
 *
 * Auth: Catalyst default Hosted Authentication, gated by auth.js — a live session plus an
 * @zohocorp.com email is enough; there is no separate `members` table (2026-08-27 decision, see
 * CLAUDE.md and the project KB). Ownership is `user_id`, never email; role comes straight from the
 * session's role_details. The old inline middleware checked only that *some* Catalyst user existed,
 * which let any account that could sign up reach the vault — this closes that gap without adding a
 * table or storing PII.
 *
 * Storage: Catalyst DataStore. `credentials` (vault, unchanged), plus `connections` /
 * `connection_profiles` (the catalogue) and `connection_credentials` (encrypted tokens).
 *
 * Secrets: CRED_ENC_KEY (32-byte hex) is injected at deploy time and must never be committed.
 */

const express = require('express');
const catalyst = require('zcatalyst-sdk-node');

const { requireMember, requireAdmin } = require('./auth');
const { addCredential, getCredential, listCredentials, deactivateCredential } = require('./credential-service');
const registry = require('./connections-registry');
const conn = require('./connections-service');

const app = express();
app.use(express.json({ limit: '256kb' }));

/* ------------------------------------------------------------------ public */

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'welcome', version: '2.0.0' });
});
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Credential Management API Running', version: '2.0.0' });
});

// Root → the React client served by Catalyst client hosting.
app.get('/', (_req, res) => res.redirect('/app/'));

/**
 * There is deliberately NO /logout route.
 *
 * The old one cleared a `JSESSIONID` cookie — a name Catalyst does not use — and then redirected to
 * the hosted login page. The session survived, Catalyst saw it and bounced the browser straight
 * back into the app, so "Sign out" appeared to do nothing. Only the Web SDK can end a Catalyst
 * session; the SPA calls `catalyst.auth.signOut(url)` (frontend/src/lib/catalyst.js).
 */

/* ------------------------------------------------------------------ auth gate */

app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(requireMember(catalyst));

/* ------------------------------------------------------------------ helpers */

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Send a service-result object, honouring an error `status` if one was set. */
const send = (res, result, okStatus = 200) =>
  res.status(result.success ? okStatus : (result.status || 400)).json(result);

/**
 * This function's absolute base URL, needed for the OAuth redirect_uri. Express sees paths without
 * the `/server/welcome` mount prefix, so it has to be added back explicitly. Always https —
 * Catalyst terminates TLS upstream, so req.protocol can read as http.
 */
const selfBase = req => `https://${req.get('host')}/server/welcome`;
const oauthRedirectUri = req => `${selfBase(req)}/api/connections/oauth/callback`;

/* ------------------------------------------------------------------ identity */

app.get('/api/me', (req, res) => {
  res.json({ success: true, allowed: true, ...req.caller });
});

/* ------------------------------------------------------------------ credential vault */

app.post('/api/credentials/add', wrap(async (req, res) => {
  send(res, await addCredential(req, req.body), 201);
}));

app.get('/api/credentials', wrap(async (req, res) => {
  send(res, await listCredentials(req));
}));

app.get('/api/credentials/:name', wrap(async (req, res) => {
  send(res, await getCredential(req, req.params.name));
}));

app.delete('/api/credentials/:id', wrap(async (req, res) => {
  // ROWID exceeds Number.MAX_SAFE_INTEGER — must stay a string.
  send(res, await deactivateCredential(req, req.params.id));
}));

/* ------------------------------------------------------------------ connections */

/** The catalogue, annotated with the shared credential, the caller's override, and which wins. */
app.get('/api/connections', wrap(async (req, res) => {
  send(res, await conn.listConnections(req));
}));

/** Data-centre profiles for the DC picker. */
app.get('/api/connections/profiles', (_req, res) => {
  send(res, conn.listProfiles());
});

/** The scope/host definitions straight from code — useful for diffing against the kit. */
app.get('/api/connections/catalogue', (_req, res) => {
  res.json({ success: true, catalogue: registry.publicCatalogue() });
});

/** Mirror the code catalogue into the DataStore tables. Idempotent; admin only. */
app.post('/api/connections/seed', requireAdmin, wrap(async (req, res) => {
  const result = await registry.seedRegistry(req.catalystAdmin || req.catalystApp);
  res.json({ success: true, ...result });
}));

/**
 * Begin an OAuth consent flow.
 * Body: { service_key, dc?, client_id, client_secret, scope_level: 'shared' | 'user' }
 * Scopes come from the registry, never the client. Returns { auth_url } for the browser to visit.
 *
 * The redirect URI below must be registered against the client_id in the Zoho API console.
 */
app.post('/api/connections/oauth/start', wrap(async (req, res) => {
  const result = await conn.startOAuth(req, req.body || {}, oauthRedirectUri(req));
  send(res, { ...result, redirect_uri: oauthRedirectUri(req) }, 201);
}));

/**
 * OAuth callback. Zoho redirects the browser here, so this responds with a page-level redirect back
 * into the SPA rather than JSON.
 */
app.get('/api/connections/oauth/callback', wrap(async (req, res) => {
  const result = await conn.handleCallback(req, req.query || {}, oauthRedirectUri(req));
  const status = result.success ? 'connected' : 'failed';
  const detail = result.success ? result.service_key : (result.error || 'unknown error');
  res.redirect(`/app/#/connections?status=${status}&detail=${encodeURIComponent(detail)}`);
}));

/**
 * Store a static token for a non-OAuth connection (CMTools PRIVATE-TOKEN, Repository PAT).
 * Body: { service_key, dc?, token, scope_level: 'shared' | 'user' }
 */
app.post('/api/connections/token', wrap(async (req, res) => {
  send(res, await conn.saveStaticToken(req, req.body || {}), 201);
}));

/** Revoke at Zoho where applicable, then wipe the stored material. */
app.delete('/api/connections/:id', wrap(async (req, res) => {
  send(res, await conn.revokeConnection(req, req.params.id));
}));

/* ------------------------------------------------------------------ errors */

app.use((_req, res) => res.status(404).json({ success: false, error: 'No such route' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('welcome error:', err);
  res.status(status).json({ success: false, error: status >= 500 ? 'Internal error' : err.message });
});

module.exports = app;
