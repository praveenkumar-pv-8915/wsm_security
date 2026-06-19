// Load environment variables from .env file (for local development)
if (process.env.ENVIRONMENT !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const path = require('path');
const ConnectionManager = require('./connections');
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

// Hacksaw Products - Fetch all products from Hacksaw
app.get('/api/hacksaw/products', validateToken, async (req, res) => {
  try {
    if (!connManager) {
      return res.status(503).json({ error: 'Connection manager not available' });
    }

    // TODO: Get Hacksaw access token from storage or current OAuth session
    // For now, this is a placeholder endpoint
    res.json({
      products: [],
      message: 'Hacksaw connection configured. Use your Hacksaw OAuth token to fetch products.',
      connection_info: {
        service: 'hacksaw',
        profile: connManager.profile,
        endpoint: `https://${connManager.getProfile().hacksaw_domain}/api/v1/products`,
      },
    });
  } catch (error) {
    console.error('Hacksaw products error:', error.message);
    res.status(400).json({
      error: 'Failed to fetch Hacksaw products',
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
