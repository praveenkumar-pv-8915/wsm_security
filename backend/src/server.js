require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// Auth middleware (optional for testing)
app.use((req, res, next) => {
  const authToken = req.headers.authorization?.split(' ')[1];
  if (req.path.startsWith('/api')) {
    if (!authToken && !req.path.includes('/health')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  req.authToken = authToken;
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Creator App Backend Running' });
});

// Get creator profile (mock for testing)
app.get('/api/creator/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    res.json({ profile: { user_id: userId, name: 'Test Creator', email: 'test@example.com' } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile', details: error.message });
  }
});

// Create/update creator profile (mock for testing)
app.post('/api/creator/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { name, email } = req.body;

    res.json({ success: true, data: { user_id: userId, name, email, created_at: new Date().toISOString() } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create profile', details: error.message });
  }
});

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Creator App Backend running on port ${PORT}`);
});