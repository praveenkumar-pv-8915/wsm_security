// Load environment variables from .env file (for local development)
if (process.env.ENVIRONMENT !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const config = require('./config');
const { validateToken, optionalAuth } = require('./auth-middleware');
const { exchangeCodeForToken, getUserProfile, prepareUserData } = require('./oauth');

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

// Validate environment on startup
const isConfigValid = config.validate();
if (!isConfigValid && config.environment === 'production') {
  console.error('❌ Critical: Missing required environment variables');
  process.exit(1);
}

console.log('🚀 WSM-Security API initialized');
console.log('📋 Config:', config.summary());

// Health check endpoint - includes config status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'WSM-Security API Running',
    config: config.summary(),
  });
});

// OAuth Callback - Exchange authorization code for token
if (config.isOAuthEnabled()) {
  app.post('/api/auth/callback', async (req, res) => {
    try {
      const { code } = req.body;

      if (!code) {
        console.warn('⚠️  Missing authorization code in callback');
        return res.status(400).json({ error: 'Missing authorization code' });
      }

      console.log('📝 Step 1: Exchanging code for token...');
      const tokenData = await exchangeCodeForToken(code);
      console.log('✓ Token received from Zoho');

      console.log('👤 Step 2: Fetching user profile...');
      const userProfile = await getUserProfile(tokenData.access_token);
      console.log(`✓ Profile fetched: ${userProfile.email}`);

      console.log('💾 Step 3: Preparing user data for storage...');
      const userData = prepareUserData(userProfile, tokenData);

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
} else {
  console.warn('⚠️  OAuth not enabled - set ZOHO_CLIENT_ID to enable');
}

// OAuth Login URL - provides link for frontend to redirect to Zoho
if (config.isOAuthEnabled()) {
  app.get('/api/auth/login-url', (req, res) => {
    const loginUrl = `${config.zoho.authUrl}?` +
      `client_id=${config.zoho.clientId}` +
      `&response_type=code` +
      `&scope=userprofile.read` +
      `&redirect_uri=${encodeURIComponent(config.zoho.redirectUri)}`;

    res.json({
      login_url: loginUrl,
      oauth_enabled: true,
    });
  });
}

// Profile endpoints (requires authentication if OAuth is enabled)
const profileMiddleware = config.isOAuthEnabled() ? validateToken : optionalAuth;

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

app.all('*', (req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Start server (only in local development mode when run directly)
if (require.main === module) {
  const port = config.port;
  app.listen(port, () => {
    console.log(`\n🚀 Server listening on http://localhost:${port}`);
    console.log(`📋 Health check: http://localhost:${port}/api/health`);
    console.log(`🔐 OAuth enabled: ${config.isOAuthEnabled() ? 'Yes' : 'No'}`);
    if (config.isOAuthEnabled()) {
      console.log(`🔗 Redirect URI: ${config.zoho.redirectUri}`);
    }
    console.log(`\n`);
  });
}

// Export as default - Catalyst expects this for BasicIO
module.exports = app;
