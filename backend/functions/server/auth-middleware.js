/**
 * Authentication Middleware
 * Validates OAuth tokens and protects routes
 */

const { decryptToken } = require('./crypto');

/**
 * Middleware to validate Bearer token in Authorization header
 * Attaches user info to request if valid
 */
function validateToken(req, res, next) {
  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header',
    });
  }

  const encryptedToken = authHeader.substring(7); // Remove 'Bearer ' prefix

  // Decrypt and validate token
  const token = decryptToken(encryptedToken);
  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }

  // TODO: Verify token is still valid with Zoho (check expiry from DB)
  // For now, if decryption succeeds, token is valid

  req.token = token;
  next();
}

/**
 * Optional middleware - validates if present, but allows public access if not
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const encryptedToken = authHeader.substring(7);
    const token = decryptToken(encryptedToken);

    if (token) {
      req.token = token;
      req.user = { authenticated: true };
    }
  }

  next();
}

module.exports = {
  validateToken,
  optionalAuth,
};