const { createOrUpdateProfile } = require('../../src/utils/datastore');
const { validateAuth } = require('../../src/utils/auth');

module.exports = async (request, response) => {
  try {
    const auth = validateAuth(request);
    if (!auth.valid) {
      return response.status(401).json({ error: auth.error });
    }

    const { name, email } = request.body;
    if (!name || !email) {
      return response.status(400).json({ error: 'Name and email are required' });
    }

    const result = await createOrUpdateProfile(auth.userId, { name, email });
    response.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('Error creating/updating profile:', error);
    response.status(500).json({ error: 'Failed to create profile', details: error.message });
  }
};