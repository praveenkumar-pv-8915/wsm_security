const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Set timeout
app.use((req, res, next) => {
  res.setTimeout(55000);
  next();
});

// Auth middleware
app.use((req, res, next) => {
  const authToken = req.headers.authorization?.split(' ')[1];
  if (req.path.startsWith('/api') && !authToken && !req.path.includes('/health')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.authToken = authToken;
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'WSM-Security App Running' });
});

// Profile endpoints
app.get('/api/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    res.json({ profile: { user_id: userId, name: 'Creator', email: 'creator@example.com' } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { name, email } = req.body;
    res.json({ success: true, data: { user_id: userId, name, email, created_at: new Date().toISOString() } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Task endpoints
app.get('/api/tasks', async (req, res) => {
  res.json({ tasks: [] });
});

app.post('/api/tasks', async (req, res) => {
  const { title } = req.body;
  res.json({ success: true, data: { title, created_at: new Date().toISOString() } });
});

// Health response for all other routes
app.all('*', (req, res) => {
  res.json({ message: 'WSM-Security API - Use /api/* endpoints' });
});

module.exports = async (request, response) => {
  return new Promise((resolve, reject) => {
    app(request, response, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};
