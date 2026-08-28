/**
 * Connection credentials — the layer that turns a catalogue entry (connections-registry.js) into a
 * usable, authenticated API call.
 *
 * Supersedes the old `oauth-service.js` (deleted 2026-08-27 — written, never wired into index.js).
 * Its OAuth logic carried over largely intact; what's new is the service-key link to the registry,
 * the shared/personal scope model, re-authorisation, and support for the two non-OAuth auth types.
 *
 * Table: `connection_credentials`
 *   SERVICE_KEY, DC, SCOPE_LEVEL, OWNER_ID, AUTH_TYPE,
 *   CLIENT_ID, CLIENT_SECRET_ENC, REFRESH_TOKEN_ENC, ACCESS_TOKEN_ENC, TOKEN_EXPIRES_AT,
 *   STATIC_TOKEN_ENC, OAUTH_STATE, GRANTED_SCOPES, STATUS, LAST_USED_AT
 *
 * GRANTED_SCOPES records the scope string that was actually consented to. An OAuth grant is frozen
 * at consent time: when a scope is added to a service in connections-registry.js, the stored
 * refresh token keeps working but still carries the OLD grant, so calls needing the new scope fail
 * with a 401 that looks like a broken connection rather than a missing permission. Comparing it to
 * the registry's current scope string is what lets the UI say "re-authenticate" instead of leaving
 * someone to guess. See reauthorize().
 *
 * SCOPE MODEL — shared default with personal override:
 *   • A `shared` credential is the team's connection for a service. Any active member may use it;
 *     only an admin may create or revoke it.
 *   • A `user` credential belongs to one member and **takes precedence over the shared one for
 *     that member only**. That's the override.
 *   Resolution is always user-then-shared (see resolveCredential).
 *
 * SECRET HANDLING — every piece of OAuth material and every static token is AES-256-GCM encrypted
 * before it touches DataStore, and nothing here ever returns plaintext over HTTP. `toPublic()` is
 * the only shape that leaves this module for a response body. Decryption exists so the function can
 * *use* a credential server-side, never so a caller can read one back.
 */

const registry = require('./connections-registry');
const { encrypt, decrypt, esc, randomHex } = require('./crypto-util');

const TABLE = 'connection_credentials';
const { AUTH_TYPES, SCOPE_LEVELS } = registry;

/* ------------------------------------------------------------------ plumbing */

function services(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) throw new Error('Catalyst authentication required');
  return { table: app.datastore().table(TABLE), zcql: app.zcql() };
}

const unwrap = rows => (rows || []).map(r => r[TABLE] || r);

const COLUMNS =
  'ROWID, SERVICE_KEY, DC, SCOPE_LEVEL, OWNER_ID, AUTH_TYPE, CLIENT_ID, ' +
  'CLIENT_SECRET_ENC, REFRESH_TOKEN_ENC, ACCESS_TOKEN_ENC, TOKEN_EXPIRES_AT, ' +
  'STATIC_TOKEN_ENC, OAUTH_STATE, GRANTED_SCOPES, STATUS, LAST_USED_AT, CREATEDTIME';

/**
 * Does this credential's grant still match what the service asks for today?
 * Order-insensitive: the comparison is on the scope SET, so reordering the registry array does not
 * nag everyone to re-consent. Non-OAuth credentials have no grant and are never stale.
 */
function scopesStale(row, service) {
  if (row.AUTH_TYPE !== AUTH_TYPES.OAUTH) return false;
  const granted = String(row.GRANTED_SCOPES || '');
  // Blank means the row predates GRANTED_SCOPES. Don't cry wolf on rows we can't judge.
  if (!granted) return false;
  const norm = str => str.split(/[\s,]+/).filter(Boolean).sort().join(',');
  return norm(granted) !== norm(registry.scopeString(service));
}

