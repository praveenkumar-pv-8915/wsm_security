/**
 * Token Encryption/Decryption Utilities
 * Encrypts OAuth tokens before storing in database
 */

const crypto = require('crypto');
const config = require('./config');

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Encrypt token before storing in Catalyst Datastore
 */
function encryptToken(token) {
  try {
    if (!token) return null;

    // Generate random IV and salt
    const iv = crypto.randomBytes(12);
    const salt = crypto.randomBytes(SALT_LENGTH);

    // Derive key from encryption key + salt
    const key = crypto.pbkdf2Sync(
      config.token.encryptionKey,
      salt,
      100000,
      32,
      'sha256'
    );

    // Encrypt
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Combine: salt + iv + authTag + encrypted
    const combined = Buffer.concat([salt, iv, authTag, Buffer.from(encrypted, 'hex')]);

    return combined.toString('base64');
  } catch (error) {
    console.error('Token encryption failed:', error.message);
    throw new Error('Failed to encrypt token');
  }
}

/**
 * Decrypt token from Catalyst Datastore
 */
function decryptToken(encryptedToken) {
  try {
    if (!encryptedToken) return null;

    // Decode from base64
    const combined = Buffer.from(encryptedToken, 'base64');

    // Extract components
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + 12);
    const authTag = combined.slice(SALT_LENGTH + 12, SALT_LENGTH + 12 + TAG_LENGTH);
    const encrypted = combined.slice(SALT_LENGTH + 12 + TAG_LENGTH);

    // Derive same key
    const key = crypto.pbkdf2Sync(
      config.token.encryptionKey,
      salt,
      100000,
      32,
      'sha256'
    );

    // Decrypt
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Token decryption failed:', error.message);
    return null;
  }
}

/**
 * Generate a simple token hash for quick lookup (not for security, just indexing)
 */
function generateTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  encryptToken,
  decryptToken,
  generateTokenHash,
};