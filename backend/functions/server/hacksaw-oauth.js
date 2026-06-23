/**
 * Hacksaw OAuth 2.0 Manager
 * Handles OAuth 2.0 authentication with Zoho Hacksaw
 */

const https = require('https');
const { encryptToken, decryptToken } = require('./crypto');

class HacksawOAuthManager {
  constructor(connectionManager, credentialsManager) {
    this.connManager = connectionManager;
    this.credsManager = credentialsManager;
  }

  /**
   * Get OAuth authorization URL for Hacksaw
   * Includes all read scopes for comprehensive Hacksaw API access
   */
  getAuthorizationUrl(redirectUri, additionalScopes = []) {
    const profile = this.connManager.getProfile();
    const creds = this.connManager.getCredentials();

    // All available Hacksaw read scopes
    const allScopes = [
      'Hacksaw.repository.READ',        // Repository/component data
      'Hacksaw.scan.READ',              // Scan results and history
      'Hacksaw.report.READ',            // Reports and summaries
      'Hacksaw.product.READ',           // Products list and info
      'Hacksaw.component.READ',         // Component details
      'Hacksaw.vulnerability.READ',     // Vulnerability data
      'Hacksaw.sla.READ',               // SLA profiles and settings
      'Hacksaw.organization.READ',      // Organization data
      'Hacksaw.user.READ',              // User information
      'Hacksaw.api.READ',               // API access
      ...additionalScopes,
    ];

    // Remove duplicates
    const uniqueScopes = [...new Set(allScopes)];
    const scopeString = uniqueScopes.join(' ');

    const params = new URLSearchParams({
      client_id: creds.clientId,
      response_type: 'code',
      scope: scopeString,
      redirect_uri: redirectUri,
      access_type: 'offline',
      prompt: 'consent',
      state: this.generateState(),
    });

    console.log(`📋 OAuth Scopes: ${scopeString}`);

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
   * Store OAuth token
   */
  async storeOAuthToken(userId, tokenData) {
    const encrypted = {
      access_token: encryptToken(tokenData.access_token),
      refresh_token: encryptToken(tokenData.refresh_token),
      expires_in: tokenData.expires_in,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      token_type: tokenData.token_type,
    };

    if (!global.hacksawOAuthTokens) {
      global.hacksawOAuthTokens = {};
    }

    global.hacksawOAuthTokens[userId] = encrypted;
    console.log(`✅ OAuth token stored for user: ${userId}`);

    return encrypted;
  }

  /**
   * Get OAuth token for user
   */
  getOAuthToken(userId) {
    if (!global.hacksawOAuthTokens || !global.hacksawOAuthTokens[userId]) {
      return null;
    }

    const stored = global.hacksawOAuthTokens[userId];

    // Check if token expired
    if (Date.now() >= stored.expires_at) {
      console.warn(`⚠️  Token expired for user: ${userId}`);
      return null;
    }

    // Decrypt token
    return {
      access_token: decryptToken(stored.access_token),
      refresh_token: decryptToken(stored.refresh_token),
      token_type: stored.token_type,
    };
  }

  /**
   * Generate random state for CSRF protection
   */
  generateState() {
    return require('crypto').randomBytes(16).toString('hex');
  }
}

module.exports = HacksawOAuthManager;