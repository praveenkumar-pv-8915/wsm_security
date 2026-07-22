FILE_PURPOSE: Read when deploying frontend web applications using Catalyst Slate — connecting Git repos, direct upload, auto-deploy, rollback, custom domains, or environment variables.
TRIGGER_KEYWORDS: Slate, Slate deployment, Slate app, Auto Deploy, direct upload zip, Slate rollback, Slate custom domain, Slate environment variables, frontend hosting, Slate starter template
SOURCE_DOC: help-docs/slate.md

TECHNICAL_CONSTRAINTS:
- Slate is the modern replacement for Web Client Hosting — supports multiple apps per project (Web Client Hosting = 1 app)
- Supported frameworks with native detection: Next.js, Angular, Astro, React, SolidJS, Preact, Svelte, Vue, Vite, Nuxt (others also work)
- Deployment methods:
  1. Git (GitHub, GitLab, Bitbucket): private repo, public repo, or starter template
  2. Direct Upload: zip file drag-and-drop to console
  3. CLI: `catalyst slate:deploy` (or similar commands)
- Auto Deploy: when Git-linked, any push to connected repo auto-triggers a new deployment
- Each deployment gets a unique access URL (not shared with other deployments)
- Rollback: can roll back to any previous deployment from console
- Sync latest commit: available from console for failed/stuck deployments
- Free SSL: included for all Slate apps automatically
- Custom domain mapping: supported (separate from Web Client Hosting domain mappings)
- Environment variables: managed securely per app in console
- Internally powered by Catalyst Pipelines (build-to-deploy handled automatically)
- Multiple apps per Catalyst project: supported (unlike Web Client Hosting)

REQUIRED_PARAMETERS:
- Git deployment: Git account integration required; connect GitHub/GitLab/Bitbucket to Catalyst account first
- Direct upload: zip file containing built frontend assets; select framework during upload
- CLI: Catalyst CLI installed and project initialized (`catalyst init`)
- Starter template: select from template library in console; code pushed to your connected Git repo and deployed

UI_ONLY_ACTIONS:
- Create Slate app (Git): Console → Slate → Create App → Connect Git Account → select repo → configure → Deploy
- Enable Auto Deploy: Console → Slate → open app → Settings → Auto Deploy toggle → enable
- Deploy via Direct Upload: Console → Slate → Create App → Direct Upload → drag zip → select framework → enter commit message → Deploy
- View deployments: Console → Slate → open app → Deployment History
- Rollback to previous deployment: Console → Slate → open app → Deployment History → select deployment → Rollback
- Configure environment variables: Console → Slate → open app → Environment Variables → add key-value pairs → Save
- Map custom domain: Console → Slate → open app → Custom Domains → add domain → follow CNAME instructions
- Note: CLI deployment: `catalyst slate:deploy` (verify exact command in CLI help)

CRITICAL_FAILURE_MODES:
- Auto Deploy on main/prod branch: any push (including WIP) triggers a live deploy — consider using a specific branch for production deploys
- Direct upload with wrong framework selected: build may succeed but app behaves incorrectly at runtime; framework selection affects build command and output directory detection
- Git integration not set up before creating Git-linked app: app creation fails; must connect Git account first at account level
- Environment variables not set before deploy: app runs without required secrets; redeploy after adding variables (variables are injected at build time for some frameworks)
- Rollback to older deployment with outdated env vars: if environment variables have changed, rolled-back deployment may use stale config; verify env vars after rollback