/** Metadata only — no secret material, ever. */
const toPublic = row => ({
  id: row.ROWID,
  service_key: row.SERVICE_KEY,
  dc: row.DC,
  scope_level: row.SCOPE_LEVEL,
  auth_type: row.AUTH_TYPE,
  client_id: row.CLIENT_ID || null,
  status: row.STATUS,
  granted_scope_count: String(row.GRANTED_SCOPES || '').split(/[\s,]+/).filter(Boolean).length,
  token_expires_at: Number(row.TOKEN_EXPIRES_AT) || 0,
  expired: row.AUTH_TYPE === AUTH_TYPES.OAUTH && Number(row.TOKEN_EXPIRES_AT) > 0
    ? Number(row.TOKEN_EXPIRES_AT) <= Date.now()
    : false,
  owned_by_me: undefined, // filled in by listConnections, which knows the caller
  last_used_at: Number(row.LAST_USED_AT) || 0,
  created_at: row.CREATEDTIME,
});

class Denied extends Error {
  constructor(message) { super(message); this.status = 403; }
}

/** Only an admin may create, replace or revoke a team-shared credential. */
function assertMayWriteShared(req, scopeLevel) {
  if (scopeLevel === SCOPE_LEVELS.SHARED && req.caller?.role !== 'admin') {
    throw new Denied('Only an admin can configure a team-shared connection');
  }
}

function normaliseScopeLevel(value) {
  const v = String(value || SCOPE_LEVELS.USER).toLowerCase();
  if (v !== SCOPE_LEVELS.SHARED && v !== SCOPE_LEVELS.USER) {
    throw new Error(`scope_level must be '${SCOPE_LEVELS.SHARED}' or '${SCOPE_LEVELS.USER}'`);
  }
  return v;
}

/* ------------------------------------------------------------------ reads */

/**
 * The catalogue, annotated with what's configured for this caller:
 * the shared credential (if any) and the caller's own override (if any), plus which one wins.
 */
