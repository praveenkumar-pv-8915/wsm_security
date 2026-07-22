FILE_PURPOSE: Read when hosting a basic web application in Catalyst using the legacy Web Client Hosting component — uploading client files, managing versions, or rolling back.
TRIGGER_KEYWORDS: Web Client Hosting, client-package.json, catalystserverless.com, web app versioning, web client rollback, index.html, client directory, web client zip
SOURCE_DOC: help-docs/web-client-hosting.md

TECHNICAL_CONSTRAINTS:
- Max 1 web application per Catalyst project (use Slate for multiple apps or modern JS framework support)
- Host in Development environment only; must deploy project to Production to make it live
- Required files in client/ directory: `index.html` (homepage) + `client-package.json` (config)
- `catalyst.json`: NOT required when uploading from console; only needed for CLI deploy or GitHub deploy
- `client-package.json`: must contain app name (set once — do NOT change after first hosting), version, homepage, description
- App name in client-package.json = final app name; renaming after first hosting causes errors
- Version: decimal format (e.g., 1.0.0); must increment for each update; cannot decrement; must change before deploying to production
- Upload format: zip file containing the client/ directory contents
- Default URLs:
  - Dev: `https://{project-domain}.development.catalystserverless.com`
  - Production: `https://{project-domain}.catalystserverless.com`
- SSL: included by default for all hosted apps
- Rollback: available from console to any previous version
- Custom domain: supported via Domain Mappings (see docs/domain-mappings.md)
- Recommended: use Slate instead for Next.js, React, Angular, Vue, and other modern frameworks

REQUIRED_PARAMETERS:
- `client-package.json` required fields:
  ```json
  {
    "name": "app-name",
    "version": "1.0.0",
    "description": "App description",
    "homepage": "index.html"
  }
  ```
- Upload: zip file containing index.html + client-package.json + all front-end assets

UI_ONLY_ACTIONS:
- Host web app: Console → Cloud Scale → Host & Manage → Web Client Hosting → Upload → select zip → Upload
- Update web app (new version): Console → Web Client Hosting → Upload New Version → select updated zip → Upload
- Roll back: Console → Web Client Hosting → App Version History → select older version → Rollback
- View app URL: Console → Web Client Hosting → copy URL from overview
- Deploy to production: `catalyst deploy` from CLI or Console → Deploy to Production
- Note: initial hosting and versioning management done from console; deploy to production via CLI or console deploy action

CRITICAL_FAILURE_MODES:
- Missing client-package.json in zip: hosting fails with config error
- Missing index.html (or homepage mismatch in client-package.json): app hosted but homepage returns 404
- Changing app name in client-package.json after first hosting: causes errors; app name must stay constant
- Decreasing version number: hosting upload is rejected; version can only increment
- Same version number in production deploy after code changes: Catalyst may not process update; always increment version before deploying changes to production
- Expecting live app in dev environment: dev URL works but is a sandbox — must deploy to production for end-user access
- Hosting complex framework (React/Angular/Next.js) via Web Client Hosting: works for compiled static builds only; use Slate for framework-native builds and auto-detection
