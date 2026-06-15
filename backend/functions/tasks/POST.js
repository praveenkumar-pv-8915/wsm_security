const { createTask } = require('../../src/utils/datastore');
const { validateAuth } = require('../../src/utils/auth');

module.exports = async (request, response) => {
  try {
    const auth = validateAuth(request);
    if (!auth.valid) {
      return response.status(401).json({ error: auth.error });
    }

    const { title, description, status, priority, due_date } = request.body;
    if (!title) {
      return response.status(400).json({ error: 'Title is required' });
    }

    const taskData = {
      title,
      description: description || '',
      status: status || 'pending',
      priority: priority || 'medium',
      due_date: due_date || null
    };

    const result = await createTask(auth.userId, taskData);
    response.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('Error creating task:', error);
    response.status(500).json({ error: 'Failed to create task', details: error.message });
  }
};