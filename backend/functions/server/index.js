const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

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

// Catalyst BasicIO handler
exports.wsm_security = async (request, response) => {
  try {
    return new Promise((resolve, reject) => {
      app(request, response, (err) => {
        if (err) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: err.message }));
          reject(err);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
};
