const { getTaskById, deleteTask } = require('../../../src/utils/datastore');
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

    await deleteTask(taskId);
    response.status(200).json({ success: true, message: 'Task deleted' });
  } catch (error) {
    console.error('Error deleting task:', error);
    response.status(500).json({ error: 'Failed to delete task', details: error.message });
  }
};