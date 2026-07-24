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
  res.redirect('/dashboard');
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
app.use((req, res, next) => {
  try {
    const catalystApp = catalyst.initialize(req);

    // Use Catalyst SDK to get authenticated user (like ZCUser.getCurrentUser() in Java)
    let user = null;

    // Try to get user from SDK
    try {
      user = catalystApp.getCurrentUser?.();
    } catch (e) {
      console.log('getCurrentUser failed:', e.message);
    }

    console.log('=== AUTH CHECK ===', {
      path: req.path,
      user: user ? JSON.stringify(user).substring(0, 50) : 'null'
    });

    // User must be present for authenticated access
    if (!user) {
      console.log('>>> NO USER - REDIRECTING TO LOGIN <<<');
      // Redirect to Catalyst login page if not authenticated
      return res.redirect('/__catalyst/auth/login');
    }

    console.log('>>> AUTHENTICATED <<<', user);
    // Extract user ID (might be in different fields depending on SDK)
    const userId = user.id || user.userId || user.email || user.name;
    req.userId = userId;
    req.catalystApp = catalystApp;
    next();
  } catch (error) {
    console.error('Auth error:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed: ' + error.message
    });
  }
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
  const result = await deactivateCredential(req, parseInt(req.params.id));
  res.status(result.success ? 200 : 400).json(result);
});

// Dashboard (after auth)
app.get('/dashboard', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getDashboardPage(req.userId));
});

module.exports = app;
