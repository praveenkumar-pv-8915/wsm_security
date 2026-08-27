/**
 * Thin wrapper over the Catalyst Web SDK loaded by index.html.
 *
 * The SDK arrives as two plain <script> tags, so `window.catalyst` appears asynchronously and is
 * not importable. Everything here exists to make that global safe to use from React.
 *
 * Identity is never stored client-side. There is no token in localStorage and no user record cached
 * across reloads — the session cookie is the only credential, and the server re-derives the caller
 * from it on every request (functions/welcome/auth.js). A client-side "user" object is display
 * material only; it grants nothing.
 */

export const ALLOWED_DOMAIN = '@zohocorp.com';

/** Resolve once window.catalyst.auth is callable. Rejects if the SDK never lands. */
export function waitForCatalyst(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function tick() {
      if (window.catalyst && window.catalyst.auth) return resolve(window.catalyst);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Catalyst SDK failed to load. This app must be served from its Catalyst origin.'));
      }
      setTimeout(tick, 50);
    })();
  });
}

/**
 * Is there a live session? `isUserAuthenticated()` signals by resolving or rejecting rather than
 * returning a boolean, so it has to be wrapped.
 */
export async function isSignedIn(catalyst) {
  try {
    await catalyst.auth.isUserAuthenticated();
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the signed-in user. The web SDK exposes `userManagement` as a property (unlike the Node
 * SDK's `userManagement()` call) and the method name has moved between SDK versions, so try the
 * known shapes before giving up.
 */
export async function fetchCurrentUser(catalyst) {
  const um = catalyst.userManagement;
  if (um) {
    for (const name of ['getCurrentUser', 'getCurrentProjectUser', 'getUserDetails']) {
      if (typeof um[name] === 'function') {
        try {
          return await um[name]();
        } catch {
          /* try the next shape */
        }
      }
    }
  }
  if (catalyst.auth && typeof catalyst.auth.getCurrentUser === 'function') {
    try {
      return await catalyst.auth.getCurrentUser();
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** Catalyst returns user records either raw or wrapped as { content: {...} }. Flatten both. */
export function normaliseUser(record) {
  const u = record && record.content && record.content.email_id ? record.content : record || {};
  const email = String(u.email_id || u.email || '').toLowerCase().trim();
  const first = u.first_name || '';
  const last = u.last_name || '';
  const name = `${first} ${last}`.trim() || email.split('@')[0] || 'Member';
  const initials = ((first[0] || '') + (last[0] || '')).toUpperCase() || (email[0] || '?').toUpperCase();
  const roleName = String(u.role_details?.role_name || u.user_type || '').toLowerCase();
  return {
    email,
    name,
    initials,
    // Mirrors normaliseRole() in functions/welcome/auth.js: anything unrecognised is a member, so a
    // role we don't understand never lights up admin-only UI. The server decides for real.
    role: roleName.includes('admin') ? 'admin' : 'member',
  };
}

/**
 * The real sign-out. The old `<a href="/server/welcome/logout">` could not work: that route cleared
 * a `JSESSIONID` cookie Catalyst doesn't use, so the session survived and Catalyst bounced the
 * browser straight back into the app. Only the SDK can end a Catalyst session.
 */
export function signOut(redirectTo) {
  const target = redirectTo || `${window.location.origin}/app/`;
  if (window.catalyst && window.catalyst.auth && typeof window.catalyst.auth.signOut === 'function') {
    window.catalyst.auth.signOut(target);
    return;
  }
  window.location.assign(target);
}
