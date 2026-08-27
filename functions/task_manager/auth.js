/**
 * Identity for the task_manager function.
 *
 * Auth model — Catalyst DEFAULT HOSTED AUTHENTICATION:
 *   1. Catalyst Authentication (Hosted Login) signs the user in on Catalyst's own login pages and
 *      establishes the session. This function never sees a password and never issues a token.
 *   2. `catalyst.initialize(req)` picks that identity up off the request, and
 *      `userManagement().getCurrentUser()` resolves it server-side — the only trusted identity.
 *      Nothing is ever read from the request body, query string or a custom header.
 *   3. This module re-checks one thing on every request: the session's email ends in
 *      ALLOWED_DOMAIN. The email is used for that single comparison and then discarded.
 *
 * NO MEMBERS TABLE. Deliberate — see the 2026-08-27 decision in CLAUDE.md and the project KB
 * (`claude/datastore-conventions.md`). Ownership and role both come straight off the Catalyst
 * session, not an app-owned allowlist:
 *   - Ownership: ALWAYS `user_id` (never email). `tasks.ASSIGNEE_ID` / `REPORTER_ID` and
 *     `task_activity.ACTOR_ID` all store this. A user_id is not itself PII, and it's a plain
 *     foreign-key-style column on the row that needs it — no separate table required.
 *   - Role: read from the session's `role_details.role_name` (Catalyst's own App Administrator /
 *     App User split). See normaliseRole().
 *
 * Display names (e.g. for the assignee dropdown) come from Catalyst's Get All Users API, not from
 * a table this middleware maintains — see task-service.js#listMembers.
 *
 * Fails CLOSED: any error denies the request rather than admitting an unverified caller.
 *
 * IMPORTANT — Catalyst Security Rules default the `authentication` parameter to "optional" for every
 * new function, which would leave these routes callable anonymously (with getCurrentUser() returning
 * null). Set it to "required" for task_manager in the console:
 *   Serverless -> FAAS -> task_manager -> Security Rules
 */

const ALLOWED_DOMAIN = '@zohocorp.com';

/**
 * Map Catalyst's own role vocabulary onto 'admin' | 'member'. Unrecognised/missing → 'member', so
 * a role we don't understand yet never silently grants admin.
 */
function normaliseRole(user) {
  const roleName = String(user?.role_details?.role_name || user?.user_type || '').toLowerCase();
  return roleName.includes('admin') ? 'admin' : 'member';
}

/**
 * Express middleware. On success sets `req.catalystApp` and
 * `req.caller = { userId, name, role }` — NOTE: no `email`. Nothing downstream should need it; if a
 * route thinks it does, that's a sign PII is about to leak into a response or a stored row.
 *
 *   401 — no Catalyst session
 *   403 — signed in but outside the allowed domain
 */
function requireMember(catalyst) {
  return async (req, res, next) => {
    try {
      const app = catalyst.initialize(req);
      req.catalystApp = app;

      let user = null;
      try {
        user = await app.userManagement().getCurrentUser();
      } catch (e) {
        console.log('getCurrentUser failed:', e.message);
      }
      if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Used for this one comparison only — never stored, never logged, never returned.
      const email = String(user.email_id || '').toLowerCase().trim();
      if (!email.endsWith(ALLOWED_DOMAIN)) {
        return res.status(403).json({ error: `Access restricted to ${ALLOWED_DOMAIN} accounts` });
      }

      const first = user.first_name || '';
      const last = user.last_name || '';
      const userId = String(user.user_id || user.email_id);
      req.userId = userId;
      req.caller = {
        userId,
        name: `${first} ${last}`.trim() || 'Member',
        role: normaliseRole(user),
      };
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
    caller.userId === String(task.ASSIGNEE_ID || '') ||
    caller.userId === String(task.REPORTER_ID || '')
  );
}

module.exports = { ALLOWED_DOMAIN, requireMember, canModify };
