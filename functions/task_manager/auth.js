/**
 * Identity + membership for the task_manager function.
 *
 * Auth model — Catalyst DEFAULT HOSTED AUTHENTICATION:
 *   1. Catalyst Authentication (Hosted Login) signs the user in on Catalyst's own login pages and
 *      establishes the session. This function never sees a password and never issues a token.
 *   2. `catalyst.initialize(req)` picks that identity up off the request, and
 *      `userManagement().getCurrentUser()` resolves it server-side. The email it returns is the ONLY
 *      trusted identity — never read an identity out of the request body, query or a custom header.
 *   3. This module then re-checks two things on every request: the email is on ALLOWED_DOMAIN, and
 *      the email exists in the `members` table with STATUS = 'active'.
 *
 * Fails CLOSED: any lookup error denies the request rather than admitting an unverified caller.
 *
 * IMPORTANT — Catalyst Security Rules default the `authentication` parameter to "optional" for every
 * new function, which would leave these routes callable anonymously (with getCurrentUser() returning
 * null). Set it to "required" for task_manager in the console:
 *   Serverless -> FAAS -> task_manager -> Security Rules
 */

const { esc, selectOne } = require('./db');

const ALLOWED_DOMAIN = '@zohocorp.com';

/**
 * Resolve the caller from the Catalyst session.
 * @returns {Promise<{email: string, name: string, role: string}|null>} null when not authenticated.
 */
async function resolveCaller(app) {
  let user = null;
  try {
    user = await app.userManagement().getCurrentUser();
  } catch (e) {
    console.log('getCurrentUser failed:', e.message);
    return null;
  }
  if (!user) return null;

  const email = String(user.email_id || '').toLowerCase().trim();
  if (!email) return null;

  const first = user.first_name || '';
  const last = user.last_name || '';
  return {
    email,
    name: `${first} ${last}`.trim() || email.split('@')[0],
    role: 'member', // provisional — the members lookup is authoritative
  };
}

/** Look the caller up in the `members` allowlist. Returns null when absent or disabled. */
async function lookupMember(app, email) {
  const row = await selectOne(
    app,
    "SELECT members.ROWID, members.NAME, members.ROLE, members.STATUS FROM members " +
      `WHERE members.EMAIL = '${esc(email)}'`
  );
  if (!row) return null;
  if (String(row.STATUS || '').toLowerCase() !== 'active') return null;
  return { name: row.NAME || null, role: String(row.ROLE || 'member').toLowerCase() };
}

/**
 * Express middleware. On success sets `req.catalystApp` and `req.caller = {email, name, role}`.
 *   401 — no Catalyst session
 *   403 — signed in but outside the allowed domain, or not an active member
 */
function requireMember(catalyst) {
  return async (req, res, next) => {
    try {
      const app = catalyst.initialize(req);
      req.catalystApp = app;

      const caller = await resolveCaller(app);
      if (!caller) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      if (!caller.email.endsWith(ALLOWED_DOMAIN)) {
        return res.status(403).json({ error: `Access restricted to ${ALLOWED_DOMAIN} accounts` });
      }

      const member = await lookupMember(app, caller.email);
      if (!member) {
        return res.status(403).json({ error: 'Your account is not on the access list for this app' });
      }

      req.caller = { email: caller.email, name: member.name || caller.name, role: member.role };
      return next();
    } catch (e) {
      // Fail closed.
      console.error('auth middleware error — denying:', e);
      return res.status(403).json({ error: 'Authorisation check failed' });
    }
  };
}

/** True when the caller may modify this task: assignee, reporter, or an admin. */
function canModify(caller, task) {
  if (!caller) return false;
  if (caller.role === 'admin') return true;
  return (
    caller.email === String(task.ASSIGNEE_EMAIL || '').toLowerCase() ||
    caller.email === String(task.REPORTER_EMAIL || '').toLowerCase()
  );
}

module.exports = { ALLOWED_DOMAIN, requireMember, lookupMember, canModify };
