/**
 * Sensitive Data Manager
 * Manages user-specific encrypted secrets (API keys, tokens, passwords, etc.)
 * Supports Catalyst Datastore for production and SQLite for local development
 * All sensitive data is encrypted at rest using AES-256-GCM
 */

const { encryptToken, decryptToken } = require('./crypto');
const fs = require('fs');
const path = require('path');

class SensitiveDataManager {
  constructor(dbConnection = null, storageDir = null) {
    this.db = dbConnection;
    this.environment = process.env.ENVIRONMENT || 'development';
    this.storageDir = storageDir || path.join(__dirname, '..', '..', '.credentials');
    this.storageFile = path.join(this.storageDir, 'user_secrets.json');

    this.initializeStorage();
  }

  /**
   * Initialize storage backend based on environment
   */
  initializeStorage() {
    try {
      if (this.environment === 'production' && this.db) {
        console.log('🗄️  Using Catalyst Datastore for sensitive data');
        this.storageType = 'catalyst';
      } else {
        try {
          const sqlite3 = require('sqlite3').verbose();
          console.log('🗄️  Using SQLite for sensitive data (local development)');
          this.storageType = 'sqlite';
          this.initializeSQLite();
        } catch (e) {
          console.log('💾 Using file-based storage for sensitive data (fallback)');
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
      const dbPath = path.join(this.storageDir, 'sensitive_data.db');

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

      this.createSQLiteTables();
    } catch (error) {
      console.warn('⚠️  SQLite initialization failed:', error.message);
      this.initializeFileStorage();
    }
  }

  /**
   * Create SQLite tables for user credentials and audit logs
   */
  createSQLiteTables() {
    if (!this.sqlite) return;

    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS user_credentials (
        credential_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        credential_name TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, credential_name)
      )
    `, (err) => {
      if (err) {
        console.error('❌ Failed to create user_credentials table:', err.message);
      } else {
        console.log('✅ SQLite user_credentials table ready');
      }
    });

    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS credential_audit_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        credential_id INTEGER,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        timestamp TEXT NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('❌ Failed to create credential_audit_logs table:', err.message);
      } else {
        console.log('✅ SQLite credential_audit_logs table ready');
      }
    });
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
      if (!fs.existsSync(this.storageFile)) {
        fs.writeFileSync(this.storageFile, JSON.stringify({ credentials: {}, auditLogs: [] }, null, 2));
      }
    } catch (error) {
      console.error('❌ File storage initialization failed:', error.message);
    }
  }

  /**
   * Store sensitive data for a user
   */
  async storeSecret(userId, credentialName, credentialType, secretValue, description = null, ipAddress = null, userAgent = null) {
    try {
      if (!userId || !credentialName || !credentialType || !secretValue) {
        throw new Error('userId, credentialName, credentialType, and secretValue are required');
      }

      const encryptedValue = encryptToken(secretValue);
      const now = new Date().toISOString();

      console.log(`💾 Storing ${credentialType} credential "${credentialName}" for user ${userId}...`);

      if (this.storageType === 'sqlite' && this.sqlite) {
        return this.storeSQLiteSecret(userId, credentialName, credentialType, encryptedValue, description, now);
      } else if (this.storageType === 'catalyst') {
        return this.storeCatalystSecret(userId, credentialName, credentialType, encryptedValue, description, now);
      } else {
        return this.storeFileSecret(userId, credentialName, credentialType, encryptedValue, description, now);
      }
    } catch (error) {
      console.error('❌ Error storing secret:', error.message);
      await this.logAuditEvent(userId, null, 'store_secret', 'failed', error.message, ipAddress, userAgent);
      throw error;
    }
  }

  /**
   * Store secret in SQLite
   */
  storeSQLiteSecret(userId, credentialName, credentialType, encryptedValue, description, timestamp) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      this.sqlite.run(
        `INSERT OR REPLACE INTO user_credentials
         (user_id, credential_name, credential_type, encrypted_value, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, credentialName, credentialType, encryptedValue, description, timestamp, now],
        function(err) {
          if (err) {
            console.error('❌ Failed to store secret in SQLite:', err.message);
            reject(err);
          } else {
            console.log(`✅ Secret stored for user ${userId}`);
            resolve({
              success: true,
              credential_id: this.lastID,
              user_id: userId,
              credential_name: credentialName,
              credential_type: credentialType,
              stored_at: now,
            });
          }
        }
      );
    });
  }

  /**
   * Store secret in Catalyst Datastore (placeholder for future integration)
   */
  async storeCatalystSecret(userId, credentialName, credentialType, encryptedValue, description, timestamp) {
    console.log('⚠️  Catalyst integration pending, using file storage as fallback');
    return this.storeFileSecret(userId, credentialName, credentialType, encryptedValue, description, timestamp);
  }

  /**
   * Store secret in file storage
   */
  storeFileSecret(userId, credentialName, credentialType, encryptedValue, description, timestamp) {
    try {
      const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      const key = `${userId}:${credentialName}`;

      data.credentials[key] = {
        user_id: userId,
        credential_name: credentialName,
        credential_type: credentialType,
        encrypted_value: encryptedValue,
        description,
        created_at: timestamp,
        updated_at: timestamp,
      };

      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2));
      console.log(`✅ Secret stored for user ${userId}`);

      return {
        success: true,
        user_id: userId,
        credential_name: credentialName,
        credential_type: credentialType,
        stored_at: timestamp,
      };
    } catch (error) {
      console.error('❌ Failed to store secret in file:', error.message);
      throw error;
    }
  }

  /**
   * Retrieve secret (only for owning user)
   */
  async getSecret(userId, credentialName, ipAddress = null, userAgent = null) {
    try {
      if (!userId || !credentialName) {
        throw new Error('userId and credentialName are required');
      }

      console.log(`🔍 Retrieving credential "${credentialName}" for user ${userId}...`);

      let secretData = null;

      if (this.storageType === 'sqlite' && this.sqlite) {
        secretData = await this.getSQLiteSecret(userId, credentialName);
      } else if (this.storageType === 'catalyst') {
        secretData = await this.getCatalystSecret(userId, credentialName);
      } else {
        secretData = this.getFileSecret(userId, credentialName);
      }

      if (!secretData) {
        await this.logAuditEvent(userId, null, 'retrieve_secret', 'failed', 'credential not found', ipAddress, userAgent);
        return null;
      }

      const decryptedValue = decryptToken(secretData.encrypted_value);
      await this.logAuditEvent(userId, secretData.credential_id, 'retrieve_secret', 'success', null, ipAddress, userAgent);

      return {
        credential_id: secretData.credential_id,
        user_id: secretData.user_id,
        credential_name: secretData.credential_name,
        credential_type: secretData.credential_type,
        secret_value: decryptedValue,
        description: secretData.description,
        created_at: secretData.created_at,
        updated_at: secretData.updated_at,
      };
    } catch (error) {
      console.error('❌ Error retrieving secret:', error.message);
      await this.logAuditEvent(userId, null, 'retrieve_secret', 'failed', error.message, ipAddress, userAgent);
      throw error;
    }
  }

  /**
   * Retrieve secret from SQLite
   */
  getSQLiteSecret(userId, credentialName) {
    return new Promise((resolve, reject) => {
      this.sqlite.get(
        `SELECT * FROM user_credentials WHERE user_id = ? AND credential_name = ?`,
        [userId, credentialName],
        (err, row) => {
          if (err) {
            console.error('❌ Failed to retrieve from SQLite:', err.message);
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * Retrieve secret from Catalyst (placeholder)
   */
  async getCatalystSecret(userId, credentialName) {
    console.log('⚠️  Catalyst integration pending, using file storage as fallback');
    return this.getFileSecret(userId, credentialName);
  }

  /**
   * Retrieve secret from file storage
   */
  getFileSecret(userId, credentialName) {
    try {
      const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      const key = `${userId}:${credentialName}`;
      return data.credentials[key] || null;
    } catch (error) {
      console.error('❌ Failed to retrieve from file:', error.message);
      return null;
    }
  }

  /**
   * List user's secrets (metadata only, no values)
   */
  async listSecrets(userId) {
    try {
      if (!userId) {
        throw new Error('userId is required');
      }

      console.log(`📋 Listing secrets for user ${userId}...`);

      let secrets = [];

      if (this.storageType === 'sqlite' && this.sqlite) {
        secrets = await this.listSQLiteSecrets(userId);
      } else if (this.storageType === 'catalyst') {
        secrets = await this.listCatalystSecrets(userId);
      } else {
        secrets = this.listFileSecrets(userId);
      }

      return secrets.map(s => ({
        credential_id: s.credential_id,
        credential_name: s.credential_name,
        credential_type: s.credential_type,
        description: s.description,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));
    } catch (error) {
      console.error('❌ Error listing secrets:', error.message);
      throw error;
    }
  }

  /**
   * List secrets from SQLite
   */
  listSQLiteSecrets(userId) {
    return new Promise((resolve, reject) => {
      this.sqlite.all(
        `SELECT credential_id, credential_name, credential_type, description, created_at, updated_at
         FROM user_credentials WHERE user_id = ? ORDER BY created_at DESC`,
        [userId],
        (err, rows) => {
          if (err) {
            console.error('❌ Failed to list from SQLite:', err.message);
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * List secrets from Catalyst (placeholder)
   */
  async listCatalystSecrets(userId) {
    console.log('⚠️  Catalyst integration pending, using file storage as fallback');
    return this.listFileSecrets(userId);
  }

  /**
   * List secrets from file storage
   */
  listFileSecrets(userId) {
    try {
      const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      return Object.values(data.credentials)
        .filter(s => s.user_id === userId)
        .map(s => ({
          credential_id: null,
          credential_name: s.credential_name,
          credential_type: s.credential_type,
          description: s.description,
          created_at: s.created_at,
          updated_at: s.updated_at,
        }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (error) {
      console.error('❌ Failed to list from file:', error.message);
      return [];
    }
  }

  /**
   * Delete secret (only for owning user)
   */
  async deleteSecret(userId, credentialName, ipAddress = null, userAgent = null) {
    try {
      if (!userId || !credentialName) {
        throw new Error('userId and credentialName are required');
      }

      console.log(`🗑️  Deleting credential "${credentialName}" for user ${userId}...`);

      let result = false;
      let credentialId = null;

      if (this.storageType === 'sqlite' && this.sqlite) {
        result = await this.deleteSQLiteSecret(userId, credentialName);
      } else if (this.storageType === 'catalyst') {
        result = await this.deleteCatalystSecret(userId, credentialName);
      } else {
        result = this.deleteFileSecret(userId, credentialName);
      }

      if (result) {
        await this.logAuditEvent(userId, credentialId, 'delete_secret', 'success', null, ipAddress, userAgent);
        console.log(`✅ Credential deleted for user ${userId}`);
        return {
          success: true,
          message: 'Credential deleted successfully',
        };
      } else {
        await this.logAuditEvent(userId, null, 'delete_secret', 'failed', 'credential not found', ipAddress, userAgent);
        throw new Error('Credential not found');
      }
    } catch (error) {
      console.error('❌ Error deleting secret:', error.message);
      await this.logAuditEvent(userId, null, 'delete_secret', 'failed', error.message, ipAddress, userAgent);
      throw error;
    }
  }

  /**
   * Delete secret from SQLite
   */
  deleteSQLiteSecret(userId, credentialName) {
    return new Promise((resolve, reject) => {
      this.sqlite.run(
        `DELETE FROM user_credentials WHERE user_id = ? AND credential_name = ?`,
        [userId, credentialName],
        function(err) {
          if (err) {
            console.error('❌ Failed to delete from SQLite:', err.message);
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  /**
   * Delete secret from Catalyst (placeholder)
   */
  async deleteCatalystSecret(userId, credentialName) {
    console.log('⚠️  Catalyst integration pending, using file storage as fallback');
    return this.deleteFileSecret(userId, credentialName);
  }

  /**
   * Delete secret from file storage
   */
  deleteFileSecret(userId, credentialName) {
    try {
      const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      const key = `${userId}:${credentialName}`;
      if (data.credentials[key]) {
        delete data.credentials[key];
        fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2));
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Failed to delete from file:', error.message);
      return false;
    }
  }

  /**
   * Log audit event for credential operations
   */
  async logAuditEvent(userId, credentialId, action, status, errorMessage = null, ipAddress = null, userAgent = null) {
    try {
      const timestamp = new Date().toISOString();

      if (this.storageType === 'sqlite' && this.sqlite) {
        this.logSQLiteAudit(userId, credentialId, action, status, ipAddress, userAgent, timestamp);
      } else if (this.storageType === 'catalyst') {
        await this.logCatalystAudit(userId, credentialId, action, status, ipAddress, userAgent, timestamp);
      } else {
        this.logFileAudit(userId, credentialId, action, status, ipAddress, userAgent, timestamp);
      }

      console.log(`📝 Audit: ${action} (${status}) by user ${userId}`);
    } catch (error) {
      console.warn('⚠️  Failed to log audit event:', error.message);
    }
  }

  /**
   * Log audit event in SQLite
   */
  logSQLiteAudit(userId, credentialId, action, status, ipAddress, userAgent, timestamp) {
    if (!this.sqlite) return;

    this.sqlite.run(
      `INSERT INTO credential_audit_logs (user_id, credential_id, action, status, ip_address, user_agent, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, credentialId, action, status, ipAddress || null, userAgent || null, timestamp],
      (err) => {
        if (err) {
          console.warn('⚠️  Failed to log audit event:', err.message);
        }
      }
    );
  }

  /**
   * Log audit event in Catalyst (placeholder)
   */
  async logCatalystAudit(userId, credentialId, action, status, ipAddress, userAgent, timestamp) {
    console.log('⚠️  Catalyst audit logging pending, using file storage as fallback');
    this.logFileAudit(userId, credentialId, action, status, ipAddress, userAgent, timestamp);
  }

  /**
   * Log audit event in file storage
   */
  logFileAudit(userId, credentialId, action, status, ipAddress, userAgent, timestamp) {
    try {
      const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      data.auditLogs.push({
        user_id: userId,
        credential_id: credentialId,
        action,
        status,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        timestamp,
      });
      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn('⚠️  Failed to write audit log:', error.message);
    }
  }

  /**
   * Get audit logs for a credential (only for owning user)
   */
  async getAuditLogs(userId, credentialName = null, limit = 50) {
    try {
      if (!userId) {
        throw new Error('userId is required');
      }

      console.log(`📋 Retrieving audit logs for user ${userId}...`);

      let logs = [];

      if (this.storageType === 'sqlite' && this.sqlite) {
        logs = await this.getSQLiteAuditLogs(userId, credentialName, limit);
      } else if (this.storageType === 'catalyst') {
        logs = await this.getCatalystAuditLogs(userId, credentialName, limit);
      } else {
        logs = this.getFileAuditLogs(userId, credentialName, limit);
      }

      return logs;
    } catch (error) {
      console.error('❌ Error retrieving audit logs:', error.message);
      throw error;
    }
  }

  /**
   * Get audit logs from SQLite
   */
  getSQLiteAuditLogs(userId, credentialName, limit) {
    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM credential_audit_logs WHERE user_id = ?`;
      const params = [userId];

      const sql = `${query} ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      this.sqlite.all(sql, params, (err, rows) => {
        if (err) {
          console.error('❌ Failed to retrieve audit logs from SQLite:', err.message);
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Get audit logs from Catalyst (placeholder)
   */
  async getCatalystAuditLogs(userId, credentialName, limit) {
    console.log('⚠️  Catalyst audit retrieval pending, using file storage as fallback');
    return this.getFileAuditLogs(userId, credentialName, limit);
  }

  /**
   * Get audit logs from file storage
   */
  getFileAuditLogs(userId, credentialName, limit) {
    try {
      const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      return data.auditLogs
        .filter(log => log.user_id === userId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    } catch (error) {
      console.error('❌ Failed to retrieve audit logs from file:', error.message);
      return [];
    }
  }
}

module.exports = SensitiveDataManager;