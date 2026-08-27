const crypto = require('crypto');

const TABLE = 'oauth_connections';

// ── Zoho DC profiles (accounts domains) ──────────────────────────────
const DC_ACCOUNTS = {
  in: 'accounts.zoho.in',
  us: 'accounts.zoho.com',
  eu: 'accounts.zoho.eu',
  uk: 'accounts.zoho.uk',
  ae: 'accounts.zoho.ae',
  jp: 'accounts.zoho.jp',
  au: 'accounts.zoho.com.au',
  ca: 'accounts.zohocloud.ca',
  localzoho: 'accounts.localzoho.com'
};

// ── Encryption (AES-256-GCM) ─────────────────────────────────────────
// All OAuth material (client secret, refresh/access tokens) is encrypted
// inside the function before touching DataStore. Nothing is ever
// decrypted for an HTTP response — decryption is internal-only.

const getKey = () => {
  const hex = process.env.CRED_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('Encryption key not configured (CRED_ENC_KEY must be 32-byte hex)');
  }
  return Buffer.from(hex, 'hex');
};

const encrypt = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
};

const decrypt = (payload) => {
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Stored secret has an unknown format');
  }
  const [, ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final()
  ]).toString('utf8');
};

// ── Helpers ──────────────────────────────────────────────────────────

const escapeSqlString = (value) => String(value).replace(/'/g, "''");

const getServices = (req) => {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) {
    throw new Error('Catalyst authentication required');
  }
  return {
    table: app.datastore().table(TABLE),
    zcql: app.zcql()
  };
};

// ZCQL returns rows wrapped per table: [{oauth_connections: {...}}]
const unwrapRows = (rows) => (rows || []).map(r => r[TABLE] || r);

const accountsHost = (dc) => {
  const host = DC_ACCOUNTS[dc];
  if (!host) throw new Error(`Unknown DC '${dc}'. Valid: ${Object.keys(DC_ACCOUNTS).join(', ')}`);
  return host;
};

// POST to Zoho accounts token endpoint (node18 global fetch)
const zohoTokenRequest = async (dc, params) => {
  const url = `https://${accountsHost(dc)}/oauth/v2/token`;
  const body = new URLSearchParams(params);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const json = await resp.json();
  if (json.error) {
    throw new Error(`Zoho OAuth error: ${json.error}`);
  }
  return json;
};

// Public metadata view of a connection row — never any secret material
const toPublic = (row) => ({
  connection_id: row.ROWID,
  connection_name: row.connection_name,
  dc: row.dc,
  scope: row.scope,
  client_id: row.client_id,
  status: row.status,
  token_expires_at: row.token_expires_at,
  created_at: row.CREATEDTIME
});

// ── Operations ───────────────────────────────────────────────────────