async function listConnections(req) {
  try {
    const { zcql } = services(req);
    const rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE STATUS != 'revoked' AND ` +
      `(SCOPE_LEVEL = '${SCOPE_LEVELS.SHARED}' OR OWNER_ID = '${esc(req.userId)}')`
    ));

    const connections = registry.publicCatalogue().map(service => {
      const forService = rows.filter(r => r.SERVICE_KEY === service.key);
      const shared = forService.find(r => r.SCOPE_LEVEL === SCOPE_LEVELS.SHARED);
      const mine = forService.find(
        r => r.SCOPE_LEVEL === SCOPE_LEVELS.USER && String(r.OWNER_ID) === String(req.userId)
      );
      const effective = mine || shared || null;
      const decorate = (row, ownedByMe) => ({
        ...toPublic(row),
        owned_by_me: ownedByMe,
        scopes_stale: scopesStale(row, service),
      });
      return {
        ...service,
        shared: shared ? decorate(shared, String(shared.OWNER_ID) === String(req.userId)) : null,
        mine: mine ? decorate(mine, true) : null,
        effective: effective
          ? { source: mine ? SCOPE_LEVELS.USER : SCOPE_LEVELS.SHARED, ...decorate(effective, String(effective.OWNER_ID) === String(req.userId)) }
          : null,
        configured: Boolean(effective && effective.STATUS === 'active'),
      };
    });

    return {
      success: true,
      connections,
      configured_count: connections.filter(c => c.configured).length,
      total_count: connections.length,
    };
  } catch (error) {
    console.error('Error listing connections:', error);
    return { success: false, error: error.message };
  }
}

/** DC profiles, for the UI's data-centre picker. */
function listProfiles() {
  return {
    success: true,
    profiles: Object.entries(registry.PROFILES).map(([dc, p]) => ({
      dc, dc_domain: p.dc_domain, accounts_domain: p.accounts_domain,
      appid: p.appid || null, timezone: p.timezone,
      services: Object.keys(p.domains),
    })),
  };
}

/* ------------------------------------------------------------------ OAuth flow */

async function zohoToken(dc, params) {
  const host = registry.getProfile(dc).accounts_domain;
  const resp = await fetch(`https://${host}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = await resp.json();
  if (json.error) throw new Error(`Zoho OAuth error: ${json.error}`);
  return json;
}

/**
 * Step 1 — record a pending credential (encrypted client secret) and hand back the Zoho consent
 * URL. Scopes come from the registry, not the client, so a caller can't quietly widen a grant.
 */
async function startOAuth(req, data, redirectUri) {
  try {
    const { table, zcql } = services(req);
    const service = registry.getService(data.service_key);
    if (service.auth_type !== AUTH_TYPES.OAUTH) {
      throw new Error(`'${service.key}' does not use OAuth — use the token endpoint instead`);
    }

    const scopeLevel = normaliseScopeLevel(data.scope_level);
    assertMayWriteShared(req, scopeLevel);

    const dc = String(data.dc || service.default_dc).toLowerCase();
    if (!registry.availableDcs(service).includes(dc)) {
      throw new Error(`'${service.key}' is not available in data centre '${dc}'`);
    }
    const { client_id, client_secret } = data;
    if (!client_id || !client_secret) throw new Error('client_id and client_secret are required');

    // Replace any existing credential at this level — one per (service, scope level, owner).
    const ownerFilter = scopeLevel === SCOPE_LEVELS.SHARED
      ? `SCOPE_LEVEL = '${SCOPE_LEVELS.SHARED}'`
      : `SCOPE_LEVEL = '${SCOPE_LEVELS.USER}' AND OWNER_ID = '${esc(req.userId)}'`;
    const existing = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE SERVICE_KEY = '${esc(service.key)}' AND ${ownerFilter} AND STATUS != 'revoked'`
    ));

    const state = randomHex(24);
    const row = {
      SERVICE_KEY: service.key,
      DC: dc,
      SCOPE_LEVEL: scopeLevel,
      OWNER_ID: String(req.userId),
      AUTH_TYPE: AUTH_TYPES.OAUTH,
      CLIENT_ID: client_id,
      CLIENT_SECRET_ENC: encrypt(client_secret),
      REFRESH_TOKEN_ENC: '',
      ACCESS_TOKEN_ENC: '',
      TOKEN_EXPIRES_AT: '0',
      STATIC_TOKEN_ENC: '',
      OAUTH_STATE: state,
      GRANTED_SCOPES: '',
      STATUS: 'pending',
      LAST_USED_AT: '0',
    };

    let id;
    if (existing.length) {
      id = existing[0].ROWID;
      await table.updateRow({ ROWID: String(id), ...row });
    } else {
      const inserted = await table.insertRow(row);
      id = inserted.ROWID;
    }

    const authUrl = `https://${registry.getProfile(dc).accounts_domain}/oauth/v2/auth` +
      `?scope=${encodeURIComponent(registry.scopeString(service))}` +
      `&client_id=${encodeURIComponent(client_id)}` +
      '&response_type=code' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      '&access_type=offline&prompt=consent' +
      `&state=${state}`;

    return { success: true, id, service_key: service.key, scope_level: scopeLevel, auth_url: authUrl };
  } catch (error) {
    console.error('Error starting OAuth:', error);
    return { success: false, error: error.message, status: error.status };
  }
}

/** Step 2 — exchange the authorization code for tokens, keyed by the one-time state token. */
async function handleCallback(req, { code, state }, redirectUri) {
  try {
    const { table, zcql } = services(req);
    if (!code || !state) throw new Error('Missing code or state in callback');
    if (!/^[a-f0-9]{48}$/.test(state)) throw new Error('Invalid state token');

    // Matched on OAUTH_STATE alone (minus revoked rows), not on STATUS = 'pending'. The state is a
    // cryptographically random one-time token cleared on use, so it is the real key here — and
    // re-authorising an already-active connection has to work too, which a pending-only filter
    // would block.
    const rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE OAUTH_STATE = '${state}' AND STATUS != 'revoked'`
    ));
    if (!rows.length) throw new Error('No connection matches this authorization');

    // A bulk configure puts the SAME state on one row per selected service, so a single consent
    // finishes all of them. A normal flow is just the n=1 case of this.
    const conn = rows[0];

    // The person finishing the flow must be the one who started it, whatever the scope level.
    if (String(conn.OWNER_ID) !== String(req.userId)) {
      throw new Denied('This connection was initiated by a different user');
    }

    // One code, one exchange — the resulting grant covers the union of scopes that was consented to.
    const tokens = await zohoToken(conn.DC, {
      code,
      client_id: conn.CLIENT_ID,
      client_secret: decrypt(conn.CLIENT_SECRET_ENC),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    if (!tokens.refresh_token) {
      throw new Error('Zoho returned no refresh token (needs access_type=offline and prompt=consent)');
    }

    const refreshEnc = encrypt(tokens.refresh_token);
    const accessEnc = encrypt(tokens.access_token);
    const expiresAt = String(Date.now() + (tokens.expires_in || 3600) * 1000);

    for (const row of rows) {
      await table.updateRow({
        ROWID: String(row.ROWID),
        REFRESH_TOKEN_ENC: refreshEnc,
        ACCESS_TOKEN_ENC: accessEnc,
        TOKEN_EXPIRES_AT: expiresAt,
        OAUTH_STATE: '', // one-time use
        // Each row records ITS OWN scope string, not the union that was consented to. That keeps
        // scopesStale() per-service: adding a scope to one service should flag only that one.
        GRANTED_SCOPES: registry.scopeString(registry.getService(row.SERVICE_KEY)),
        STATUS: 'active',
      });
    }

    return {
      success: true,
      service_key: conn.SERVICE_KEY,
      scope_level: conn.SCOPE_LEVEL,
      count: rows.length,
      service_keys: rows.map(r => r.SERVICE_KEY),
    };
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    return { success: false, error: error.message, status: error.status };
  }
}

/**
 * Configure several OAuth services at once: one client, one consent, one grant.
 *
 * Zoho lets a single OAuth client request scopes across products in one authorize call, so nine
 * services can be nine console registrations and nine approvals — or one of each. This is the
 * second.
 *
 * The hard constraint is the DATA CENTRE: consent happens at exactly one accounts host, so every
 * selected service must be available in the chosen DC. That is why Hacksaw can never be bundled
 * with the rest — it lives on accounts.zohocorpcloud.in (`zcc`) while the others are on
 * accounts.zoho.in (`in`). The caller picks a DC and only services available there can be selected.
 *
 * One row per service is written, all sharing one OAUTH_STATE, so the single callback finishes all
 * of them (see handleCallback). Each row still records its own scope string, so scope drift stays
 * per-service afterwards.
 */
async function startBulkOAuth(req, data, redirectUri) {
  try {
    const { table, zcql } = services(req);

    const keys = Array.isArray(data.service_keys) ? data.service_keys : [];
    if (keys.length === 0) throw new Error('Select at least one service');

    const scopeLevel = normaliseScopeLevel(data.scope_level);
    assertMayWriteShared(req, scopeLevel);

    const { client_id, client_secret } = data;
    if (!client_id || !client_secret) throw new Error('client_id and client_secret are required');

    const dc = String(data.dc || '').toLowerCase();
    if (!dc) throw new Error('dc is required');
    const profile = registry.getProfile(dc); // throws on an unknown DC

    const selected = keys.map(k => registry.getService(k));
    for (const service of selected) {
      if (service.auth_type !== AUTH_TYPES.OAUTH) {
        throw new Error(`'${service.key}' does not use OAuth — store its token separately`);
      }
      if (!registry.availableDcs(service).includes(dc)) {
        throw new Error(`'${service.key}' is not available in data centre '${dc}'`);
      }
    }

    // De-duplicated union, in registry order. Comma is Zoho's documented separator; WorkDrive's
    // setup script uses a space on its own, so if a bundle including WorkDrive is rejected at
    // consent, configure that one by itself.
    const scopes = [...new Set(selected.flatMap(x => x.scopes))];

    const state = randomHex(24);
    const secretEnc = encrypt(client_secret);
    const written = [];

    for (const service of selected) {
      const ownerFilter = scopeLevel === SCOPE_LEVELS.SHARED
        ? `SCOPE_LEVEL = '${SCOPE_LEVELS.SHARED}'`
        : `SCOPE_LEVEL = '${SCOPE_LEVELS.USER}' AND OWNER_ID = '${esc(req.userId)}'`;
      const existing = unwrap(await zcql.executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE} WHERE SERVICE_KEY = '${esc(service.key)}' AND ${ownerFilter} AND STATUS != 'revoked'`
      ));

      const row = {
        SERVICE_KEY: service.key,
        DC: dc,
        SCOPE_LEVEL: scopeLevel,
        OWNER_ID: String(req.userId),
        AUTH_TYPE: AUTH_TYPES.OAUTH,
        CLIENT_ID: client_id,
        CLIENT_SECRET_ENC: secretEnc,
        REFRESH_TOKEN_ENC: '',
        ACCESS_TOKEN_ENC: '',
        TOKEN_EXPIRES_AT: '0',
        STATIC_TOKEN_ENC: '',
        OAUTH_STATE: state,
        GRANTED_SCOPES: '',
        STATUS: 'pending',
        LAST_USED_AT: '0',
      };

      if (existing.length) {
        await table.updateRow({ ROWID: String(existing[0].ROWID), ...row });
        written.push({ key: service.key, id: existing[0].ROWID });
      } else {
        const inserted = await table.insertRow(row);
        written.push({ key: service.key, id: inserted.ROWID });
      }
    }

    const authUrl = `https://${profile.accounts_domain}/oauth/v2/auth` +
      `?scope=${encodeURIComponent(scopes.join(','))}` +
      `&client_id=${encodeURIComponent(client_id)}` +
      '&response_type=code' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      '&access_type=offline&prompt=consent' +
      `&state=${state}`;

    return {
      success: true,
      dc,
      scope_level: scopeLevel,
      services: written,
      scope_count: scopes.length,
      auth_url: authUrl,
    };
  } catch (error) {
    console.error('Error starting bulk OAuth:', error);
    return { success: false, error: error.message, status: error.status };
  }
}

