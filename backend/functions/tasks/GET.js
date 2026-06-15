const { getTasks } = require('../../src/utils/datastore');
const { validateAuth } = require('../../src/utils/auth');

module.exports = async (request, response) => {
  try {
    const auth = validateAuth(request);
    if (!auth.valid) {
      return response.status(401).json({ error: auth.error });
    }

    const tasks = await getTasks(auth.userId);
    response.status(200).json({ tasks });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    response.status(500).json({ error: 'Failed to fetch tasks', details: error.message });
  }
};