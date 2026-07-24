const crypto = require('crypto');

const TABLE = 'credentials';

// ── Encryption (AES-256-GCM) ─────────────────────────────────────────
// Secrets are encrypted inside the function before touching DataStore.
// Key comes from the CRED_ENC_KEY env variable (32-byte hex).

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

// Escape SQL string values to prevent injection
const escapeSqlString = (value) => {
  return String(value).replace(/'/g, "''");
};

// Get services from authenticated Catalyst app.
// Data operations run admin-scoped (app users lack table privileges);
// per-user authorization is enforced via owner_id checks below.
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

// ZCQL returns rows wrapped per table: [{credentials: {...}}] — unwrap them
const unwrapRows = (rows) => (rows || []).map(r => r[TABLE] || r);

// ── Operations ───────────────────────────────────────────────────────

// Add credential (value encrypted at rest)
const addCredential = async (req, credentialData) => {
  try {
    const { table } = getServices(req);
    const userId = req.userId;

    if (!credentialData.credential_name || !credentialData.credential_type || !credentialData.credential_value) {
      throw new Error('Missing required: credential_name, credential_type, credential_value');
    }

    const newCredential = {
      credential_name: credentialData.credential_name,
      credential_type: credentialData.credential_type,
      credential_value: encrypt(credentialData.credential_value),
      owner_id: userId,
      is_active: 1
    };

    const rows = await table.insertRows([newCredential]);

    return {
      success: true,
      message: 'Credential created successfully',
      credential_id: rows[0].ROWID,
      credential_name: credentialData.credential_name
    };
  } catch (error) {
    console.error('Error adding credential:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Get credential (decrypts the stored value)
const getCredential = async (req, credentialName) => {
  try {
    const { zcql } = getServices(req);
    const userId = req.userId;

    const escapedName = escapeSqlString(credentialName);
    const query = `SELECT ROWID, credential_name, credential_type, credential_value, owner_id, is_active, CREATEDTIME FROM ${TABLE} WHERE credential_name = '${escapedName}' AND is_active = 1`;
    const rows = unwrapRows(await zcql.executeZCQLQuery(query));

    if (rows.length === 0) {
      throw new Error('Credential not found or inactive');
    }

    const credential = rows[0];

    // Check if owner matches (authorization)
    if (String(credential.owner_id) !== String(userId)) {
      throw new Error('Unauthorized: You do not own this credential');
    }

    return {
      success: true,
      credential: {
        credential_id: credential.ROWID,
        credential_name: credential.credential_name,
        credential_type: credential.credential_type,
        credential_value: decrypt(credential.credential_value),
        created_at: credential.CREATEDTIME
      }
    };
  } catch (error) {
    console.error('Error getting credential:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// List all credentials (metadata only — values are never returned here)
const listCredentials = async (req) => {
  try {
    const { zcql } = getServices(req);
    const userId = req.userId;

    if (!userId) {
      throw new Error('User ID required');
    }

    const query = `SELECT ROWID, credential_name, credential_type, is_active, CREATEDTIME FROM ${TABLE} WHERE owner_id = '${escapeSqlString(userId)}'`;
    const rows = unwrapRows(await zcql.executeZCQLQuery(query));

    return {
      success: true,
      credentials: rows,
      total_count: rows.length
    };
  } catch (error) {
    console.error('Error listing credentials:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Deactivate credential (clears the stored ciphertext)
const deactivateCredential = async (req, credentialId) => {
  try {
    const { table, zcql } = getServices(req);
    const userId = req.userId;

    // ROWIDs are 19-digit numbers > Number.MAX_SAFE_INTEGER — validate as digit string
    if (!/^\d+$/.test(String(credentialId))) {
      throw new Error('Invalid credential ID');
    }

    // Verify ownership
    const query = `SELECT ROWID, credential_name, owner_id FROM ${TABLE} WHERE ROWID = ${credentialId}`;
    const rows = unwrapRows(await zcql.executeZCQLQuery(query));

    if (rows.length === 0) {
      throw new Error('Credential not found');
    }

    if (String(rows[0].owner_id) !== String(userId)) {
      throw new Error('Unauthorized: You do not own this credential');
    }

    // Deactivate and wipe the encrypted value
    await table.updateRow({
      ROWID: credentialId,
      is_active: 0,
      credential_value: ''
    });

    return {
      success: true,
      message: 'Credential deactivated successfully'
    };
  } catch (error) {
    console.error('Error deactivating credential:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  addCredential,
  getCredential,
  listCredentials,
  deactivateCredential
};
