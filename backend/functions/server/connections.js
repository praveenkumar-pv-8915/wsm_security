/**
 * Connections Manager - OAuth 2.0 for Multiple Zoho Services & Regions
 * Similar to agent-knowledge-kit connections pattern
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class ConnectionManager {
  constructor(configPath) {
    this.config = this.loadConfig(configPath);
    this.profile = process.env.ZOHO_PROFILE || 'in'; // Default to India
    this.validateProfile();
  }

  /**
   * Load connections configuration from JSON
   */
  loadConfig(configPath) {
    try {
      const absolutePath = path.resolve(configPath);
      const rawConfig = fs.readFileSync(absolutePath, 'utf8');
      return JSON.parse(rawConfig);
    } catch (error) {
      console.error(`Failed to load connections config from ${configPath}:`, error.message);
      throw error;
    }
  }

  /**
   * Validate that the selected profile exists
   */
  validateProfile() {
    if (!this.config.profiles[this.profile]) {
      throw new Error(
        `Invalid profile: ${this.profile}. Available: ${Object.keys(this.config.profiles).join(', ')}`
      );
    }
  }

  /**
   * Get current profile configuration
   */
  getProfile() {
    return this.config.profiles[this.profile];
  }

  /**
   * Get service configuration
   */
  getService(serviceName) {
    return this.config.services[serviceName];
  }

  /**
   * Get OAuth credentials for current profile
   */
  getCredentials(serviceName = 'wsm-security') {
    const creds = this.config.credentials[this.profile];
    if (!creds) {
      throw new Error(`No credentials found for profile: ${this.profile}`);
    }

    return {
      clientId: this.resolveEnvVar(creds.client_id),
      clientSecret: this.resolveEnvVar(creds.client_secret),
    };
  }

  /**
   * Resolve environment variable placeholders (e.g., ${VAR_NAME})
   */
  resolveEnvVar(value) {
    if (!value || typeof value !== 'string') return value;

    return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const envValue = process.env[varName];
      if (!envValue) {
        throw new Error(`Environment variable not set: ${varName}`);
      }
      return envValue;
    });
  }

  /**
   * Build OAuth authorization URL
   */
  getAuthorizationUrl(redirectUri, scope = 'userprofile.read') {
    const profile = this.getProfile();
    const creds = this.getCredentials();

    const params = new URLSearchParams({
      client_id: creds.clientId,
      response_type: 'code',
      scope,
      redirect_uri: redirectUri,
      state: this.generateState(), // CSRF protection
    });

    return `https://${profile.accounts_domain}/oauth/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    const profile = this.getProfile();
    const creds = this.getCredentials();

    const postData = new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'authorization_code',
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
            reject(new Error(`Failed to parse token response: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData.toString());
      req.end();
    });
  }

  /**
   * Get user profile from Zoho API
   */
  async getUserProfile(accessToken) {
    const profile = this.getProfile();

    return new Promise((resolve, reject) => {
      const options = {
        hostname: profile.api_domain,
        path: '/crm/v2/users/me',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
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
              reject(new Error(`Profile fetch error: ${response.error.message}`));
            } else {
              resolve(response.users[0]); // Zoho returns array of users
            }
          } catch (error) {
            reject(new Error(`Failed to parse profile: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Refresh an access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    const profile = this.getProfile();
    const creds = this.getCredentials();

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
              reject(new Error(`Refresh failed: ${response.error_description}`));
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
   * Generate CSRF state token
   */
  generateState() {
    return require('crypto').randomBytes(16).toString('hex');
  }

  /**
   * Get connection information
   */
  getInfo() {
    const profile = this.getProfile();
    const service = this.getService('wsm-security');

    return {
      profile: this.profile,
      service: 'wsm-security',
      datacenter: profile.dc_domain,
      timezone: profile.timezone,
      redirect_port: service.redirect_port,
      scope: service.scope,
    };
  }

  /**
   * Get Hacksaw service credentials
   */
  getHacksawCredentials() {
    const creds = this.config.credentials[this.profile];
    if (!creds || !creds.hacksaw_client_id) {
      throw new Error(`No Hacksaw credentials found for profile: ${this.profile}`);
    }

    return {
      clientId: this.resolveEnvVar(creds.hacksaw_client_id),
      clientSecret: this.resolveEnvVar(creds.hacksaw_client_secret),
    };
  }

  /**
   * Fetch list of products from Hacksaw using org credentials
   */
  async fetchHacksawProducts(credentials) {
    const profile = this.getProfile();
    const service = this.getService('hacksaw');

    return new Promise((resolve, reject) => {
      // Create Basic Auth header from credentials
      const auth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');

      const options = {
        hostname: profile.hacksaw_domain,
        path: `${service.api_base}/products`,
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
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
            if (res.statusCode >= 400) {
              reject(new Error(`Hacksaw API error (${res.statusCode}): ${response.message || response.error}`));
            } else {
              // Handle both array and object responses
              const products = Array.isArray(response) ? response : response.products || response.data || [];
              resolve(products);
            }
          } catch (error) {
            reject(new Error(`Failed to parse Hacksaw response: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Fetch vulnerable components (violations) from Hacksaw
   *
   * Required Hacksaw API parameters:
   * - action: fetchvulnerablecomponents
   * - organisation: Organization name
   * - productname: Product name (e.g., Logs360cloud)
   * - reportlabel: Report label (e.g., production_Jun_22_2026_Log360Cloud)
   * - filter: Optional filter criteria (JSON object)
   */
  async fetchHacksawViolations(credentials, organisation, productName, reportLabel, filter = {}) {
    const profile = this.getProfile();

    return new Promise((resolve, reject) => {
      // Support both OAuth Bearer tokens and Basic Auth
      let authHeader = null;
      let authType = null;

      if (credentials.access_token) {
        // OAuth Bearer token
        authHeader = `Bearer ${credentials.access_token}`;
        authType = 'OAuth Bearer';
      } else {
        // Basic Auth with clientId and clientSecret
        const auth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
        authHeader = `Basic ${auth}`;
        authType = 'Basic Auth';
      }

      // Build query string with all required Hacksaw API parameters
      const queryParams = new URLSearchParams();
      queryParams.append('action', 'fetchvulnerablecomponents');
      queryParams.append('organisation', organisation);
      queryParams.append('productname', productName);
      queryParams.append('reportlabel', reportLabel);
      if (Object.keys(filter).length > 0) {
        queryParams.append('filter', JSON.stringify(filter));
      }

      const path = `/api/vulnerablecomponentsreport?${queryParams.toString()}`;

      console.log('🔍 Hacksaw Request Details:');
      console.log(`   Hostname: ${profile.hacksaw_domain}`);
      console.log(`   Path: ${path}`);
      console.log(`   Auth Type: ${authType}`);
      if (authType === 'Basic Auth') {
        console.log(`   Client ID (first 10 chars): ${credentials.clientId.substring(0, 10)}...`);
        console.log(`   Client Secret (first 10 chars): ${credentials.clientSecret.substring(0, 10)}...`);
      } else {
        console.log(`   OAuth Token (first 20 chars): ${credentials.access_token.substring(0, 20)}...`);
      }
      console.log(`   Organisation: ${organisation}`);
      console.log(`   Product: ${productName}`);
      console.log(`   Report Label: ${reportLabel}`);
      console.log(`   Filter: ${JSON.stringify(filter)}`);

      const options = {
        hostname: profile.hacksaw_domain,
        path: path,
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
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
            if (res.statusCode >= 400) {
              // Extract detailed error info from Hacksaw API
              const errorMsg = response.ERROR_MESSAGE || response.message || response.error || 'Unknown error';
              const errorDesc = response.DESCRIPTION || '';
              const errorCode = response.ERROR_CODE || '';
              const fullError = errorCode ? `${errorMsg} (${errorCode})` : errorMsg;
              const detail = errorDesc ? ` - ${errorDesc}` : '';

              console.error(`❌ Hacksaw API Error (${res.statusCode}): ${fullError}${detail}`);
              console.error(`Response: ${data}`);

              reject(new Error(`Hacksaw API error (${res.statusCode}): ${fullError}${detail}`));
            } else {
              resolve(response);
            }
          } catch (error) {
            console.error(`❌ Failed to parse Hacksaw response: ${error.message}`);
            console.error(`Raw data: ${data}`);
            reject(new Error(`Failed to parse Hacksaw response: ${error.message}\nRaw: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }
}

module.exports = ConnectionManager;