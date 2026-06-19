/**
 * OAuth Handler - Manages Zoho OAuth 2.0 flow
 */

const https = require('https');
const config = require('./config');
const { encryptToken, generateTokenHash } = require('./crypto');

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      code,
      client_id: config.zoho.clientId,
      client_secret: config.zoho.clientSecret,
      redirect_uri: config.zoho.redirectUri,
      grant_type: 'authorization_code',
    });

    const options = {
      hostname: new URL(config.zoho.tokenUrl).hostname,
      path: new URL(config.zoho.tokenUrl).pathname,
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
            reject(new Error(`OAuth error: ${response.error_description}`));
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
 * Refresh an access token using refresh token
 */
async function refreshAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.zoho.clientId,
      client_secret: config.zoho.clientSecret,
      grant_type: 'refresh_token',
    });

    const options = {
      hostname: new URL(config.zoho.tokenUrl).hostname,
      path: new URL(config.zoho.tokenUrl).pathname,
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
 * Get user profile from Zoho using access token
 */
async function getUserProfile(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: new URL(config.zoho.apiUrl).hostname,
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
 * Prepare user data for storage in Catalyst Datastore
 */
function prepareUserData(profile, tokenData) {
  return {
    user_id: profile.id,
    email: profile.email,
    name: profile.full_name,
    zoho_user_id: profile.id,
    auth_token: encryptToken(tokenData.access_token),
    refresh_token: encryptToken(tokenData.refresh_token),
    token_hash: generateTokenHash(tokenData.access_token),
    token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(
      Date.now() + config.token.refreshExpiryTime * 1000
    ).toISOString(),
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

module.exports = {
  exchangeCodeForToken,
  refreshAccessToken,
  getUserProfile,
  prepareUserData,
};