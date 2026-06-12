require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const catalyst = require('zcatalyst-sdk');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// Initialize Catalyst
catalyst.initialize();

// SAS Authentication middleware
app.use((req, res, next) => {
  const authToken = req.headers.authorization?.split(' ')[1];
  if (!authToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.authToken = authToken;
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Creator App Backend Running' });
});

// Get creator profile
app.get('/api/creator/profile', async (req, res) => {
  try {
    const datastore = catalyst.getDatastore();
    const userId = req.headers['x-user-id'];

    const profile = await datastore.query()
      .from('creators')
      .where('user_id', '==', userId)
      .build()
      .fetch();

    res.json({ profile: profile.length > 0 ? profile[0] : null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile', details: error.message });
  }
});

// Create/update creator profile
app.post('/api/creator/profile', async (req, res) => {
  try {
    const datastore = catalyst.getDatastore();
    const userId = req.headers['x-user-id'];
    const { name, email } = req.body;

    const result = await datastore.insert('creators', {
      user_id: userId,
      name,
      email,
      created_at: new Date().toISOString()
    });

    res.json({ success: true, data: result });
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