/**
 * Credentials Manager - Secure storage of Hacksaw credentials
 * Supports multiple storage backends:
 * - SQLite (local development)
 * - Catalyst Datastore (production)
 * - File-based fallback
 */

const { encryptToken, decryptToken } = require('./crypto');
const fs = require('fs');
const path = require('path');

class CredentialsManager {
  constructor(dbConnection = null, storageDir = null) {
    this.db = dbConnection;
    this.tableName = 'hacksaw_credentials';
    this.environment = process.env.ENVIRONMENT || 'development';
    this.storageDir = storageDir || path.join(__dirname, '..', '..', '.credentials');
    this.storageFile = path.join(this.storageDir, 'hacksaw.json');

    // Initialize storage backend
    this.initializeStorage();
  }

  /**
   * Initialize storage backend based on environment
   */
  initializeStorage() {
    try {
      if (this.environment === 'production' && this.db) {
        console.log('🗄️  Using Catalyst Datastore for credentials');
        this.storageType = 'catalyst';
        this.initializeCatalyst();
      } else {
        // Try SQLite for local development
        try {
          const sqlite3 = require('sqlite3').verbose();
          console.log('🗄️  Using SQLite for credentials (local development)');
          this.storageType = 'sqlite';
          this.initializeSQLite();
        } catch (e) {
          // Fall back to file-based storage
          console.log('💾 Using file-based storage for credentials (fallback)');
          this.storageType = 'file';
          this.initializeFileStorage();
        }
      }
    } catch (error) {
      console.error('❌ Storage initialization error:', error.message);
      this.initializeFileStorage();
    }
  }

  /**
   * Initialize SQLite database
   */
  initializeSQLite() {
    try {
      const sqlite3 = require('sqlite3').verbose();
      const dbPath = path.join(this.storageDir, 'hacksaw.db');

      // Ensure directory exists
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      this.sqlite = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('❌ SQLite error:', err.message);
          throw err;
        }
        console.log('✅ Connected to SQLite database');
      });

      // Create table if it doesn't exist
      this.sqlite.run(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service TEXT UNIQUE NOT NULL,
          organisation TEXT NOT NULL,
          client_id_encrypted TEXT NOT NULL,
          client_secret_encrypted TEXT NOT NULL,
          profile TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `, (err) => {
        if (err) {
          console.error('❌ Failed to create table:', err.message);
        } else {
          console.log('✅ SQLite table ready');
        }
      });

      // Load credentials from SQLite on startup
      this.loadFromSQLite();
    } catch (error) {
      console.warn('⚠️  SQLite initialization failed:', error.message);
      this.initializeFileStorage();
    }
  }

  /**
   * Initialize Catalyst Datastore
   */
  initializeCatalyst() {
    // Catalyst integration would go here
    // For now, fall back to file storage
    console.log('⚠️  Catalyst integration pending, using file storage');
    this.initializeFileStorage();
  }

  /**
   * Initialize file-based storage
   */
  initializeFileStorage() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      console.log('✅ File storage ready');
      this.loadFromFile();
    } catch (error) {
      console.error('❌ File storage initialization failed:', error.message);
      global.hacksawCredentialsStore = {};
    }
  }

  /**
   * Load credentials from SQLite
   */
  loadFromSQLite() {
    if (!this.sqlite) return;

    this.sqlite.all(`SELECT * FROM ${this.tableName}`, (err, rows) => {
      if (err) {
        console.error('❌ Failed to load from SQLite:', err.message);
        return;
      }

      global.hacksawCredentialsStore = {};
      if (rows && rows.length > 0) {
        rows.forEach(row => {
          global.hacksawCredentialsStore[row.service] = {
            service: row.service,
            organisation: row.organisation,
            client_id_encrypted: row.client_id_encrypted,
            client_secret_encrypted: row.client_secret_encrypted,
            profile: row.profile,
            created_at: row.created_at,
            updated_at: row.updated_at,
          };
        });
        console.log(`✅ Loaded ${rows.length} credential(s) from SQLite`);
      }
    });
  }

  /**
   * Load credentials from file
   */
  loadFromFile() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const data = fs.readFileSync(this.storageFile, 'utf8');
        global.hacksawCredentialsStore = JSON.parse(data);
        console.log('✅ Credentials loaded from file storage');
      } else {
        global.hacksawCredentialsStore = {};
      }
    } catch (error) {
      console.warn('⚠️  Could not load from file:', error.message);
      global.hacksawCredentialsStore = {};
    }
  }

  /**
   * Save credentials to SQLite
   */
  saveToSQLite(service, data) {
    if (!this.sqlite) return;

    const { organisation, client_id_encrypted, client_secret_encrypted, profile, created_at, updated_at } = data;

    this.sqlite.run(
      `INSERT OR REPLACE INTO ${this.tableName}
       (service, organisation, client_id_encrypted, client_secret_encrypted, profile, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [service, organisation, client_id_encrypted, client_secret_encrypted, profile, created_at, updated_at],
      (err) => {
        if (err) {
          console.error('❌ Failed to save to SQLite:', err.message);
        } else {
          console.log('✅ Credentials saved to SQLite');
        }
      }
    );
  }

  /**
   * Save credentials to file
   */
  saveToFile() {
    try {
      fs.writeFileSync(this.storageFile, JSON.stringify(global.hacksawCredentialsStore || {}, null, 2));
      console.log('✅ Credentials saved to file storage');
    } catch (error) {
      console.error('❌ Failed to save to file:', error.message);
    }
  }

  /**
   * Delete credentials from SQLite
   */
  deleteFromSQLite(service) {
    if (!this.sqlite) return;

    this.sqlite.run(`DELETE FROM ${this.tableName} WHERE service = ?`, [service], (err) => {
      if (err) {
        console.error('❌ Failed to delete from SQLite:', err.message);
      } else {
        console.log('✅ Credentials deleted from SQLite');
      }
    });
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

      const service = `hacksaw-${profile}`;
      const credentialData = {
        service,
        organisation,
        client_id_encrypted: encryptedClientId,
        client_secret_encrypted: encryptedClientSecret,
        profile,
        created_at: now,
        updated_at: now,
      };

      global.hacksawCredentialsStore[service] = credentialData;

      // Persist to appropriate backend
      if (this.storageType === 'sqlite') {
        this.saveToSQLite(service, credentialData);
      } else {
        this.saveToFile();
      }

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

      // Persist deletion to appropriate backend
      if (this.storageType === 'sqlite') {
        this.deleteFromSQLite(key);
      } else {
        this.saveToFile();
      }

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