/**
 * Re-run consent for an existing OAuth connection, reusing its stored client id and secret.
 *
 * The case this exists for: a service gains a scope in connections-registry.js. The stored refresh
 * token still refreshes fine, but it carries the grant as it was at consent time, so any call
 * needing the new scope 401s. Only a fresh consent widens a grant — refreshing never does.
 *
 * The existing tokens are deliberately left in place until the new consent completes. If the user
 * abandons the Zoho screen, the connection keeps working on the old grant instead of being left
 * half-broken.
 */
async function reauthorize(req, id, redirectUri) {
  try {
    const { table, zcql } = services(req);
    if (!/^\d+$/.test(String(id))) throw new Error('Invalid connection id');

    const rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE ROWID = ${id} AND STATUS != 'revoked'`
    ));
    if (!rows.length) throw new Error('Connection not found');
    const conn = rows[0];

    const service = registry.getService(conn.SERVICE_KEY);
    if (service.auth_type !== AUTH_TYPES.OAUTH) {
      throw new Error(`'${service.key}' does not use OAuth — replace its token instead`);
    }
    if (!conn.CLIENT_ID || !conn.CLIENT_SECRET_ENC) {
      throw new Error('This connection has no stored client credentials — configure it from scratch');
    }

    // Same authority as creating one at this level: shared is admin-only, personal is owner-only.
    if (conn.SCOPE_LEVEL === SCOPE_LEVELS.SHARED) {
      assertMayWriteShared(req, SCOPE_LEVELS.SHARED);
    } else if (String(conn.OWNER_ID) !== String(req.userId)) {
      throw new Denied('You do not own this connection');
    }

    const state = randomHex(24);
    await table.updateRow({ ROWID: String(conn.ROWID), OAUTH_STATE: state });

    const authUrl = `https://${registry.getProfile(conn.DC).accounts_domain}/oauth/v2/auth` +
      `?scope=${encodeURIComponent(registry.scopeString(service))}` +
      `&client_id=${encodeURIComponent(conn.CLIENT_ID)}` +
      '&response_type=code' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      '&access_type=offline&prompt=consent' +
      `&state=${state}`;

    return { success: true, id: conn.ROWID, service_key: service.key, auth_url: authUrl };
  } catch (error) {
    console.error('Error re-authorizing:', error);
    return { success: false, error: error.message, status: error.status };
  }
}

