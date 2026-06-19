const express = require('express');

const app = express();

app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'WSM-Security App Running' });
});

// Profile endpoints
app.get('/api/profile', (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    res.json({ profile: { user_id: userId, name: 'Creator', email: 'creator@example.com' } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { name, email } = req.body;
    res.json({ success: true, data: { user_id: userId, name, email, created_at: new Date().toISOString() } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Task endpoints
app.get('/api/tasks', (req, res) => {
  res.json({ tasks: [] });
});

app.post('/api/tasks', (req, res) => {
  const { title } = req.body;
  res.json({ success: true, data: { title, created_at: new Date().toISOString() } });
});

// Catch all
app.all('*', (req, res) => {
  res.status(404).json({ message: 'WSM-Security API - Use /api/* endpoints' });
});

// Default export for Catalyst BasicIO
module.exports = app;
