const { getTaskById, updateTask } = require('../../../src/utils/datastore');
const { validateAuth } = require('../../../src/utils/auth');

module.exports = async (request, response) => {
  try {
    const auth = validateAuth(request);
    if (!auth.valid) {
      return response.status(401).json({ error: auth.error });
    }

    const taskId = request.pathParams?.id;
    if (!taskId) {
      return response.status(400).json({ error: 'Task ID is required' });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return response.status(404).json({ error: 'Task not found' });
    }

    if (task.user_id !== auth.userId) {
      return response.status(403).json({ error: 'Forbidden' });
    }

    const updateData = request.body;
    const result = await updateTask(taskId, updateData);
    response.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error updating task:', error);
    response.status(500).json({ error: 'Failed to update task', details: error.message });
  }
};