/* ------------------------------------------------------------------ static tokens */

/** CMTools (PRIVATE-TOKEN) and Repository (PAT) — no flow, just a token to store encrypted. */
async function saveStaticToken(req, data) {
  try {
    const { table, zcql } = services(req);
    const service = registry.getService(data.service_key);
    if (service.auth_type === AUTH_TYPES.OAUTH) {
      throw new Error(`'${service.key}' uses OAuth — start the consent flow instead`);
    }

    const scopeLevel = normaliseScopeLevel(data.scope_level);
    assertMayWriteShared(req, scopeLevel);

    const token = String(data.token || '').trim();
    if (!token) throw new Error('token is required');
    const dc = String(data.dc || service.default_dc).toLowerCase();

    const ownerFilter = scopeLevel === SCOPE_LEVELS.SHARED
      ? `SCOPE_LEVEL = '${SCOPE_LEVELS.SHARED}'`
      : `SCOPE_LEVEL = '${SCOPE_LEVELS.USER}' AND OWNER_ID = '${esc(req.userId)}'`;
    const existing = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE SERVICE_KEY = '${esc(service.key)}' AND ${ownerFilter} AND STATUS != 'revoked'`
    ));

    const row = {
      SERVICE_KEY: service.key,
      DC: dc,
      SCOPE_LEVEL: scopeLevel,
      OWNER_ID: String(req.userId),
      AUTH_TYPE: service.auth_type,
      CLIENT_ID: '',
      CLIENT_SECRET_ENC: '',
      REFRESH_TOKEN_ENC: '',
      ACCESS_TOKEN_ENC: '',
      TOKEN_EXPIRES_AT: '0',
      STATIC_TOKEN_ENC: encrypt(token),
      OAUTH_STATE: '',
      GRANTED_SCOPES: '',
      STATUS: 'active',
      LAST_USED_AT: '0',
    };

    let id;
    if (existing.length) {
      id = existing[0].ROWID;
      await table.updateRow({ ROWID: String(id), ...row });
    } else {
      id = (await table.insertRow(row)).ROWID;
    }
    return { success: true, id, service_key: service.key, scope_level: scopeLevel };
  } catch (error) {
    console.error('Error saving token:', error);
    return { success: false, error: error.message, status: error.status };
  }
}

/* ------------------------------------------------------------------ revoke */

async function revokeConnection(req, id) {
  try {
    const { table, zcql } = services(req);
    if (!/^\d+$/.test(String(id))) throw new Error('Invalid connection id');

    const rows = unwrap(await zcql.executeZCQLQuery(`SELECT ${COLUMNS} FROM ${TABLE} WHERE ROWID = ${id}`));
    if (!rows.length) throw new Error('Connection not found');
    const conn = rows[0];

    if (conn.SCOPE_LEVEL === SCOPE_LEVELS.SHARED) {
      assertMayWriteShared(req, SCOPE_LEVELS.SHARED);
    } else if (String(conn.OWNER_ID) !== String(req.userId) && req.caller?.role !== 'admin') {
      throw new Denied('You do not own this connection');
    }

    // Best-effort revoke at Zoho; the token may already be dead.
    if (conn.AUTH_TYPE === AUTH_TYPES.OAUTH && conn.REFRESH_TOKEN_ENC) {
      try {
        const host = registry.getProfile(conn.DC).accounts_domain;
        await fetch(`https://${host}/oauth/v2/token/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: decrypt(conn.REFRESH_TOKEN_ENC) }).toString(),
        });
      } catch (e) {
        console.log('Token revoke at Zoho failed (continuing):', e.message);
      }
    }

    await table.updateRow({
      ROWID: String(id),
      CLIENT_SECRET_ENC: '', REFRESH_TOKEN_ENC: '', ACCESS_TOKEN_ENC: '',
      STATIC_TOKEN_ENC: '', TOKEN_EXPIRES_AT: '0', OAUTH_STATE: '', STATUS: 'revoked',
    });

    return { success: true, message: `Connection '${conn.SERVICE_KEY}' revoked` };
  } catch (error) {
    console.error('Error revoking connection:', error);
    return { success: false, error: error.message, status: error.status };
  }
}

