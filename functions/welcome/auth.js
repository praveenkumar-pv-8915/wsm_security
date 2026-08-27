/**
 * Authentication gate for the `welcome` function.
 *
 * Catalyst default HOSTED AUTHENTICATION: Catalyst's own login pages establish the session; this
 * function only verifies it. `getCurrentUser()` is the single trusted source of identity — nothing
 * is ever read from the body, query string or a custom header.
 *
 * NO MEMBERS TABLE. Deliberate — see the 2026-08-27 decision recorded in CLAUDE.md and the project
 * KB (`claude/datastore-conventions.md`). Two checks, both against the live Catalyst session, no
 * DataStore lookup and no PII stored:
 *   1. A Catalyst session exists.
 *   2. The email on that session ends in ALLOWED_DOMAIN. The email itself is used for this one
 *      comparison and then discarded — it is never written to a table or logged.
 *
 * Ownership: ALWAYS `user_id` (String(user.user_id || user.email_id), unchanged from the original
 * middleware). `credentials.owner_id` and every other owner_id/*_ID column store this, never email.
 * A user_id is not itself PII, and it's what `owner_id` on `credentials` already keys off, so
 * ownership needs no separate table — see the "ownership vs allowlist" note below.
 *
 * Role: read straight from the session's `role_details.role_name` (Catalyst's own App Administrator
 * / App User split), not from an app-owned table. `normaliseRole()` maps the platform's role names
 * to the 'admin' | 'member' vocabulary the rest of the app already uses.
 *
 * If the team later wants a curated allowlist (only specific @zohocorp.com people, not "anyone with
 * a Zoho corp account"), that's a Custom User Validation Basic I/O function checked at signup, or
 * managing users directly in Catalyst's own User Management console — not a table this function
 * reads on every request.
 *
 * Response shape depends on what asked:
 *   • a browser navigation (Accept: text/html) is REDIRECTED to the hosted login page
 *   • anything else (fetch/XHR) gets JSON 401/403, so the SPA can handle it rather than being
 *     handed a login page where it expected data
 *
 * Fails CLOSED — any error denies rather than admitting an unverified caller.
 *
 * NOTE: Catalyst Security Rules default `authentication` to "optional" on every function, which
 * leaves routes anonymously callable with getCurrentUser() returning null. Set it to "required"
 * for `welcome` in the console (Serverless → FAAS → welcome → Security Rules).
 */

const ALLOWED_DOMAIN = '@zohocorp.com';
const LOGIN_PATH = '/__catalyst/auth/login';

/** Paths served without a session. Keep this list as short as possible. */
const PUBLIC_PATHS = new Set(['/health', '/api/health']);

/** True when this looks like a browser address-bar navigation rather than a fetch/XHR. */
function wantsHtml(req) {
  const accept = String(req.get('accept') || '');
  return accept.includes('text/html') && !accept.includes('application/json');
}

/**
 * Map Catalyst's own role vocabulary onto 'admin' | 'member'. Unrecognised/missing → 'member', so
 * a role we don't understand yet never silently grants admin.
 */
function normaliseRole(user) {
  const roleName = String(user?.role_details?.role_name || user?.user_type || '').toLowerCase();
  return roleName.includes('admin') ? 'admin' : 'member';
}

/**
 * Express middleware factory.
 *
 * On success sets:
 *   req.userId        — String(user.user_id || user.email_id). The ownership key for every
 *                       owner_id / *_ID column in this app. Unchanged from the original middleware.
 *   req.catalystApp   — user-scoped SDK instance
 *   req.catalystAdmin — admin-scoped instance for DataStore/ZCQL (app users lack table privileges);
 *                       authorization stays in application code, per-row.
 *   req.caller        — { userId, name, role } — NOTE: no `email`. Nothing downstream should need
 *                       it; if a route thinks it does, that's a sign PII is about to leak into a
 *                       response or a stored row.
 */
function requireMember(catalyst) {
  return async (req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) return next();

    const deny = (status, message) => {
      if (status === 401 && wantsHtml(req)) {
        const back = encodeURIComponent(req.originalUrl || '/');
        return res.redirect(`${LOGIN_PATH}?redirect_url=${back}`);
      }
      return res.status(status).json({ success: false, error: message });
    };

    try {
      const app = catalyst.initialize(req);

      let user = null;
      try {
        user = await app.userManagement().getCurrentUser();
      } catch (e) {
        console.log('getCurrentUser failed:', e.message);
      }
      if (!user) {
        return deny(401, 'Not authenticated. Please sign in.');
      }

      // Used for this one comparison only — never stored, never logged, never returned.
      const email = String(user.email_id || '').toLowerCase().trim();
      if (!email.endsWith(ALLOWED_DOMAIN)) {
        return deny(403, `Access restricted to ${ALLOWED_DOMAIN} accounts`);
      }

      const first = user.first_name || '';
      const last = user.last_name || '';
      req.userId = String(user.user_id || user.email_id);
      req.catalystApp = app;
      req.catalystAdmin = catalyst.initialize(req, { scope: 'admin' });
      req.caller = {
        userId: req.userId,
        name: `${first} ${last}`.trim() || 'Member',
        role: normaliseRole(user),
      };
      return next();
    } catch (error) {
      console.error('auth middleware error — denying:', error);
      return deny(403, 'Authorisation check failed');
    }
  };
}

/** Guard for admin-only routes. Use after requireMember. */
function requireAdmin(req, res, next) {
  if (req.caller?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin role required' });
  }
  return next();
}

module.exports = { ALLOWED_DOMAIN, LOGIN_PATH, requireMember, requireAdmin };
