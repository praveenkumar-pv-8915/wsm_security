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

// Catalyst Authentication Middleware
app.use((req, res, next) => {
  const catalystApp = catalyst.initialize(req);
  const userId = catalystApp.getUserId();

  // Let Catalyst handle redirect if not authenticated
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  req.userId = userId;
  req.catalystApp = catalystApp;
  next();
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