/* ------------------------------------------------------------------ internal use */

/**
 * Pick the credential that applies to this caller: their own override first, the team-shared one
 * otherwise. INTERNAL — the row it returns holds encrypted secrets and must never be serialised.
 */
async function resolveCredential(req, serviceKey, dc) {
  const { zcql } = services(req);
  const service = registry.getService(serviceKey);

  let where = `SERVICE_KEY = '${esc(service.key)}' AND STATUS = 'active'`;
  if (dc) where += ` AND DC = '${esc(String(dc).toLowerCase())}'`;

  const rows = unwrap(await zcql.executeZCQLQuery(`SELECT ${COLUMNS} FROM ${TABLE} WHERE ${where}`));
  const mine = rows.find(
    r => r.SCOPE_LEVEL === SCOPE_LEVELS.USER && String(r.OWNER_ID) === String(req.userId)
  );
  const shared = rows.find(r => r.SCOPE_LEVEL === SCOPE_LEVELS.SHARED);
  const chosen = mine || shared;
  if (!chosen) {
    throw new Error(`No active connection for '${service.key}'${dc ? ` in '${dc}'` : ''}`);
  }
  return { service, credential: chosen, source: mine ? SCOPE_LEVELS.USER : SCOPE_LEVELS.SHARED };
}

