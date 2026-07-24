const express = require('express');
const catalyst = require('zcatalyst-sdk-node');
const { addCredential, getCredential, listCredentials, deactivateCredential } = require('./credential-service');
const { getDashboardPage } = require('./auth-ui');

const app = express();
app.use(express.json());

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Credential Management API Running',
    version: '1.0.0'
  });
});

// Root redirect to dashboard (Catalyst will handle login redirect)
app.get('/', (req, res) => {
  res.redirect('/server/welcome/dashboard');
});

// Redirect /app to dashboard (post-login redirect from Catalyst)
app.get('/app/', (req, res) => {
  res.redirect('/server/welcome/dashboard');
});

// Logout route - clears session and redirects to login
app.get('/logout', (req, res) => {
  res.clearCookie('JSESSIONID');
  res.redirect('/__catalyst/auth/login');
});

// Disable caching for auth-protected pages
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Catalyst Authentication Middleware
app.use(async (req, res, next) => {
  // Skip auth for /api/health (health check doesn't need auth)
  if (req.path === '/api/health') {
    return next();
  }

  try {
    const catalystApp = catalyst.initialize(req);

    // Use Catalyst SDK to get authenticated user (like ZCUser.getCurrentUser() in Java)
    let user = null;
    try {
      user = await catalystApp.userManagement().getCurrentUser();
    } catch (e) {
      console.log('getCurrentUser failed:', e.message);
    }

    console.log('=== AUTH CHECK ===', {
      path: req.path,
      user: user ? JSON.stringify(user).substring(0, 80) : 'null'
    });

    // User must be present for authenticated access
    if (!user) {
      console.log('>>> NO USER - NOT AUTHENTICATED <<<');
      // API calls get JSON 401 so the frontend can handle it;
      // page navigations get redirected to the Catalyst login page
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated. Please sign in.'
        });
      }
      return res.redirect('/__catalyst/auth/login');
    }

    console.log('>>> AUTHENTICATED <<<', user.email_id || user.user_id);
    // Catalyst user object fields: user_id, email_id, first_name, last_name
    const userId = String(user.user_id || user.email_id);
    req.userId = userId;
    req.catalystApp = catalystApp;
    // Admin-scoped instance for DataStore/ZCQL ops (app users lack table privileges);
    // authorization is still enforced per-user via owner_id checks in credential-service
    req.catalystAdmin = catalyst.initialize(req, { scope: 'admin' });
    next();
  } catch (error) {
    console.error('Auth error:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed: ' + error.message
    });
  }
});

// API routes (used by frontend)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Credential Management API Running',
    version: '1.0.0'
  });
});

app.post('/api/credentials/add', async (req, res) => {
  const result = await addCredential(req, req.body);
  res.status(result.success ? 201 : 400).json(result);
});

app.get('/api/credentials/:name', async (req, res) => {
  const result = await getCredential(req, req.params.name);
  res.status(result.success ? 200 : 400).json(result);
});

app.get('/api/credentials', async (req, res) => {
  const result = await listCredentials(req);
  res.status(result.success ? 200 : 400).json(result);
});

app.delete('/api/credentials/:id', async (req, res) => {
  // ROWID exceeds Number.MAX_SAFE_INTEGER — must stay a string
  const result = await deactivateCredential(req, req.params.id);
  res.status(result.success ? 200 : 400).json(result);
});

// Add credential
app.post('/credentials/add', async (req, res) => {
  const result = await addCredential(req, req.body);
  res.status(result.success ? 201 : 400).json(result);
});

// Get credential
app.get('/credentials/:name', async (req, res) => {
  const result = await getCredential(req, req.params.name);
  res.status(result.success ? 200 : 400).json(result);
});

// List all credentials
app.get('/credentials', async (req, res) => {
  const result = await listCredentials(req);
  res.status(result.success ? 200 : 400).json(result);
});

// Deactivate credential
app.delete('/credentials/:id', async (req, res) => {
  const result = await deactivateCredential(req, req.params.id);
  res.status(result.success ? 200 : 400).json(result);
});

// Dashboard (after auth)
app.get('/dashboard', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getDashboardPage(req.userId));
});

module.exports = app;
