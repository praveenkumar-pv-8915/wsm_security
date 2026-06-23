// Load environment variables from .env file (for local development)
if (process.env.ENVIRONMENT !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const path = require('path');
const ConnectionManager = require('./connections');
const CredentialsManager = require('./credentials-manager');
const ZohoOAuthManager = require('./zoho-oauth');
const { validateToken, optionalAuth } = require('./auth-middleware');
const { encryptToken, generateTokenHash } = require('./crypto');

const app = express();
app.use(express.json());

// Enable CORS for local development
if (process.env.ENVIRONMENT !== 'production') {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });
}

// Initialize Connection Manager
let connManager = null;
try {
  const configPath = path.join(__dirname, '..', '..', 'connections.config.json');
  connManager = new ConnectionManager(configPath);
  console.log('✅ Connection Manager initialized');
  console.log('📋 Connection Info:', connManager.getInfo());
} catch (error) {
  console.warn('⚠️  Connection Manager not available:', error.message);
}

// Initialize Credentials Manager
const credsManager = new CredentialsManager();

// Initialize Zoho OAuth Manager (generic for all Zoho services)
let zohoOAuth = null;
try {
  zohoOAuth = new ZohoOAuthManager(connManager);
  console.log('✅ Zoho OAuth Manager initialized');
} catch (error) {
  console.warn('⚠️  Zoho OAuth Manager initialization failed:', error.message);
}

const isOAuthEnabled = () => {
  try {
    const creds = connManager.getCredentials();
    return !!(creds.clientId && creds.clientSecret);
  } catch (error) {
    return false;
  }
};

if (isOAuthEnabled()) {
  console.log('🔐 OAuth 2.0 enabled via Connection Manager');
} else {
  console.warn('⚠️  OAuth 2.0 not fully configured');
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const health = {
    status: 'ok',
    message: 'WSM-Security API Running',
    oauth_enabled: isOAuthEnabled(),
  };

  if (connManager) {
    try {
      health.connection = connManager.getInfo();
    } catch (error) {
      health.connection_error = error.message;
    }
  }

  res.json(health);
});

// OAuth Callback - Exchange authorization code for token
app.post('/api/auth/callback', async (req, res) => {
  try {
    if (!isOAuthEnabled()) {
      return res.status(503).json({
        error: 'OAuth not configured',
        message: 'Set ZOHO_CLIENT_ID_* environment variables',
      });
    }

    const { code } = req.body;

    if (!code) {
      console.warn('⚠️  Missing authorization code in callback');
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    console.log('📝 Step 1: Exchanging code for token...');
    const tokenData = await connManager.exchangeCodeForToken(code);
    console.log('✓ Token received from Zoho');

    console.log('👤 Step 2: Fetching user profile...');
    const userProfile = await connManager.getUserProfile(tokenData.access_token);
    console.log(`✓ Profile fetched: ${userProfile.email}`);

    console.log('💾 Step 3: Preparing user data for storage...');
    const userData = {
      user_id: userProfile.id,
      email: userProfile.email,
      name: userProfile.full_name,
      zoho_user_id: userProfile.id,
      auth_token: encryptToken(tokenData.access_token),
      refresh_token: encryptToken(tokenData.refresh_token),
      token_hash: generateTokenHash(tokenData.access_token),
      token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      refresh_token_expires_at: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
      ).toISOString(),
      last_login: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    console.log('⏳ Step 4: Store in Catalyst Datastore (TODO)');
    // TODO: Save to Catalyst Datastore
    // await db.users.create(userData);

    console.log(`✅ User authenticated: ${userData.email}`);

    // Step 5: Return encrypted token to frontend
    res.json({
      success: true,
      token: userData.auth_token, // This is encrypted
      user: {
        id: userData.user_id,
        email: userData.email,
        name: userData.name,
      },
    });
  } catch (error) {
    console.error('❌ OAuth callback error:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(401).json({
      error: 'Authentication failed',
      message: error.message,
    });
  }
});

