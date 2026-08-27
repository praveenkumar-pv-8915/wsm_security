/**
 * The one way the SPA talks to the `welcome` function.
 *
 * Same-origin: the React app is served by Catalyst web client hosting at /app/ and the function is
 * mounted at /server/welcome/ on the same host, so the Catalyst session cookie rides along on its
 * own. No bearer token, no localStorage — see lib/catalyst.js for why.
 *
 * `Accept: application/json` is deliberate. The auth gate in functions/welcome/auth.js redirects
 * browser navigations (Accept: text/html) to the hosted login page and returns JSON 401/403 to
 * everything else. Being explicit keeps us on the JSON branch, so a dropped session surfaces as an
 * AuthError we can act on rather than as a login page parsed as data.
 */

const API_BASE = '/server/welcome/api';

/** Raised when the session is gone or the caller isn't allowed. Carries the HTTP status. */
export class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** Any other failure — a 4xx/5xx, or a `{ success: false }` body from a service function. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Broadcast so AuthGate can drop straight back to the sign-in screen from anywhere in the tree,
 * without every view having to thread an onAuthLost callback down to its fetch calls.
 */
export const AUTH_LOST_EVENT = 'wsm:auth-lost';

export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Network error — the function is unreachable.', 0);
  }

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (response.status === 401 || response.status === 403) {
    const message = (json && json.error) || 'Your session has ended. Please sign in again.';
    if (response.status === 401) window.dispatchEvent(new CustomEvent(AUTH_LOST_EVENT));
    throw new AuthError(message, response.status);
  }

  // A non-JSON body here means the gate handed back HTML (a login page) where data was expected.
  if (json === null) {
    throw new ApiError(`Unexpected response (${response.status}) — are you signed in?`, response.status);
  }

  if (!response.ok || json.success === false) {
    throw new ApiError(json.error || `Request failed (${response.status})`, response.status);
  }

  return json;
}
