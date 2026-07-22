/**
 * Catalyst Environment Configuration
 * Reads credentials from Catalyst Environment Variables
 */

const config = {
  // Project
  projectId: process.env.CATALYST_PROJECT_ID,

  // OAuth (Zoho Authentication)
  zoho: {
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    redirectUri: process.env.ZOHO_REDIRECT_URI,
    authUrl: process.env.ZOHO_AUTH_URL || 'https://accounts.zoho.in/oauth/v2/auth',
    tokenUrl: process.env.ZOHO_TOKEN_URL || 'https://accounts.zoho.in/oauth/v2/token',
    apiUrl: process.env.ZOHO_API_URL || 'https://www.zohoapis.in',
  },

  // Token Configuration
  token: {
    expiryTime: parseInt(process.env.TOKEN_EXPIRY_HOURS || '24') * 60 * 60, // in seconds
    refreshExpiryTime: parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '30') * 24 * 60 * 60,
    encryptionKey: process.env.TOKEN_ENCRYPTION_KEY || 'dev-key-change-in-production',
  },

  // API & Catalyst
  apiKey: process.env.CATALYST_API_KEY,
  apiUrl: process.env.CATALYST_API_URL || 'https://api.zoho.in',

  // Database
  datastoreName: process.env.CATALYST_DATASTORE_NAME || 'wsm_security',

  // Service
  port: process.env.PORT || 8000,
  environment: process.env.ENVIRONMENT || 'development',

  /**
   * Validate that all required environment variables are set
   */
  validate() {
    const required = ['CATALYST_PROJECT_ID'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      console.warn(
        `⚠️  Missing environment variables in Catalyst: ${missing.join(', ')}\n` +
        `Set them in Catalyst Console → Functions → Environment Variables`
      );
      return false;
    }

    // Check OAuth configuration if enabled
    if (this.zoho.clientId) {
      const oauthRequired = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REDIRECT_URI'];
      const oauthMissing = oauthRequired.filter(key => !process.env[key]);
      if (oauthMissing.length > 0) {
        console.warn(
          `⚠️  Incomplete OAuth configuration: ${oauthMissing.join(', ')}\n` +
          `OAuth is partially configured. Complete it or remove ZOHO_CLIENT_ID to disable.`
        );
      }
    }

    return true;
  },

  /**
   * Check if OAuth is enabled
   */
  isOAuthEnabled() {
    return !!(this.zoho.clientId && this.zoho.clientSecret && this.zoho.redirectUri);
  },

  /**
   * Get configuration summary for logging
   */
  summary() {
    return {
      projectId: this.projectId ? '✓ set' : '✗ missing',
      oauth: this.isOAuthEnabled() ? '✓ enabled' : '✗ disabled',
      apiKey: this.apiKey ? '✓ set' : '✗ missing',
      environment: this.environment,
      apiUrl: this.apiUrl,
    };
  },
};

module.exports = config;