// OAuth Login URL - provides link for frontend to redirect to Zoho
app.get('/api/auth/login-url', (req, res) => {
  try {
    if (!isOAuthEnabled()) {
      return res.status(503).json({
        error: 'OAuth not configured',
        oauth_enabled: false,
      });
    }

    const redirectUri = req.query.redirect_uri ||
      `${req.protocol}://${req.get('host')}/api/auth/callback`;

    const loginUrl = connManager.getAuthorizationUrl(redirectUri);

    res.json({
      login_url: loginUrl,
      oauth_enabled: true,
      profile: connManager.getInfo(),
    });
  } catch (error) {
    console.error('Failed to generate login URL:', error.message);
    res.status(500).json({
      error: 'Failed to generate login URL',
      message: error.message,
    });
  }
});

// Profile endpoints (requires authentication if OAuth is enabled)
const profileMiddleware = isOAuthEnabled() ? validateToken : optionalAuth;

app.get('/api/profile', profileMiddleware, (req, res) => {
  // TODO: Fetch from Catalyst Datastore using user_id from token
  res.json({
    profile: {
      user_id: 'user123',
      name: 'Creator',
      email: 'creator@example.com',
    },
  });
});

app.post('/api/profile', profileMiddleware, (req, res) => {
  const { name, email } = req.body;
  // TODO: Update in Catalyst Datastore
  res.json({
    success: true,
    data: {
      user_id: 'user123',
      name,
      email,
      created_at: new Date().toISOString(),
    },
  });
});

// Tasks endpoints (requires authentication if OAuth is enabled)
app.get('/api/tasks', profileMiddleware, (req, res) => {
  // TODO: Fetch from Catalyst Datastore filtered by user_id
  res.json({
    tasks: [],
  });
});

app.post('/api/tasks', profileMiddleware, (req, res) => {
  const { title, description, priority, due_date } = req.body;
  // TODO: Create in Catalyst Datastore
  res.json({
    success: true,
    data: {
      task_id: 'task123',
      title,
      description,
      priority: priority || 'medium',
      status: 'open',
      due_date: due_date || null,
      created_at: new Date().toISOString(),
    },
  });
});