// Step 1: create a connection (encrypted client secret) and return the
// Zoho consent URL for the browser to visit.
const createConnection = async (req, data, redirectUri) => {
  try {
    const { table, zcql } = getServices(req);
    const userId = req.userId;

    const { connection_name, dc, scope, client_id, client_secret } = data || {};
    if (!connection_name || !dc || !scope || !client_id || !client_secret) {
      throw new Error('Missing required: connection_name, dc, scope, client_id, client_secret');
    }
    accountsHost(dc); // validates DC

    // Reject duplicate active names for this owner
    const dupes = unwrapRows(await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE connection_name = '${escapeSqlString(connection_name)}' AND owner_id = '${escapeSqlString(userId)}' AND status != 'revoked'`
    ));
    if (dupes.length > 0) {
      throw new Error(`Connection '${connection_name}' already exists`);
    }

    // CSRF/state token ties the callback to this row
    const state = crypto.randomBytes(24).toString('hex');

    const rows = await table.insertRows([{
      connection_name,
      dc,
      scope,
      client_id,
      client_secret_enc: encrypt(client_secret),
      refresh_token_enc: '',
      access_token_enc: '',
      token_expires_at: 0,
      oauth_state: state,
      owner_id: userId,
      status: 'pending'
    }]);

    const authUrl = `https://${accountsHost(dc)}/oauth/v2/auth` +
      `?scope=${encodeURIComponent(scope)}` +
      `&client_id=${encodeURIComponent(client_id)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&access_type=offline&prompt=consent` +
      `&state=${state}`;

    return {
      success: true,
      connection_id: rows[0].ROWID,
      auth_url: authUrl
    };
  } catch (error) {
    console.error('Error creating connection:', error);
    return { success: false, error: error.message };
  }
};

// Step 2: OAuth callback — exchange the authorization code for tokens
// and store them encrypted. Looked up via the state token.
const handleCallback = async (req, { code, state }, redirectUri) => {
  try {
    const { table, zcql } = getServices(req);

    if (!code || !state) {
      throw new Error('Missing code or state in callback');
    }
    if (!/^[a-f0-9]{48}$/.test(state)) {
      throw new Error('Invalid state token');
    }

    const rows = unwrapRows(await zcql.executeZCQLQuery(
      `SELECT ROWID, connection_name, dc, client_id, client_secret_enc, owner_id FROM ${TABLE} WHERE oauth_state = '${state}' AND status = 'pending'`
    ));
    if (rows.length === 0) {
      throw new Error('No pending connection matches this authorization');
    }
    const conn = rows[0];

    // Callback must be completed by the same user who started the flow
    if (String(conn.owner_id) !== String(req.userId)) {
      throw new Error('Unauthorized: connection was initiated by a different user');
    }

    const tokens = await zohoTokenRequest(conn.dc, {
      code,
      client_id: conn.client_id,
      client_secret: decrypt(conn.client_secret_enc),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    if (!tokens.refresh_token) {
      throw new Error('Zoho did not return a refresh token (ensure access_type=offline and prompt=consent)');
    }

    const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;

    await table.updateRow({
      ROWID: conn.ROWID,
      refresh_token_enc: encrypt(tokens.refresh_token),
      access_token_enc: encrypt(tokens.access_token),
      token_expires_at: expiresAt,
      oauth_state: '',       // one-time use
      status: 'active'
    });

    return { success: true, connection_name: conn.connection_name };
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    return { success: false, error: error.message };
  }
};

// List connections — metadata only, never secrets/tokens
const listConnections = async (req) => {
  try {
    const { zcql } = getServices(req);
    const userId = req.userId;

    const rows = unwrapRows(await zcql.executeZCQLQuery(
      `SELECT ROWID, connection_name, dc, scope, client_id, status, token_expires_at, CREATEDTIME FROM ${TABLE} WHERE owner_id = '${escapeSqlString(userId)}' AND status != 'revoked'`
    ));

    return {
      success: true,
      connections: rows.map(toPublic),
      total_count: rows.length
    };
  } catch (error) {
    console.error('Error listing connections:', error);
    return { success: false, error: error.message };
  }
};

// Revoke a connection: revoke the refresh token at Zoho, wipe local material
const deleteConnection = async (req, connectionId) => {
  try {
    const { table, zcql } = getServices(req);
    const userId = req.userId;

    // ROWIDs exceed Number.MAX_SAFE_INTEGER — validate as digit string
    if (!/^\d+$/.test(String(connectionId))) {
      throw new Error('Invalid connection ID');
    }

    const rows = unwrapRows(await zcql.executeZCQLQuery(
      `SELECT ROWID, connection_name, dc, refresh_token_enc, owner_id FROM ${TABLE} WHERE ROWID = ${connectionId}`
    ));
    if (rows.length === 0) {
      throw new Error('Connection not found');
    }
    const conn = rows[0];

    if (String(conn.owner_id) !== String(userId)) {
      throw new Error('Unauthorized: You do not own this connection');
    }

    // Best-effort revoke at Zoho (token may already be invalid)
    if (conn.refresh_token_enc) {
      try {
        const refreshToken = decrypt(conn.refresh_token_enc);
        await fetch(`https://${accountsHost(conn.dc)}/oauth/v2/token/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }).toString()
        });
      } catch (e) {
        console.log('Token revoke at Zoho failed (continuing):', e.message);
      }
    }

    await table.updateRow({
      ROWID: connectionId,
      client_secret_enc: '',
      refresh_token_enc: '',
      access_token_enc: '',
      token_expires_at: 0,
      oauth_state: '',
      status: 'revoked'
    });

    return { success: true, message: `Connection '${conn.connection_name}' revoked` };
  } catch (error) {
    console.error('Error deleting connection:', error);
    return { success: false, error: error.message };
  }
};

// INTERNAL ONLY — never expose over HTTP.
// Returns a valid access token for a connection, auto-refreshing when
// expired (5-minute buffer), mirroring get_access_token in oauth-common.sh.
const getAccessToken = async (req, connectionName) => {
  const { table, zcql } = getServices(req);

  const rows = unwrapRows(await zcql.executeZCQLQuery(
    `SELECT ROWID, dc, client_id, client_secret_enc, refresh_token_enc, access_token_enc, token_expires_at FROM ${TABLE} WHERE connection_name = '${escapeSqlString(connectionName)}' AND status = 'active'`
  ));
  if (rows.length === 0) {
    throw new Error(`No active connection named '${connectionName}'`);
  }
  const conn = rows[0];

  // Reuse current token if it has >5 minutes left
  if (Number(conn.token_expires_at) - Date.now() > 5 * 60 * 1000) {
    return decrypt(conn.access_token_enc);
  }

  // Refresh
  const tokens = await zohoTokenRequest(conn.dc, {
    refresh_token: decrypt(conn.refresh_token_enc),
    client_id: conn.client_id,
    client_secret: decrypt(conn.client_secret_enc),
    grant_type: 'refresh_token'
  });

  const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
  await table.updateRow({
    ROWID: conn.ROWID,
    access_token_enc: encrypt(tokens.access_token),
    token_expires_at: expiresAt
  });

  return tokens.access_token;
};

module.exports = {
  createConnection,
  handleCallback,
  listConnections,
  deleteConnection,
  getAccessToken
};
