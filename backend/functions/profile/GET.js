const { getCreatorProfile } = require('../../src/utils/datastore');
const { validateAuth } = require('../../src/utils/auth');

module.exports = async (request, response) => {
  try {
    const auth = validateAuth(request);
    if (!auth.valid) {
      return response.status(401).json({ error: auth.error });
    }

    const profile = await getCreatorProfile(auth.userId);
    if (!profile) {
      return response.status(404).json({ error: 'Profile not found' });
    }

    response.status(200).json({ profile });
  } catch (error) {
    console.error('Error fetching profile:', error);
    response.status(500).json({ error: 'Failed to fetch profile', details: error.message });
  }
};