// Hacksaw Credentials - UI Form
app.get('/api/hacksaw/credentials-form', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hacksaw Credentials Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      color: #333;
      font-weight: 500;
      margin-bottom: 8px;
      font-size: 14px;
    }
    input {
      width: 100%;
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 14px;
      transition: border-color 0.3s;
      font-family: 'Courier New', monospace;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    .form-group.readonly input {
      background: #f5f5f5;
      cursor: not-allowed;
    }
    .button-group {
      display: flex;
      gap: 10px;
      margin-top: 30px;
    }
    button {
      flex: 1;
      padding: 12px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
    }
    .btn-save {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-save:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
    }
    .btn-delete {
      background: #ff6b6b;
      color: white;
    }
    .btn-delete:hover {
      background: #ff5252;
      transform: translateY(-2px);
    }
    .btn-check {
      background: #51cf66;
      color: white;
    }
    .btn-check:hover {
      background: #40c057;
      transform: translateY(-2px);
    }
    .message {
      padding: 12px;
      border-radius: 6px;
      margin-top: 20px;
      display: none;
      font-size: 14px;
    }
    .message.success {
      background: #d3f9d8;
      color: #2f8659;
      border: 1px solid #69db7c;
    }
    .message.error {
      background: #ffe0e0;
      color: #862e2e;
      border: 1px solid #ff8787;
    }
    .message.info {
      background: #d0ebff;
      color: #1c4d6d;
      border: 1px solid #74c0fc;
    }
    .info-box {
      background: #f0f4ff;
      border-left: 4px solid #667eea;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 4px;
      font-size: 13px;
      color: #333;
      line-height: 1.6;
    }
    .loader {
      display: none;
      text-align: center;
      margin-top: 10px;
    }
    .spinner {
      border: 3px solid #f3f3f3;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      animation: spin 1s linear infinite;
      margin: 0 auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .status {
      margin-top: 20px;
      padding: 15px;
      background: #f5f5f5;
      border-radius: 6px;
      font-size: 13px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Hacksaw Credentials</h1>
    <p class="subtitle">Securely store your Hacksaw API credentials</p>

    <div class="info-box">
      <strong>ℹ️ How it works:</strong><br>
      Your credentials are encrypted and stored securely in the database. They're never logged or displayed in plain text.
    </div>

    <form id="credentialsForm">
      <div class="form-group readonly">
        <label>Service</label>
        <input type="text" value="hacksaw-in" readonly>
      </div>

      <div class="form-group">
        <label>Organization Name</label>
        <input type="text" id="organisation" name="organisation" placeholder="e.g., zoho" required>
      </div>

      <div class="form-group">
        <label>Client ID</label>
        <input type="password" id="clientId" name="clientId" placeholder="Your Hacksaw Client ID" required>
      </div>

      <div class="form-group">
        <label>Client Secret</label>
        <input type="password" id="clientSecret" name="clientSecret" placeholder="Your Hacksaw Client Secret" required>
      </div>

      <div class="button-group">
        <button type="button" class="btn-check" onclick="checkStatus()">Check Status</button>
        <button type="submit" class="btn-save">Save Credentials</button>
        <button type="button" class="btn-delete" onclick="deleteCredentials()">Delete</button>
      </div>

      <div class="loader" id="loader">
        <div class="spinner"></div>
      </div>

      <div class="message" id="message"></div>
      <div class="status" id="status" style="display:none;"></div>
    </form>
  </div>

  <script>
    const form = document.getElementById('credentialsForm');
    const messageEl = document.getElementById('message');
    const loaderEl = document.getElementById('loader');
    const statusEl = document.getElementById('status');

    function showMessage(text, type) {
      messageEl.textContent = text;
      messageEl.className = 'message ' + type;
      messageEl.style.display = 'block';
      setTimeout(() => { messageEl.style.display = 'none'; }, 5000);
    }

    function showLoader(show) {
      loaderEl.style.display = show ? 'block' : 'none';
    }

    async function checkStatus() {
      try {
        showLoader(true);
        const response = await fetch('/api/hacksaw/credentials', { method: 'GET' });
        const data = await response.json();

        if (data.success && data.data) {
          const meta = data.data;
          statusEl.innerHTML = \`
            <strong>✅ Credentials Configured</strong><br>
            Organization: <strong>\${meta.organisation}</strong><br>
            Profile: <strong>\${meta.profile}</strong><br>
            Updated: <strong>\${new Date(meta.updatedAt).toLocaleString()}</strong>
          \`;
          statusEl.style.display = 'block';
          showMessage('Credentials are properly configured', 'success');
        } else {
          statusEl.innerHTML = '<strong>❌ No credentials configured</strong>';
          statusEl.style.display = 'block';
          showMessage('No credentials found. Please save them first.', 'info');
        }
      } catch (error) {
        showMessage('Error checking status: ' + error.message, 'error');
      } finally {
        showLoader(false);
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const organisation = document.getElementById('organisation').value.trim();
      const clientId = document.getElementById('clientId').value.trim();
      const clientSecret = document.getElementById('clientSecret').value.trim();

      if (!organisation || !clientId || !clientSecret) {
        showMessage('All fields are required', 'error');
        return;
      }

      try {
        showLoader(true);
        const response = await fetch('/api/hacksaw/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organisation, clientId, clientSecret })
        });

        const data = await response.json();

        if (!response.ok) throw new Error(data.message || 'Failed to save credentials');

        showMessage('✅ Credentials saved successfully!', 'success');
        form.reset();
        statusEl.style.display = 'none';

        // Auto-check status after saving
        setTimeout(checkStatus, 1000);
      } catch (error) {
        showMessage('❌ Error: ' + error.message, 'error');
      } finally {
        showLoader(false);
      }
    });

    async function deleteCredentials() {
      if (!confirm('Are you sure you want to delete the stored credentials?')) return;

      try {
        showLoader(true);
        const response = await fetch('/api/hacksaw/credentials', { method: 'DELETE' });
        const data = await response.json();

        if (!response.ok) throw new Error(data.message || 'Failed to delete credentials');

        showMessage('✅ Credentials deleted successfully', 'success');
        form.reset();
        statusEl.style.display = 'none';
      } catch (error) {
        showMessage('❌ Error: ' + error.message, 'error');
      } finally {
        showLoader(false);
      }
    }

    // Check status on page load
    window.addEventListener('load', checkStatus);
  </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Hacksaw Credentials - Save/Update
app.post('/api/hacksaw/credentials', async (req, res) => {
  try {
    const { organisation, clientId, clientSecret } = req.body;

    if (!organisation || !clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        message: 'organisation, clientId, and clientSecret are required',
      });
    }

    const result = await credsManager.storeCredentials(
      organisation,
      clientId,
      clientSecret,
      'in'
    );

    res.json({
      success: true,
      message: 'Credentials saved successfully',
      data: result.data,
    });
  } catch (error) {
    console.error('❌ Error saving credentials:', error.message);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

// Hacksaw Credentials - Retrieve metadata
app.get('/api/hacksaw/credentials', async (req, res) => {
  try {
    const metadata = await credsManager.getCredentialMetadata('in');

    if (!metadata) {
      return res.json({
        success: false,
        message: 'No credentials configured',
        data: null,
      });
    }

    res.json({
      success: true,
      message: 'Credentials found',
      data: metadata,
    });
  } catch (error) {
    console.error('❌ Error retrieving credentials:', error.message);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

// Hacksaw Credentials - Delete
app.delete('/api/hacksaw/credentials', async (req, res) => {
  try {
    await credsManager.deleteCredentials('in');
    res.json({
      success: true,
      message: 'Credentials deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting credentials:', error.message);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

// Zoho OAuth 2.0 - List Supported Services
app.get('/api/oauth/services', (req, res) => {
  try {
    if (!zohoOAuth) {
      return res.status(503).json({ error: 'OAuth not available' });
    }

    const services = zohoOAuth.listServices();

    res.json({
      success: true,
      services: services,
      total_services: services.length,
    });
  } catch (error) {
    console.error('❌ OAuth services error:', error.message);
    res.status(400).json({
      error: 'Failed to list services',
      message: error.message,
    });
  }
});

// Zoho OAuth 2.0 - Start Authorization Flow
app.get('/api/oauth/authorize', (req, res) => {
  try {
    if (!zohoOAuth) {
      return res.status(503).json({ error: 'OAuth not available' });
    }

    const serviceName = req.query.service || 'hacksaw';

    if (!zohoOAuth.getServiceInfo(serviceName)) {
      return res.status(400).json({
        error: 'Service not supported',
        message: `Service '${serviceName}' is not registered`,
        available_services: zohoOAuth.listServices().map(s => s.service_id),
      });
    }

    const redirectUri = req.query.redirect_uri || `${req.protocol}://${req.get('host')}/api/oauth/callback`;

    // Parse additional scopes from query parameter (comma-separated)
    const additionalScopes = req.query.scopes
      ? req.query.scopes.split(',').map(s => s.trim()).filter(s => s)
      : [];

    const authUrl = zohoOAuth.getAuthorizationUrl(serviceName, redirectUri, additionalScopes);
    const serviceInfo = zohoOAuth.getServiceInfo(serviceName);

    console.log(`🔐 Generating OAuth authorization URL for ${serviceName}`);
    console.log(`   Redirect URI: ${redirectUri}`);

    res.json({
      success: true,
      message: 'OAuth authorization URL generated',
      service: serviceName,
      service_name: serviceInfo.name,
      auth_url: authUrl,
      redirect_uri: redirectUri,
      scopes: serviceInfo.scopes,
      scope_count: serviceInfo.scope_count,
      additional_scopes: additionalScopes,
    });
  } catch (error) {
    console.error('❌ OAuth authorization error:', error.message);
    res.status(400).json({
      error: 'Failed to generate authorization URL',
      message: error.message,
    });
  }
});

// Zoho OAuth 2.0 - OAuth Callback (service-agnostic)
app.get('/api/oauth/callback', async (req, res) => {
  try {
    if (!zohoOAuth) {
      return res.status(503).json({ error: 'OAuth not available' });
    }

    const { code, state, error } = req.query;
    const serviceName = req.query.service || 'hacksaw';

    if (error) {
      console.error('❌ OAuth error:', error);
      return res.status(400).json({
        error: 'OAuth authorization failed',
        message: error,
      });
    }

    if (!code) {
      return res.status(400).json({
        error: 'Missing authorization code',
      });
    }

    console.log(`🔐 Exchanging authorization code for token (service: ${serviceName})`);

    const redirectUri = `${req.protocol}://${req.get('host')}/api/oauth/callback`;
    const tokenData = await zohoOAuth.exchangeCodeForToken(code, redirectUri);

    console.log('✅ Token received from Zoho');

    // Get user ID from session or use default
    const userId = req.query.user_id || 'default_user';

    // Store OAuth token for the service
    await zohoOAuth.storeOAuthToken(serviceName, userId, tokenData);

    res.json({
      success: true,
      message: 'OAuth authorization successful',
      service: serviceName,
      user_id: userId,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
    });
  } catch (error) {
    console.error('❌ OAuth callback error:', error.message);
    res.status(400).json({
      error: 'OAuth authentication failed',
      message: error.message,
    });
  }
});

// Zoho OAuth 2.0 - Check Authorization Status
app.get('/api/oauth/status', (req, res) => {
  try {
    if (!zohoOAuth) {
      return res.status(503).json({ error: 'OAuth not available' });
    }

    const serviceName = req.query.service || 'hacksaw';
    const userId = req.query.user_id || 'default_user';

    const isAuthorized = zohoOAuth.isAuthorized(serviceName, userId);
    const token = zohoOAuth.getOAuthToken(serviceName, userId);

    res.json({
      success: true,
      service: serviceName,
      user_id: userId,
      authorized: isAuthorized,
      token_type: token ? token.token_type : null,
      expires_at: token ? token.expires_at : null,
    });
  } catch (error) {
    console.error('❌ OAuth status error:', error.message);
    res.status(400).json({
      error: 'Failed to check authorization status',
      message: error.message,
    });
  }
});

// Zoho OAuth 2.0 - Revoke Authorization
app.post('/api/oauth/revoke', async (req, res) => {
  try {
    if (!zohoOAuth) {
      return res.status(503).json({ error: 'OAuth not available' });
    }

    const serviceName = req.query.service || req.body.service || 'hacksaw';
    const userId = req.query.user_id || req.body.user_id || 'default_user';

    console.log(`🔐 Revoking OAuth token for ${serviceName}/${userId}`);

    // Revoke authorization
    await zohoOAuth.revokeAuthorization(serviceName, userId);

    res.json({
      success: true,
      message: 'OAuth authorization revoked successfully',
      service: serviceName,
      user_id: userId,
    });
  } catch (error) {
    console.error('❌ OAuth revoke error:', error.message);
    res.status(400).json({
      error: 'Failed to revoke authorization',
      message: error.message,
    });
  }
});

// Hacksaw Products - Fetch all products available in Hacksaw
app.get('/api/hacksaw/products', async (req, res) => {
  try {
    if (!connManager) {
      return res.status(503).json({ error: 'Connection manager not available' });
    }

    console.log('📦 Fetching Hacksaw products...');

    // Get Hacksaw credentials from config (org-wide)
    const hacksawCreds = connManager.getHacksawCredentials();

    // Fetch products using org credentials
    const products = await connManager.fetchHacksawProducts(hacksawCreds);

    console.log(`✅ Fetched ${products.length || 0} Hacksaw products`);

    res.json({
      success: true,
      profile: connManager.profile,
      service: 'hacksaw',
      products: products,
      total_count: products.length || 0,
    });
  } catch (error) {
    console.error('❌ Hacksaw products error:', error.message);
    res.status(400).json({
      error: 'Failed to fetch Hacksaw products',
      message: error.message,
    });
  }
});

// Hacksaw Violations - Fetch vulnerable components (violations) from Hacksaw
app.get('/api/hacksaw/violations', async (req, res) => {
  try {
    if (!connManager) {
      return res.status(503).json({ error: 'Connection manager not available' });
    }

    // Get all required parameters from query string
    const { organisation, productname, reportlabel, filter, user_id } = req.query;

    // Validate required parameters
    if (!organisation) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'organisation parameter is required',
      });
    }
    if (!productname) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'productname parameter is required',
      });
    }
    if (!reportlabel) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'reportlabel parameter is required',
      });
    }

    console.log(`🔍 Fetching Hacksaw violations for organisation: ${organisation}`);

    // Try OAuth token first, fall back to stored credentials
    let hacksawCreds = null;
    let authSource = null;

    // Check for OAuth token (prefer OAuth over Basic Auth)
    if (zohoOAuth) {
      const userId = user_id || 'default_user';
      const oauthToken = zohoOAuth.getOAuthToken('hacksaw', userId);

      if (oauthToken) {
        console.log(`🔐 Using OAuth token for user: ${userId}`);
        hacksawCreds = {
          access_token: oauthToken.access_token,
        };
        authSource = 'oauth';
      }
    }

    // Fall back to stored credentials if no OAuth token
    if (!hacksawCreds) {
      const storedCreds = await credsManager.getCredentials('in');

      if (storedCreds) {
        console.log('📦 Using stored Hacksaw credentials');
        hacksawCreds = {
          clientId: storedCreds.clientId,
          clientSecret: storedCreds.clientSecret,
        };
        authSource = 'datastore';
      } else {
        console.log('📦 Using environment variable Hacksaw credentials');
        hacksawCreds = connManager.getHacksawCredentials();
        authSource = 'environment';
      }
    }

    // Parse filter if provided (should be JSON string)
    let parsedFilter = {};
    if (filter) {
      try {
        parsedFilter = typeof filter === 'string' ? JSON.parse(filter) : filter;
      } catch (e) {
        return res.status(400).json({
          error: 'Invalid filter parameter',
          message: 'filter must be valid JSON',
        });
      }
    }

    // Fetch violations using credentials/token with all query parameters
    const violations = await connManager.fetchHacksawViolations(
      hacksawCreds,
      organisation,
      productname,
      reportlabel,
      parsedFilter
    );

    const componentCount = violations.CONTENT ? violations.CONTENT.length : 0;
    console.log(`✅ Fetched ${componentCount} components with violations`);

    res.json({
      success: true,
      profile: connManager.profile,
      service: 'hacksaw',
      organisation: organisation,
      productname: productname,
      reportlabel: reportlabel,
      filter: parsedFilter,
      status: violations.STATUS,
      components: violations.CONTENT || [],
      total_count: componentCount,
      authSource: authSource,
    });
  } catch (error) {
    console.error('❌ Hacksaw violations error:', error.message);
    res.status(400).json({
      error: 'Failed to fetch Hacksaw violations',
      message: error.message,
    });
  }
});

app.all('*', (req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Start server (only in local development mode when run directly)
if (require.main === module) {
  const port = process.env.PORT || 8000;
  app.listen(port, () => {
    console.log(`\n🚀 Server listening on http://localhost:${port}`);
    console.log(`📋 Health check: http://localhost:${port}/api/health`);
    console.log(`🔐 OAuth enabled: ${isOAuthEnabled() ? 'Yes' : 'No'}`);
    if (connManager) {
      try {
        const profile = connManager.getProfile();
        console.log(`🔗 Hacksaw API: https://${profile.hacksaw_domain}`);
      } catch (e) {
        // Silent
      }
    }
    console.log(`\n`);
  });
}

// Export as default - Catalyst expects this for BasicIO
module.exports = app;