/**
 * A valid access token for a service, refreshing when it has under 5 minutes left — the same
 * buffer the kit's oauth-common.sh uses. INTERNAL ONLY: never expose this over HTTP.
 */
async function tokenForRow(table, credential) {
  if (credential.AUTH_TYPE !== AUTH_TYPES.OAUTH) {
    return decrypt(credential.STATIC_TOKEN_ENC);
  }
  if (Number(credential.TOKEN_EXPIRES_AT) - Date.now() > 5 * 60 * 1000) {
    return decrypt(credential.ACCESS_TOKEN_ENC);
  }

  const tokens = await zohoToken(credential.DC, {
    refresh_token: decrypt(credential.REFRESH_TOKEN_ENC),
    client_id: credential.CLIENT_ID,
    client_secret: decrypt(credential.CLIENT_SECRET_ENC),
    grant_type: 'refresh_token',
  });
  await table.updateRow({
    ROWID: String(credential.ROWID),
    ACCESS_TOKEN_ENC: encrypt(tokens.access_token),
    TOKEN_EXPIRES_AT: String(Date.now() + (tokens.expires_in || 3600) * 1000),
  });
  return tokens.access_token;
}

async function getAccessToken(req, serviceKey, dc) {
  const { table } = services(req);
  const { credential } = await resolveCredential(req, serviceKey, dc);
  return tokenForRow(table, credential);
}

/** The auth header a service expects, given a token. */
function authHeaderFor(service, token) {
  if (service.auth_type === AUTH_TYPES.OAUTH) {
    return { Authorization: `Zoho-oauthtoken ${token}` };
  }
  const name = service.auth_header || 'Authorization';
  return { [name]: (service.auth_header_format || '{token}').replace('{token}', token) };
}

/** Response bodies are returned whole; this is the ceiling that keeps one call from OOMing us. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Run the service's one read-only fetch operation against a SPECIFIC stored credential, and hand
 * back the whole response.
 *
 * The path comes from the registry, never the caller. The caller supplies only values for the
 * operation's declared params — anything else in the payload is ignored, and path values are
 * URL-encoded so a '/' can't escape the intended path. Without that, this route would be an
 * authenticated proxy into every service the team has connected.
 */
