const express = require('express');

const app = express();
app.use(express.json());

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'WSM-Security App Running' });
});

// TODO: Add Managed Authentication callback when ready

app.get('/api/profile', (req, res) => {
  const userId = req.headers['x-user-id'];
  res.json({ profile: { user_id: userId, name: 'Creator', email: 'creator@example.com' } });
});

app.post('/api/profile', (req, res) => {
  const userId = req.headers['x-user-id'];
  const { name, email } = req.body;
  res.json({ success: true, data: { user_id: userId, name, email, created_at: new Date().toISOString() } });
});

app.get('/api/tasks', (req, res) => {
  res.json({ tasks: [] });
});

app.post('/api/tasks', (req, res) => {
  const { title } = req.body;
  res.json({ success: true, data: { title, created_at: new Date().toISOString() } });
});

app.all('*', (req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Export as default - Catalyst expects this for BasicIO
module.exports = app;
