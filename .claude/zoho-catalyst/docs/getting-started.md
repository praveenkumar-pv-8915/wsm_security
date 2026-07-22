FILE_PURPOSE: Read when setting up a new Catalyst project from scratch — CLI installation, project initialization, prerequisites, or understanding the dev/production environment structure.
TRIGGER_KEYWORDS: getting started, catalyst init, zcatalyst-cli, CLI install, first project, project setup, catalyst login, environment setup, npm install -g zcatalyst-cli
SOURCE_DOC: help-docs/getting-started.md

TECHNICAL_CONSTRAINTS:
- CLI install: `npm install -g zcatalyst-cli` (requires Node.js/NPM)
- First project: MUST be created from the Catalyst console — CLI cannot create the very first project
- Subsequent projects: can be created via `catalyst project:create` from CLI
- `catalyst init`: initializes a local project directory linked to an existing console project; run inside an empty directory
- Prerequisites by language:
  - All: Node.js + NPM (required for CLI itself)
  - Java functions: Java JDK installed locally
  - Python functions: Python 3.9 installed locally
- Environments: every project has Dev and Production; dev is sandbox (limits apply), production has higher/no limits
- Local development directory structure after `catalyst init`:
  - `functions/` — function code
  - `public/` — web client static assets
  - `catalyst-config.json` — project config (project ID, org ID)
- `catalyst deploy`: deploys all components; use `--only functions`, `--only client` etc. for partial deploys
- Authentication: `catalyst login` opens browser OAuth flow; tokens stored locally

REQUIRED_PARAMETERS:
- CLI install: `npm install -g zcatalyst-cli`
- Login: `catalyst login`
- Init existing project: `catalyst init` (prompts for project selection)
- Deploy: `catalyst deploy` or `catalyst deploy --only functions`
- Check CLI version: `catalyst --version`

UI_ONLY_ACTIONS:
- Create first project: Console → catalyst.zoho.com → New Project → enter name + data center → Create
- Switch between dev/production: Console → environment toggle (top of console, labeled Dev / Production)
- View project ID: Console → General Settings → Project Details → Project ID
- Note: All subsequent projects can be created via `catalyst project:create` CLI command

CRITICAL_FAILURE_MODES:
- Running `catalyst init` before creating project in console: init fails — project must exist in console first for the very first project
- Missing JDK for Java functions: `catalyst deploy` for Java functions fails at compile step with JDK not found error
- Python version mismatch: local Python version doesn't need to match exactly but 3.9 is the only supported runtime — code using other versions may work locally but fail in deployed environment
- `catalyst login` in headless environment: browser OAuth flow won't open; use `catalyst login --headless` or configure token manually
- Wrong directory for `catalyst init`: if run in a directory that already has a `catalyst-config.json`, init may overwrite project linkage — verify directory before running
- Deploying from wrong environment context: `catalyst deploy` targets whichever environment is active in CLI context; check with `catalyst env:list` before deploying to production
