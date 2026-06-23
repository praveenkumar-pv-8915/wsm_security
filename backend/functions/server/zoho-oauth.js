/**
 * Generic Zoho OAuth 2.0 Manager
 * Handles OAuth 2.0 authentication for any Zoho service/application
 * Supports multiple services with different scopes and configurations
 */

const https = require('https');
const { encryptToken, decryptToken } = require('./crypto');

class ZohoOAuthManager {
  constructor(connectionManager) {
    this.connManager = connectionManager;
    this.services = {
      hacksaw: {
        name: 'Hacksaw',
        scopes: [
          'Hacksaw.repository.READ',
          'Hacksaw.scan.READ',
          'Hacksaw.report.READ',
          'Hacksaw.product.READ',
          'Hacksaw.component.READ',
          'Hacksaw.vulnerability.READ',
          'Hacksaw.sla.READ',
          'Hacksaw.organization.READ',
          'Hacksaw.user.READ',
          'Hacksaw.api.READ',
        ],
      },
      crm: {
        name: 'CRM',
        scopes: [
          'ZohoCRM.modules.READ',
          'ZohoCRM.users.READ',
          'ZohoCRM.settings.READ',
        ],
      },
      projects: {
        name: 'Projects',
        scopes: [
          'ZohoProjects.projects.READ',
          'ZohoProjects.tasks.READ',
        ],
      },
      books: {
        name: 'Books',
        scopes: [
          'ZohoBooks.bills.READ',
          'ZohoBooks.invoices.READ',
          'ZohoBooks.contacts.READ',
        ],
      },
    };

    // In-memory token storage (ready for SQLite/Catalyst)
    if (!global.zohoOAuthTokens) {
      global.zohoOAuthTokens = {};
    }

    console.log('✅ Zoho OAuth Manager initialized');
  }

  /**
   * Register a new service with OAuth configuration
   */
  registerService(serviceName, config) {
    this.services[serviceName] = config;
    console.log(`✅ Service registered: ${serviceName}`);
  }

  /**
   * Get scopes for a service
   */
  getServiceScopes(serviceName, additionalScopes = []) {
    const service = this.services[serviceName];
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    const allScopes = [
      ...service.scopes,
      ...additionalScopes,
    ];

    // Remove duplicates
    return [...new Set(allScopes)];
  }

  /**
   * Get OAuth authorization URL for a service
   */
  getAuthorizationUrl(serviceName, redirectUri, additionalScopes = []) {
    const profile = this.connManager.getProfile();
    const creds = this.connManager.getCredentials();
    const scopes = this.getServiceScopes(serviceName, additionalScopes);

    const params = new URLSearchParams({
      client_id: creds.clientId,
      response_type: 'code',
      scope: scopes.join(' '),
      redirect_uri: redirectUri,
      access_type: 'offline',
      prompt: 'consent',
      state: this.generateState(),
    });

    console.log(`🔐 OAuth URL for ${serviceName}:`);
    console.log(`   Scopes (${scopes.length}): ${scopes.join(', ')}`);

    return `https://${profile.accounts_domain}/oauth/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code, redirectUri) {
    const profile = this.connManager.getProfile();
    const creds = this.connManager.getCredentials();

    const postData = new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: profile.accounts_domain,
        path: '/oauth/v2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': postData.toString().length,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.error) {
              reject(new Error(`OAuth error: ${response.error_description || response.error}`));
            } else {
              resolve(response);
            }
          } catch (error) {
            reject(new Error(`Failed to parse OAuth response: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData.toString());
      req.end();
    });
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    const profile = this.connManager.getProfile();
    const creds = this.connManager.getCredentials();

    const postData = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: profile.accounts_domain,
        path: '/oauth/v2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': postData.toString().length,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.error) {
              reject(new Error(`Token refresh failed: ${response.error_description}`));
            } else {
              resolve(response);
            }
          } catch (error) {
            reject(new Error(`Failed to parse refresh response: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData.toString());
      req.end();
    });
  }

  /**
   * Revoke access token
   */
  async revokeToken(accessToken) {
    const profile = this.connManager.getProfile();

    const postData = new URLSearchParams({
      token: accessToken,
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: profile.accounts_domain,
        path: '/oauth/v2/token/revoke',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': postData.toString().length,
        },
      };

      const req = https.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          resolve();
        });
      });

      req.on('error', reject);
      req.write(postData.toString());
      req.end();
    });
  }

  /**
   * Store OAuth token for a service and user
   */
  async storeOAuthToken(serviceName, userId, tokenData) {
    const key = `${serviceName}:${userId}`;

    const encrypted = {
      service: serviceName,
      user_id: userId,
      access_token: encryptToken(tokenData.access_token),
      refresh_token: encryptToken(tokenData.refresh_token),
      expires_in: tokenData.expires_in,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
      created_at: new Date().toISOString(),
    };

    global.zohoOAuthTokens[key] = encrypted;
    console.log(`✅ OAuth token stored for ${serviceName}/${userId}`);

    return encrypted;
  }

  /**
   * Get OAuth token for a service and user
   */
  getOAuthToken(serviceName, userId) {
    const key = `${serviceName}:${userId}`;
    const stored = global.zohoOAuthTokens[key];

    if (!stored) {
      return null;
    }

    // Check if token expired
    if (Date.now() >= stored.expires_at) {
      console.warn(`⚠️  Token expired for ${serviceName}/${userId}`);
      return null;
    }

    // Decrypt and return token
    return {
      access_token: decryptToken(stored.access_token),
      refresh_token: decryptToken(stored.refresh_token),
      token_type: stored.token_type,
      scope: stored.scope,
      expires_at: stored.expires_at,
    };
  }

  /**
   * Check if user is authorized for a service
   */
  isAuthorized(serviceName, userId) {
    return this.getOAuthToken(serviceName, userId) !== null;
  }

  /**
   * Revoke authorization for a service and user
   */
  async revokeAuthorization(serviceName, userId) {
    const key = `${serviceName}:${userId}`;
    const stored = global.zohoOAuthTokens[key];

    if (!stored) {
      throw new Error(`No token found for ${serviceName}/${userId}`);
    }

    // Revoke the token
    try {
      await this.revokeToken(decryptToken(stored.access_token));
    } catch (error) {
      console.warn(`⚠️  Token revocation failed (may already be expired):`, error.message);
    }

    // Delete from storage
    delete global.zohoOAuthTokens[key];
    console.log(`✅ Authorization revoked for ${serviceName}/${userId}`);
  }

  /**
   * Generate random state for CSRF protection
   */
  generateState() {
    return require('crypto').randomBytes(16).toString('hex');
  }

  /**
   * List all supported services
   */
  listServices() {
    return Object.entries(this.services).map(([key, config]) => ({
      service_id: key,
      name: config.name,
      scopes: config.scopes,
      scope_count: config.scopes.length,
    }));
  }

  /**
   * Get service info
   */
  getServiceInfo(serviceName) {
    const service = this.services[serviceName];
    if (!service) {
      return null;
    }

    return {
      service_id: serviceName,
      name: service.name,
      scopes: service.scopes,
      scope_count: service.scopes.length,
    };
  }
}

module.exports = ZohoOAuthManager;