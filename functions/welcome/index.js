/**
 * welcome — WSM Security connections registry.
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
 * Storage: Catalyst DataStore, ONE table — `connection_credentials` (encrypted tokens).
 * The catalogue itself (services, scopes, DC hosts) is code, in connections-registry.js. It was
 * briefly mirrored into `connections` / `connection_profiles` tables; nothing ever read them, and
 * scopes are a security boundary that belongs in a reviewed diff rather than a console-editable
 * row, so the mirroring is gone (2026-08-27).
 *
 * There is no general-purpose credential vault. `credentials` + credential-service.js were removed
 * once it was settled that the only secrets this app stores are the ones connections need — those
 * live in `connection_credentials`, keyed to a service, and are never returned over HTTP.
 *
 * Secrets: CRED_ENC_KEY (32-byte hex) is injected at deploy time and must never be committed.
 */

const express = require('express');
const catalyst = require('zcatalyst-sdk-node');

const { requireMember } = require('./auth');
const registry = require('./connections-registry');
const conn = require('./connections-service');

const app = express();
app.use(express.json({ limit: '256kb' }));

/* ------------------------------------------------------------------ public */

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'welcome', version: '3.0.0' });
});
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Connections API running', version: '3.0.0' });
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
 * This function's absolute base URL, needed for the OAuth redirect_uri.
 *
 * Three things have to be right or Zoho rejects the flow, and it compares the string literally:
 *
 * 1. Always https. Catalyst terminates TLS upstream, so req.protocol reads as http.
 * 2. The `/server/welcome` mount prefix has to be added back — Express sees paths without it.
 * 3. **Strip a `:443` port.** Catalyst's proxy sets Host to `hostname:443`, and interpolating that
 *    raw produced `https://…catalystserverless.in:443/…`, which no console entry will ever match
 *    (nobody registers the default port). 443 is the default for https, so per RFC 3986 the
 *    port-less form is the canonical one. Only 443 is stripped — a genuinely non-default port
 *    still belongs in the URI.
 *
 * The same value is sent at /authorize and again at the token exchange, and Zoho requires those to
 * be identical, so this must stay the single place it is built.
 */
const selfHost = req => String(req.get('host') || '').replace(/:443$/, '');
const selfBase = req => `https://${selfHost(req)}/server/welcome`;
const oauthRedirectUri = req => `${selfBase(req)}/api/connections/oauth/callback`;

/* ------------------------------------------------------------------ identity */

app.get('/api/me', (req, res) => {
  res.json({ success: true, allowed: true, ...req.caller });
});

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

/**
 * Begin an OAuth consent flow.
 * Body: { service_key, dc?, client_id, client_secret, scope_level: 'shared' | 'user' }
 * Scopes come from the registry, never the client. Returns { auth_url } for the browser to visit.
 *
 * The redirect URI below must be registered against the client_id in the Zoho API console.
 */
/**
 * Re-run consent for a connection that is already configured, reusing the stored client id and
 * secret so nobody has to paste them again. This is the path to take when a service's scope list
 * grows: the old refresh token still works but carries the OLD grant, so the new scopes 401 until
 * the user re-consents.
 */
app.post('/api/connections/:id/reauthorize', wrap(async (req, res) => {
  const result = await conn.reauthorize(req, req.params.id, oauthRedirectUri(req));
  send(res, { ...result, redirect_uri: oauthRedirectUri(req) }, 201);
}));

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
