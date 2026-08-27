/**
 * AES-256-GCM helpers for the connections registry.
 *
 * Wire format: `v1:<iv-hex>:<authtag-hex>:<ciphertext-hex>` — the same format the old credential
 * vault used, so any ciphertext written before it was removed still decrypts.
 *
 * The key comes from CRED_ENC_KEY (32-byte hex), injected by the CLI at deploy time and never
 * committed. Nothing here is ever decrypted straight into an HTTP response: decryption exists so
 * the function can *use* a secret server-side, not so it can hand it back out.
 */

const crypto = require('crypto');

function getKey() {
  const hex = process.env.CRED_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('Encryption key not configured (CRED_ENC_KEY must be 32-byte hex)');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(payload) {
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Stored secret has an unknown format');
  }
  const [, ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

/** Escape a value for inlining into a ZCQL string literal. */
function esc(value) {
  return String(value === undefined || value === null ? '' : value).replace(/'/g, "''");
}

/** Cryptographically random hex string, used for OAuth state tokens. */
function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { getKey, encrypt, decrypt, esc, randomHex };
