function getAuthToken(request) {
  const authHeader = request.headers?.authorization;
  if (!authHeader) return null;
  const [, token] = authHeader.split(' ');
  return token;
}

function getUserId(request) {
  return request.headers?.['x-user-id'] || null;
}

function validateAuth(request) {
  const token = getAuthToken(request);
  const userId = getUserId(request);

  if (!token || !userId) {
    return {
      valid: false,
      error: 'Missing authentication credentials'
    };
  }

  return {
    valid: true,
    token,
    userId
  };
}

module.exports = {
  getAuthToken,
  getUserId,
  validateAuth
};