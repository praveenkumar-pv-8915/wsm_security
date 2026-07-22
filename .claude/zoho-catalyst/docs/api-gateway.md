FILE_PURPOSE: Read when configuring API Gateway routing, authentication, throttling, or migrating from Security Rules to API Gateway.
TRIGGER_KEYWORDS: API Gateway, ZCFKEY, catalystserverless, Security Rules migration, throttling, Login Redirect API, auto-create API, ANY method
SOURCE_DOC: help-docs/api-gateway.md

TECHNICAL_CONSTRAINTS:
- Hard limit: 1000 APIs/project in dev env; no upper limit in production
- Enabling API Gateway IMMEDIATELY disables Security Rules and makes ALL function/web client URLs inaccessible until APIs are created — do not enable without first planning all API definitions
- Auto-create is only available on first enable, before any custom API exists; once a single custom API is created, auto-create is locked out
- Web client APIs: GET method only, no auth available, ANY method not supported
- Cron and Event Functions: not routable through API Gateway (cannot be directly invoked by end users)
- Authentication not available for web client APIs
- Throttling uses sliding window algorithm (not fixed window)
- Exceeding throttle limit returns HTTP 429 Too Many Requests
- Login Redirect API: auto-created, cannot be deleted, target URL cannot be edited

REQUIRED_PARAMETERS:
- API Key auth header: `ZCFKEY: <api_key>` OR query string `?ZCFKEY=<api_key>`
- OAuth auth header: `Authorization: Zoho-oauthtoken <token>`
- Request URL structure: `https://{project_domain_name}.catalystserverless.com/{request_path}`
- Target URL formats by type:
  - Basic I/O: `/baas/v1/project/{project_ID}/function/{function_ID}/execute`
  - Advanced I/O: `/server/{function_name}/`
  - Web Client: `/app/`
- Regex in URLs: `{key:[pattern]}` in request URL, `{key}` in target URL
- Wildcard pattern: `{path:(.*)}` accepts any value

UI_ONLY_ACTIONS:
- Enable API Gateway: Console → Cloud Scale → API Gateway → Enable Now → Proceed
- Disable API Gateway: Console → API Gateway → ellipsis → Disable → type "DISABLE" → Confirm
- Auto-create APIs (first-time only): Console → API Gateway → Create API → Auto-create API → select targets → Create
- Create custom API: Console → API Gateway → Create API → set method, request URL, target, auth, throttling → Create
- Edit API: Console → API Gateway → click Edit on API row → modify → Update
- Delete API: Console → API Gateway → click Delete on API row → Yes, Proceed
- View API Key: Console → API Gateway → open API details → View API Key
- Note: CLI can enable/disable API Gateway and check status; API definitions JSON can be pulled locally and deployed via CLI

CRITICAL_FAILURE_MODES:
- Enabling API Gateway without pre-creating APIs = immediate production outage; all URLs return 404/inaccessible
- API Key is environment-scoped: one shared key in dev, individual keys per project in prod — do not hardcode dev key
- Disabling API Gateway re-enables Security Rules immediately; any Security Rules config (even stale) becomes active
- Login Redirect API `login_redirect` path: if value starts with `/` it's absolute (appended to domain root); without `/` it's appended to `/app/`
- request URL + request method combination must be unique per project; duplicate combinations fail silently at create time
- auto-create migrates Security Rules auth: "optional" → No Authentication; "enabled" → Catalyst Users + OAuth (NOT API Key)
- Throttling general vs IP-based: both can coexist; IP-based limits per source address, general limits all traffic combined
