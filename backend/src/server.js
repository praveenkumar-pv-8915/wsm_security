const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// Auth middleware
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
  res.json({ status: 'ok', message: 'Team Management App Running' });
});

// Get creator profile
app.get('/api/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'X-User-ID header required' });
    }

    // Use Catalyst Datastore when available
    if (typeof DataStore !== 'undefined') {
      const datastore = new DataStore();
      const records = await datastore.getTable('creators').getRecords({
        filters: [['user_id', '==', userId]]
      });

      if (records.rows && records.rows.length > 0) {
        return res.json({ profile: records.rows[0] });
      }
    }

    res.status(404).json({ error: 'Profile not found' });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile', details: error.message });
  }
});

// Create/update creator profile
app.post('/api/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { name, email } = req.body;

    if (!userId || !name || !email) {
      return res.status(400).json({ error: 'user_id, name, and email are required' });
    }

    // Use Catalyst Datastore when available
    if (typeof DataStore !== 'undefined') {
      const datastore = new DataStore();

      // Check if profile exists
      const records = await datastore.getTable('creators').getRecords({
        filters: [['user_id', '==', userId]]
      });

      let result;
      if (records.rows && records.rows.length > 0) {
        // Update existing
        result = await datastore.getTable('creators').updateRow(records.rows[0].CREATORID, {
          name,
          email
        });
      } else {
        // Create new
        result = await datastore.getTable('creators').insertRow({
          user_id: userId,
          name,
          email,
          created_at: new Date().toISOString()
        });
      }

      return res.status(201).json({ success: true, data: result });
    }

    res.json({ success: true, data: { user_id: userId, name, email, created_at: new Date().toISOString() } });
  } catch (error) {
    console.error('Error creating/updating profile:', error);
    res.status(500).json({ error: 'Failed to create profile', details: error.message });
  }
});

// Get tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'X-User-ID header required' });
    }

    // Use Catalyst Datastore when available
    if (typeof DataStore !== 'undefined') {
      const datastore = new DataStore();
      const records = await datastore.getTable('tasks').getRecords({
        filters: [['user_id', '==', userId]]
      });

      return res.json({ tasks: records.rows || [] });
    }

    res.json({ tasks: [] });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks', details: error.message });
  }
});

// Create task
app.post('/api/tasks', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { title, description, status, priority, due_date } = req.body;

    if (!userId || !title) {
      return res.status(400).json({ error: 'user_id and title are required' });
    }

    // Use Catalyst Datastore when available
    if (typeof DataStore !== 'undefined') {
      const datastore = new DataStore();
      const result = await datastore.getTable('tasks').insertRow({
        user_id: userId,
        title,
        description: description || '',
        status: status || 'pending',
        priority: priority || 'medium',
        due_date: due_date || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      return res.status(201).json({ success: true, data: result });
    }

    res.json({ success: true, data: { title, description, status, priority, due_date, created_at: new Date().toISOString() } });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task', details: error.message });
  }
});

// Get specific task
app.get('/api/tasks/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const taskId = req.params.id;

    if (!userId) {
      return res.status(400).json({ error: 'X-User-ID header required' });
    }

    if (typeof DataStore !== 'undefined') {
      const datastore = new DataStore();
      const record = await datastore.getTable('tasks').getRow(taskId);

      if (!record) {
        return res.status(404).json({ error: 'Task not found' });
      }

      if (record.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      return res.json({ task: record });
    }

    res.status(404).json({ error: 'Task not found' });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to fetch task', details: error.message });
  }
});

// Update task
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const taskId = req.params.id;

    if (!userId) {
      return res.status(400).json({ error: 'X-User-ID header required' });
    }

    if (typeof DataStore !== 'undefined') {
      const datastore = new DataStore();
      const record = await datastore.getTable('tasks').getRow(taskId);

      if (!record) {
        return res.status(404).json({ error: 'Task not found' });
      }

      if (record.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const updateData = {
        ...req.body,
        updated_at: new Date().toISOString()
      };

      const result = await datastore.getTable('tasks').updateRow(taskId, updateData);
      return res.json({ success: true, data: result });
    }

    res.status(404).json({ error: 'Task not found' });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task', details: error.message });
  }
});

// Delete task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const taskId = req.params.id;

    if (!userId) {
      return res.status(400).json({ error: 'X-User-ID header required' });
    }

    if (typeof DataStore !== 'undefined') {
      const datastore = new DataStore();
      const record = await datastore.getTable('tasks').getRow(taskId);

      if (!record) {
        return res.status(404).json({ error: 'Task not found' });
      }

      if (record.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await datastore.getTable('tasks').deleteRow(taskId);
      return res.json({ success: true, message: 'Task deleted' });
    }

    res.status(404).json({ error: 'Task not found' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task', details: error.message });
  }
});

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Export for Catalyst serverless
module.exports = app;
