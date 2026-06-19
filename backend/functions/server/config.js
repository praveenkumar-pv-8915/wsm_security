/**
 * Catalyst Environment Configuration
 * Reads credentials from Catalyst Environment Variables
 */

const config = {
  // Project
  projectId: process.env.CATALYST_PROJECT_ID,

  // API & Authentication
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

    return true;
  },

  /**
   * Get configuration summary for logging
   */
  summary() {
    return {
      projectId: this.projectId ? '✓ set' : '✗ missing',
      apiKey: this.apiKey ? '✓ set' : '✗ missing',
      environment: this.environment,
      apiUrl: this.apiUrl,
    };
  },
};

module.exports = config;