const express = require('express');
const { addCredential, getCredential, listCredentials, deactivateCredential } = require('./credential-service');

const app = express();
app.use(express.json());

// Middleware to extract user context
app.use((req, res, next) => {
  req.userId = parseInt(req.headers['x-user-id'] || '0');
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'x-user-id header required' });
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Credential Management API Running',
    version: '1.0.0'
  });
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

// Catch-all
app.get('/', (req, res) => {
  res.json({
    message: 'WSM Security - Credential Management API',
    endpoints: {
      'POST /credentials/add': 'Add new credential',
      'GET /credentials': 'List all credentials',
      'GET /credentials/:name': 'Get specific credential',
      'DELETE /credentials/:id': 'Deactivate credential'
    }
  });
});

module.exports = app;
