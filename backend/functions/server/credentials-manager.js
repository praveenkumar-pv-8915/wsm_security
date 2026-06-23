/**
 * Credentials Manager - Secure storage of Hacksaw credentials
 * Encrypts and stores credentials in file-based persistent storage
 */

const { encryptToken, decryptToken } = require('./crypto');
const fs = require('fs');
const path = require('path');

class CredentialsManager {
  constructor(dbConnection = null, storageDir = null) {
    this.db = dbConnection;
    this.tableName = 'hacksaw_credentials';
    this.storageDir = storageDir || path.join(__dirname, '..', '..', '.credentials');
    this.storageFile = path.join(this.storageDir, 'hacksaw.json');

    // Ensure storage directory exists
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // Load credentials from file on startup
    this.loadFromFile();
  }

  /**
   * Load credentials from persistent storage file
   */
  loadFromFile() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const data = fs.readFileSync(this.storageFile, 'utf8');
        global.hacksawCredentialsStore = JSON.parse(data);
        console.log('✅ Credentials loaded from persistent storage');
      }
    } catch (error) {
      console.warn('⚠️  Could not load credentials from file:', error.message);
      global.hacksawCredentialsStore = {};
    }
  }

  /**
   * Save credentials to persistent storage file
   */
  saveToFile() {
    try {
      fs.writeFileSync(this.storageFile, JSON.stringify(global.hacksawCredentialsStore || {}, null, 2));
      console.log('✅ Credentials saved to persistent storage');
    } catch (error) {
      console.error('❌ Failed to save credentials to file:', error.message);
    }
  }

  /**
   * Store or update Hacksaw credentials
   */
  async storeCredentials(organisation, clientId, clientSecret, profile = 'in') {
    try {
      if (!organisation || !clientId || !clientSecret) {
        throw new Error('organisation, clientId, and clientSecret are required');
      }

      // Encrypt sensitive data
      const encryptedClientId = encryptToken(clientId);
      const encryptedClientSecret = encryptToken(clientSecret);
      const now = new Date().toISOString();

      console.log(`💾 Storing Hacksaw credentials for ${organisation}...`);

      // For now, store in memory (TODO: integrate with Catalyst datastore)
      if (!global.hacksawCredentialsStore) {
        global.hacksawCredentialsStore = {};
      }

      global.hacksawCredentialsStore[`hacksaw-${profile}`] = {
        service: `hacksaw-${profile}`,
        organisation,
        client_id_encrypted: encryptedClientId,
        client_secret_encrypted: encryptedClientSecret,
        profile,
        created_at: now,
        updated_at: now,
      };

      // Persist to file
      this.saveToFile();

      console.log(`✅ Credentials stored successfully for organisation: ${organisation}`);

      return {
        success: true,
        message: 'Credentials stored successfully',
        data: {
          service: `hacksaw-${profile}`,
          organisation,
          profile,
          stored_at: now,
        },
      };
    } catch (error) {
      console.error('❌ Error storing credentials:', error.message);
      throw error;
    }
  }

  /**
   * Retrieve stored credentials
   */
  async getCredentials(profile = 'in') {
    try {
      if (!global.hacksawCredentialsStore) {
        return null;
      }

      const stored = global.hacksawCredentialsStore[`hacksaw-${profile}`];

      if (!stored) {
        return null;
      }

      // Decrypt sensitive data
      const clientId = decryptToken(stored.client_id_encrypted);
      const clientSecret = decryptToken(stored.client_secret_encrypted);

      return {
        organisation: stored.organisation,
        clientId,
        clientSecret,
        profile: stored.profile,
        createdAt: stored.created_at,
        updatedAt: stored.updated_at,
      };
    } catch (error) {
      console.error('❌ Error retrieving credentials:', error.message);
      throw error;
    }
  }

  /**
   * Get credential metadata (without secrets)
   */
  async getCredentialMetadata(profile = 'in') {
    try {
      if (!global.hacksawCredentialsStore) {
        return null;
      }

      const stored = global.hacksawCredentialsStore[`hacksaw-${profile}`];

      if (!stored) {
        return null;
      }

      return {
        service: stored.service,
        organisation: stored.organisation,
        profile: stored.profile,
        createdAt: stored.created_at,
        updatedAt: stored.updated_at,
        isConfigured: true,
      };
    } catch (error) {
      console.error('❌ Error retrieving credential metadata:', error.message);
      throw error;
    }
  }

  /**
   * Delete stored credentials
   */
  async deleteCredentials(profile = 'in') {
    try {
      if (!global.hacksawCredentialsStore) {
        throw new Error('No credentials found');
      }

      const key = `hacksaw-${profile}`;
      if (!global.hacksawCredentialsStore[key]) {
        throw new Error(`No credentials found for profile: ${profile}`);
      }

      delete global.hacksawCredentialsStore[key];

      // Persist to file
      this.saveToFile();

      console.log(`✅ Credentials deleted for profile: ${profile}`);

      return {
        success: true,
        message: 'Credentials deleted successfully',
      };
    } catch (error) {
      console.error('❌ Error deleting credentials:', error.message);
      throw error;
    }
  }

  /**
   * Check if credentials are configured
   */
  async isConfigured(profile = 'in') {
    try {
      const creds = await this.getCredentialMetadata(profile);
      return creds !== null;
    } catch (error) {
      return false;
    }
  }
}

module.exports = CredentialsManager;