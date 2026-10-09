/**
 * Catalyst session helpers — hosted auth.
 *
 * The app used to mount Catalyst's embedded sign-in widget (`catalyst.auth.signIn('div', ...)`),
 * which injects an iframe. That rendered an empty white box: this project has Embedded auth off
 * and the iframe was requested with `css_url=embedded_signin_providers_only.css`, which hides the
 * email/password form and shows only federated provider buttons — with none enabled, nothing at
 * all. Hosted auth is a redirect flow instead: the browser goes to Catalyst's own login page and
 * comes back.
 *
 * The URLs below are not guesses. They are the exact ones catalystWebSDK.js 4.5.0 builds
 * internally (read out of the SDK bundle in the HAR), with the project's own ids from
 * `/__catalyst/sdk/init.js`:
 *
 *   BaseURL        = `/baas` + `/v1` + `/project/` + project_Id      (DOMAIN_URL + URL_VERSION)
 *   current user   = `${BaseURL}/project-user/current`               (Auth.getProjectUserDetails)
 *   hosted sign-in = `/__catalyst/${project_Id}/auth/signin-redirect?PROJECT_ID=${zaid}`  (Auth.signIn)
 *   sign-out       = `/accounts/p/${zaid}/logout?servicename=ZohoCatalyst&serviceurl=…`   (constructSignOutUrl)
 *
 * An earlier pass here invented `/__catalyst/auth/current-user`, which 404s — no such route exists.
 *
 * Identity is never stored client-side. There is no token in localStorage and no user record cached
 * across reloads — the session cookie is the only credential, and the server re-derives the caller
 * from it on every request (functions/welcome/auth.js). A client-side "user" object is display
 * material only; it grants nothing.
 */

export const ALLOWED_DOMAIN = '@zohocorp.com';

/** Where the SPA lives. Catalyst serves the web client under /app/. */
export const APP_PATH = '/app/';

/**
 * Project identity, mirroring `catalyst.initApp()` in the Catalyst-generated
 * `/__catalyst/sdk/init.js`. Both values are public — Catalyst serves them to every browser that
 * loads the app — and neither is a credential.
 */
const PROJECT_ID = '47976000000083005';
const ZAID = '50044307528';

/** Catalyst's REST base for this project, as the Web SDK composes it. */
const BASE_URL = `/baas/v1/project/${PROJECT_ID}`;

/** Result codes from readCurrentUser(). */
export const SESSION = {
  OK: 'ok',
  ANONYMOUS: 'anonymous',           // no session — send the user to hosted login
  NOT_AUTHORIZED: 'not-authorized', // signed in to Zoho, but not a user of this Catalyst project
  ERROR: 'error',                   // endpoint unreachable or an unparseable response
};

/** Absolute URL for a path on this origin — Catalyst's redirect params want absolute URLs. */
function absolute(path) {
  return new URL(path || APP_PATH, window.location.origin).toString();
}

/**
 * Send the browser to Catalyst's hosted login.
 *
 * Two URLs, in a specific order — this is the part that is easy to get wrong:
 *
 *   `/__catalyst/{project}/auth/signin-redirect` is where IAM comes BACK to after a successful
 *   login; it mints the Catalyst session and then forwards to its own `service_url`. Going there
 *   first with no session just bounces straight back to the app, which is exactly what happened.
 *   The SDK only navigates there directly in `signIn()`'s *already-signed-in* branch.
 *
 *   `/accounts/p/{zaid}/signin` is the actual hosted login page. Its `serviceurl` must be the
 *   signin-redirect URL above, which in turn carries `service_url` = where the user lands at the
 *   end. That nesting is `constructIAMIframeUrl` in the SDK, minus `css_url` — the embedded
 *   stylesheet is what hid the form and produced the original white box, and a full-page login
 *   wants Catalyst's own chrome anyway.
 */
export function startHostedSignIn(returnTo) {
  const landing = absolute(returnTo || `${window.location.pathname}${window.location.search}`);

  // Matches the SDK: the inner service_url is appended raw, then the whole redirect URL is encoded
  // once as `serviceurl`.
  const signinRedirect =
    `${window.location.origin}/__catalyst/${PROJECT_ID}/auth/signin-redirect` +
    `?PROJECT_ID=${ZAID}&service_url=${landing}`;

  window.location.assign(
    `/accounts/p/${ZAID}/signin?portal=${ZAID}&servicename=ZohoCatalyst` +
      `&serviceurl=${encodeURIComponent(signinRedirect)}&hide_signup=true&dcc=true`,
  );
}

/**
 * Read the signed-in user from Catalyst.
 *
 * 200 -> the user record. 401 -> no session (the expected pre-login state; the first HAR's 401 on
 * `project-user/current` was exactly this). 403 -> a valid Zoho session whose account was never
 * added to this project in Console -> Users.
 *
 * Returns `{ status, record }` rather than throwing, so the gate can tell "not signed in" apart
 * from "signed in but not allowed" and from "the check itself broke" — a failed read must never
 * fall through to a rendered app.
 */
export async function readCurrentUser() {
  let response;
  try {
    response = await fetch(`${BASE_URL}/project-user/current`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    return { status: SESSION.ERROR, record: null, error: 'Could not reach Catalyst to check your session.' };
  }

  if (response.status === 401) return { status: SESSION.ANONYMOUS, record: null };
  if (response.status === 403) return { status: SESSION.NOT_AUTHORIZED, record: null };

  if (!response.ok) {
    return { status: SESSION.ERROR, record: null, error: `Catalyst returned ${response.status} for the session check.` };
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    return { status: SESSION.ERROR, record: null, error: 'Catalyst returned a non-JSON session response.' };
  }

  const record = unwrap(json);
  if (!record || !(record.email_id || record.email)) {
    return { status: SESSION.ERROR, record: null, error: 'Catalyst would not return your user record.' };
  }
  return { status: SESSION.OK, record };
}

/** Catalyst wraps records as { data: {...} }, { content: {...} } or { user_details: {...} }. */
function unwrap(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.data && typeof json.data === 'object') return unwrap(json.data);
  if (json.content && typeof json.content === 'object') return unwrap(json.content);
  if (json.user_details && typeof json.user_details === 'object') return unwrap(json.user_details);
  return json;
}

/** Flatten a Catalyst user record into the display shape the UI uses. */
export function normaliseUser(record) {
  const u = unwrap(record) || {};
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
 * End the Catalyst session.
 *
 * IAM owns the session, so signing out is a redirect to the accounts logout route — not the old
 * `<a href="/server/welcome/logout">`, which cleared a `JSESSIONID` cookie Catalyst doesn't use and
 * left the session alive. The SDK also clears the `CAUTH` cookie on its way out; that cookie is
 * scoped to /accounts, which the logout page itself handles.
 */
export function signOut(redirectTo) {
  const serviceUrl = absolute(redirectTo || APP_PATH);
  window.location.assign(
    `/accounts/p/${ZAID}/logout?servicename=ZohoCatalyst&serviceurl=${encodeURIComponent(serviceUrl)}`,
  );
}
