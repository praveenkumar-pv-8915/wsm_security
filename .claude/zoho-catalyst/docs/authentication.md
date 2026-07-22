FILE_PURPOSE: Read when implementing Catalyst user authentication, managing app users, configuring sign-in methods, or setting up CORS/authorized domains. For Zoho OAuth via Custom Function, read references/oauth.md instead.
TRIGGER_KEYWORDS: Catalyst Authentication, Native Auth, Hosted Authentication, Embedded Authentication, generateAuthToken, Custom User Validation, Public Signup, Catalyst users, user roles, CORS authorized domains
SOURCE_DOC: help-docs/authentication.md

TECHNICAL_CONSTRAINTS:
- Three auth types: Hosted, Embedded, Third-party — one instance of each per application allowed
- Must enable at least one auth type before adding users
- Public Signup: DISABLED by default; disabling it for one type disables it for ALL types simultaneously
- Custom User Validation requires Public Signup to be enabled
- Third-party Authentication setup requires Public Signup enabled
- Social logins (Google, Zoho) require Public Signup enabled
- generateAuthToken() access token lifetime: 1 hour (hard limit, non-configurable)
- Catalyst-to-Catalyst auth (frontend → backend): frontend and backend must be hosted in the SAME Catalyst project
- CORS must be configured for cross-domain invocations from authorized external domains
- Email template placeholders: %EMAIL%, %APP_NAME%, %LINK% (only these three)
- User roles can define Data Store and File Store access permissions

REQUIRED_PARAMETERS:
- generateAuthToken() returns: `{ access_token: "<token>" }`
- Token usage: set as `Authorization` header value when calling backend endpoint
- Backend SDK init: pass request object to initialize in authenticated context (SDK handles scope validation automatically)
- login_redirect in client-package.json:
  - Starts with `/`: absolute path → appended to domain root
  - No leading `/`: relative path → appended to `/app/`

UI_ONLY_ACTIONS:
- Configure auth type (Hosted/Embedded/Third-party): Console → Cloud Scale → Authentication → Sign-in Method → Add Authentication → Configure
- Enable/disable Public Signup: Console → Authentication → Sign-in Method → toggle Public Signup → confirm
- Add app user manually: Console → Authentication → Users → Add User → enter email → send invite
- Reset user password: Console → Authentication → Users → find user → Reset Password
- Enable/disable a user account: Console → Authentication → Users → find user → Enable/Disable
- Configure Social Login (Google/Zoho): Console → Authentication → Sign-in Method → Social Logins → configure provider credentials
- Set up CORS / authorized domains: Console → Authentication → Authorized Domains → Add Domain → configure CORS and iFrame settings
- Create/manage user roles: Console → Authentication → Roles → Create Role → assign Data Store/File Store permissions
- Customize email templates: Console → Authentication → Email Templates → select template → edit subject/body/sender → Save
- Note: Users can also be managed via Authentication API and SDK (add, remove, fetch user details)

CRITICAL_FAILURE_MODES:
- generateAuthToken() token expires in 1 hour — do not cache long-term; call per-session or check expiry before reuse
- Disabling Public Signup removes signup UI from ALL auth types and disables all Social Logins simultaneously — not reversible per-type
- Frontend and backend in different Catalyst projects: generateAuthToken() will not work for cross-project auth; use Zoho OAuth instead (see references/oauth.md)
- Custom User Validation silently does nothing if Public Signup is disabled — no error thrown, users simply cannot sign up
- CORS not configured for a domain: external domain calls to function endpoints return CORS errors, not auth errors — misleading failure mode
- For full Zoho OAuth flow (not Catalyst Native Auth), see references/oauth.md — covers token exchange, capitalized field names, cookie configuration, DC-specific endpoints