async function runFetch(req, id, inputs = {}) {
  const started = Date.now();
  try {
    const { table, zcql } = services(req);
    if (!/^\d+$/.test(String(id))) throw new Error('Invalid connection id');

    const rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE ROWID = ${id} AND STATUS = 'active'`
    ));
    if (!rows.length) throw new Error('No active connection with that id');
    const credential = rows[0];

    // A shared credential is usable by any member; a personal one only by its owner.
    if (credential.SCOPE_LEVEL === SCOPE_LEVELS.USER && String(credential.OWNER_ID) !== String(req.userId)) {
      throw new Denied('That connection belongs to someone else');
    }

    const service = registry.getService(credential.SERVICE_KEY);
    const op = registry.getFetchOperation(service.key);
    if (!op) throw new Error(`No fetch operation is defined for '${service.key}'`);

    // Only declared params are read. Unknown keys in `inputs` are dropped on the floor.
    const path = { ...{} };
    const query = new URLSearchParams(op.query || {});
    const body = {};
    let resolvedPath = op.path;

    for (const spec of op.params || []) {
      const raw = inputs[spec.name];
      const value = raw === undefined || raw === null ? '' : String(raw).trim();
      if (!value) {
        if (spec.required) throw new Error(`'${spec.label || spec.name}' is required`);
        continue;
      }
      if (spec.in === 'path') path[spec.name] = value;
      else if (spec.in === 'body') body[spec.name] = value;
      else query.set(spec.name, value);
    }

    // encodeURIComponent turns '/' into %2F, so a param cannot traverse out of its segment.
    resolvedPath = resolvedPath.replace(/\{(\w+)\}/g, (_m, name) => {
      if (!(name in path)) throw new Error(`Missing path value '${name}'`);
      return encodeURIComponent(path[name]);
    });

    // Values the DC profile knows and the user shouldn't have to type (appid, service, timezone).
    if (op.profileQuery) {
      const profile = registry.getProfile(credential.DC);
      for (const [param, field] of Object.entries(op.profileQuery)) {
        if (profile[field]) query.set(param, profile[field]);
      }
    }

    const token = await tokenForRow(table, credential);
    const host = registry.apiHost(service, credential.DC);
    const qs = query.toString();
    const url = `https://${host}${resolvedPath}${qs ? `?${qs}` : ''}`;

    const hasBody = op.method === 'POST';
    const response = await fetch(url, {
      method: op.method,
      headers: {
        Accept: 'application/json',
        ...authHeaderFor(service, token),
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    const truncated = text.length > MAX_BODY_BYTES;
    const shown = truncated ? text.slice(0, MAX_BODY_BYTES) : text;
    let parsed = null;
    try {
      parsed = JSON.parse(shown);
    } catch {
      parsed = null;
    }

    table.updateRow({ ROWID: String(credential.ROWID), LAST_USED_AT: String(Date.now()) })
      .catch(e => console.log('LAST_USED_AT update failed:', e.message));

    return {
      success: true,
      operation: op.label,
      method: op.method,
      // The URL is echoed so a 404 is debuggable. It carries no token — auth is a header.
      url,
      status: response.status,
      ok: response.ok,
      ms: Date.now() - started,
      truncated,
      body: parsed,
      raw: parsed === null ? shown : undefined,
    };
  } catch (error) {
    console.error('Error running fetch:', error);
    return { success: false, error: error.message, status: error.status, ms: Date.now() - started };
  }
}

/**
 * The one way future features should talk to a connected service. Resolves the credential, applies
 * the right auth header for its auth type, and builds the host from the DC profile.
 *
 *   const r = await callConnection(req, 'zoho-hacksaw', '/api/v1/products');
 *   const r = await callConnection(req, 'zoho-projects', '/restapi/portals/', { dc: 'in' });
 *
 * INTERNAL ONLY — do not put a route in front of this that takes a caller-supplied path, or the
 * app becomes an open proxy to every service the team has connected.
 */
async function callConnection(req, serviceKey, path, options = {}) {
  const { table } = services(req);
  const { service, credential } = await resolveCredential(req, serviceKey, options.dc);
  const token = await getAccessToken(req, serviceKey, options.dc);

  const headers = { Accept: 'application/json', ...authHeaderFor(service, token), ...(options.headers || {}) };

  const host = registry.apiHost(service, credential.DC);
  const url = `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
  const resp = await fetch(url, { method: options.method || 'GET', headers, body: options.body });

  // Fire-and-forget usage stamp; a failure here must not break the caller's request.
  table.updateRow({ ROWID: String(credential.ROWID), LAST_USED_AT: String(Date.now()) })
    .catch(e => console.log('LAST_USED_AT update failed:', e.message));

  return resp;
}

module.exports = {
  listConnections, listProfiles,
  startOAuth, startBulkOAuth, handleCallback, reauthorize, saveStaticToken, revokeConnection,
  runFetch,
  resolveCredential, getAccessToken, callConnection,
};
