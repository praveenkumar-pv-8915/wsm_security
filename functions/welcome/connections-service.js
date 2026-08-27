/**
 * Connection credentials — the layer that turns a catalogue entry (connections-registry.js) into a
 * usable, authenticated API call.
 *
 * Supersedes `oauth-service.js`, which was written but never wired into index.js. Its OAuth logic
 * is carried over here largely intact; what's new is the service-key link to the registry, the
 * shared/personal scope model, and support for the two non-OAuth auth types.
 *
 * Table: `connection_credentials`
 *   SERVICE_KEY, DC, SCOPE_LEVEL, OWNER_ID, AUTH_TYPE,
 *   CLIENT_ID, CLIENT_SECRET_ENC, REFRESH_TOKEN_ENC, ACCESS_TOKEN_ENC, TOKEN_EXPIRES_AT,
 *   STATIC_TOKEN_ENC, OAUTH_STATE, STATUS, LAST_USED_AT
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
  'STATIC_TOKEN_ENC, OAUTH_STATE, STATUS, LAST_USED_AT, CREATEDTIME';

/** Metadata only — no secret material, ever. */
const toPublic = row => ({
  id: row.ROWID,
  service_key: row.SERVICE_KEY,
  dc: row.DC,
  scope_level: row.SCOPE_LEVEL,
  auth_type: row.AUTH_TYPE,
  client_id: row.CLIENT_ID || null,
  status: row.STATUS,
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
      return {
        ...service,
        shared: shared ? { ...toPublic(shared), owned_by_me: String(shared.OWNER_ID) === String(req.userId) } : null,
        mine: mine ? { ...toPublic(mine), owned_by_me: true } : null,
        effective: effective
          ? { source: mine ? SCOPE_LEVELS.USER : SCOPE_LEVELS.SHARED, ...toPublic(effective) }
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

    const rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE OAUTH_STATE = '${state}' AND STATUS = 'pending'`
    ));
    if (!rows.length) throw new Error('No pending connection matches this authorization');
    const conn = rows[0];

    // The person finishing the flow must be the one who started it, whatever the scope level.
    if (String(conn.OWNER_ID) !== String(req.userId)) {
      throw new Denied('This connection was initiated by a different user');
    }

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

    await table.updateRow({
      ROWID: String(conn.ROWID),
      REFRESH_TOKEN_ENC: encrypt(tokens.refresh_token),
      ACCESS_TOKEN_ENC: encrypt(tokens.access_token),
      TOKEN_EXPIRES_AT: String(Date.now() + (tokens.expires_in || 3600) * 1000),
      OAUTH_STATE: '', // one-time use
      STATUS: 'active',
    });

    return { success: true, service_key: conn.SERVICE_KEY, scope_level: conn.SCOPE_LEVEL };
  } catch (error) {
    console.error('Error in OAuth callback:', error);
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
async function getAccessToken(req, serviceKey, dc) {
  const { table } = services(req);
  const { credential } = await resolveCredential(req, serviceKey, dc);

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

  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (service.auth_type === AUTH_TYPES.OAUTH) {
    headers.Authorization = `Zoho-oauthtoken ${token}`;
  } else {
    const name = service.auth_header || 'Authorization';
    headers[name] = (service.auth_header_format || '{token}').replace('{token}', token);
  }

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
  startOAuth, handleCallback, saveStaticToken, revokeConnection,
  resolveCredential, getAccessToken, callConnection,
};
