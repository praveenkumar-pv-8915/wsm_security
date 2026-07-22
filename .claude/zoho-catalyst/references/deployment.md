# Catalyst Deployment & Platform Reference

> Covers CLI setup, deploy process, platform services, pricing, deprecations, Slate evaluation, and promoting to production.
> For deployment gotchas (env var wipe, missing package.json, etc.), see SKILL.md.

---

## Table of Contents

- [CLI Setup](#cli-setup)
- [Project Structure](#project-structure)
- [Deploy Process](#deploy-process)
- [Deploy Checklist](#deploy-checklist)
- [Promoting to Production](#promoting-to-production)
- [Platform Services](#platform-services)
- [Pricing](#pricing)
- [Deprecation Warnings](#deprecation-warnings)
- [Slate Frontend Hosting](#slate-frontend-hosting)

---

## CLI Setup

```bash
# Install CLI globally
npm install -g zcatalyst-cli

# Login (opens browser for Zoho SSO)
catalyst login

# Initialize project (in project root)
catalyst init
```

When prompted:
- Select your existing Catalyst project
- Choose features: **Client** (for static apps) or **Functions** + **Client**
- Choose client type: **BASIC**
- Name the client (e.g., "app")

### Files created by `catalyst init`

| File | Git? | Notes |
|------|------|-------|
| `catalyst.json` | Yes | Project config |
| `.catalystrc` | **No** (.gitignore) | Contains project/env IDs and auth context |
| `app/client-package.json` | Yes | Client metadata |

### `.catalystrc` structure (for manual creation)

```json
{
  "defaults": { "project": 1, "env": 1 },
  "actives": { "project": 1, "env": 1 },
  "projects": [{
    "idx": 1,
    "id": "<project-id>",
    "name": "<project-name>",
    "domain": {
      "id": "<domain-id>",
      "name": "<project-name>-<env-id>.development"
    },
    "timezone": "America/Chicago",
    "env": [{
      "idx": 1,
      "id": "<env-id>",
      "name": "Development",
      "type": 3
    }]
  }]
}
```

Get the project ID from Catalyst Console. The env ID (`60047883702`) is shared across all projects in your Zoho org.

---

## Project Structure

```
project-root/
  catalyst.json               # Must include both "functions" and "client"
  .catalystrc                  # Auth tokens (GITIGNORED)
  app/
    index.html
    client-package.json        # Client metadata
  functions/
    my-function/
      index.js                 # Handler code
      catalyst-config.json     # Deploy config + env vars (GITIGNORED)
      catalyst-config.example.json  # Template (in git)
      package.json             # Required even with zero deps
```

### catalyst.json

```json
{
  "functions": {
    "targets": ["my-function"],
    "source": "functions"
  },
  "client": {
    "source": "app"
  }
}
```

**Critical**: Without the `"functions"` section, functions are silently skipped during deploy.

### Client source directory — NEVER use project root

Catalyst zips the entire `source` directory with **no ignore mechanism**. No `.catalystignore`, no `files` field, no `--ignore` flag. Setting `"source": "."` on a project with `node_modules/` causes `ZIPSANITIZER_FILES_COUNT_EXCEEDED`.

**Always** use a dedicated directory (`app/`, `dist/`, `client/`). If `index.html` must live at root (e.g., GitHub Pages dual-hosting), create a build script that copies deployable files to a clean directory before `catalyst deploy`.

### `catalyst init` is interactive-only

There is no `--project`, `--type`, or non-interactive flag. The CLI requires arrow-key selection. For CI or scripted setup, create `.catalystrc` and `catalyst.json` manually using the templates above. The `.catalystrc` structure is consistent across all projects — only `id`, `name`, and `domain` fields change per project.

### catalyst-config.json (per function)

```json
{
  "deployment": {
    "name": "my-function",
    "stack": "node18",
    "type": "advancedio",
    "env_variables": {
      "KEY": "value"
    }
  },
  "execution": {
    "main": "index.js"
  }
}
```

---

## Deploy Process

```bash
# Deploy everything (functions + web client)
catalyst deploy

# Deploy only functions
catalyst deploy --only functions

# Deploy only web client
catalyst deploy --only client
```

### What deploy does

1. Reads `catalyst.json` for targets
2. For each function: runs `npm install` in function directory, packages code
3. Uploads functions and/or web client
4. **Replaces ALL env vars** with what's in `catalyst-config.json`

### Deploy output

Verify the output lists **both** "Functions" and "Web Client" sections. If only one appears, the other was silently skipped.

```
DEPLOYMENT SUCCESSFUL
  Functions:
    my-function: https://...catalystserverless.in/server/my-function
  Web Client:
    https://...catalystserverless.in/app/index.html
```

---

## Deploy Checklist

Before every deploy:

- [ ] All env vars (including secrets) are in `catalyst-config.json`
- [ ] `catalyst.json` includes both `functions` and `client` sections
- [ ] Each function directory has `package.json`
- [ ] Each function directory has `catalyst-config.json`
- [ ] `catalyst-config.json` is in `.gitignore`
- [ ] `catalyst-config.example.json` is in git with placeholder values
- [ ] `.catalystrc` is in `.gitignore`

After deploy:

- [ ] Output lists all expected functions
- [ ] Output lists web client
- [ ] Test endpoints are accessible
- [ ] Environment variables are correct (check in Console)

---

## Promoting to Production

1. Go to Catalyst Console (`console.catalyst.zoho.com`)
2. Navigate to your project -> Deployment
3. Click "Promote to Production"
4. Review changes and confirm

**Important**: Production has different ZAID, different domain, and unlimited users (dev has only 25).

---

## Platform Services

| Category | Services |
|----------|----------|
| Compute | Serverless Functions (Basic I/O, Advanced I/O), AppSail (containers) |
| Data | Data Store (relational), NoSQL, Cache, File Store (**EOL Apr 2026**) |
| Frontend | Web Client (`catalyst deploy`), Slate (framework hosting) |
| Auth | Hosted Login, Embedded Login, Third-party Auth |
| AI/ML | Zia Search, OCR, Face Recognition, Emotion Analysis, Keyword Extraction |
| Other | Push Notifications, Circuits, Smart Browz (headless browser) |

### Function Types

| Type | Purpose | Trigger |
|------|---------|---------|
| Basic I/O | Background tasks | SDK calls |
| Advanced I/O | HTTP endpoints (REST APIs) | HTTP requests |
| Event Functions | React to events | **EOL April 2026** |
| Cron Functions | Scheduled tasks | **EOL April 2026** |

### User Limits

| Environment | User Limit |
|-------------|-----------|
| Development | 25 users |
| Production | Unlimited |

---

## Pricing

| Service | Free Tier | Paid Rate |
|---------|-----------|-----------|
| Data Store reads | 5GB storage | $0.00006/req |
| Data Store writes | included | $0.0001/req |
| Functions | 1M invocations/mo | $0.000016/GB-sec |
| Cache | included | $0.00004-$0.00006/req |
| Zia Search | included | $0.00004/query |
| Users (dev) | 25 | -- |
| Users (prod) | Unlimited | -- |
| Hosting | 1 app | -- |

### Cost estimate example (100 users, 5-day event)

- ~500 writes/day x 5 = 2,500 x $0.0001 = **$0.25**
- ~2,000 reads/day x 5 = 10,000 x $0.00006 = **$0.60**
- **Total: < $1** for the entire event

---

## Deprecation Warnings

| Service | EOL Date | Replacement |
|---------|----------|-------------|
| **File Store** | April 2026 | External storage or Data Store BLOB |
| **Event Listeners** | April 2026 | Webhooks or Advanced I/O |
| **Cron Functions** | April 2026 | External scheduler or AppSail |

**Do NOT build new features on these services.**

---

## Slate Frontend Hosting

Slate is Catalyst's dedicated frontend hosting (like Vercel/Netlify). It's a **separate service** from `catalyst deploy` web client.

### What Slate offers

- Git auto-deploy (GitHub/GitLab/Bitbucket)
- Deployment previews (unique URL per deploy)
- One-click rollback
- Edge caching
- Cleaner URLs (`yourdomain.onslate.in`)
- Custom domains with free auto-renewing SSL
- Supports: Next.js, React, Vue, Svelte, Angular, Astro, Vite, Nuxt

### When to use Slate

Use Slate when:
- Building with a JS framework (React, Next.js, etc.) with a real build step
- Multiple developers need deployment previews
- CI/CD via GitHub for automatic deploys
- Cleaner URLs needed for stakeholders

### When NOT to use Slate

Stick with `catalyst deploy` when:
- Vanilla HTML/CSS/JS app with no build step
- Need to deploy frontend + functions in one command
- Don't want two separate deployment pipelines

### Key limitation

Slate is **frontend-only**. It does NOT deploy serverless functions. You still need `catalyst deploy --only functions` separately. This means two deployment pipelines.

### Slate CLI commands

```bash
catalyst init slate          # Initialize Slate
catalyst slate:create        # Create additional Slate app
catalyst serve --only slate  # Serve locally
catalyst deploy slate        # Deploy to dev
catalyst deploy slate --production  # Deploy to production
```

### Slate URL structure by DC

| DC | URL Pattern |
|----|-------------|
| US | `yourdomain.onslate.com` |
| EU | `yourdomain.onslate.eu` |
| IN | `yourdomain.onslate.in` |
| AU | `yourdomain.onslate.au` |

### Slate + Functions cookie/domain concern

Slate serves from `*.onslate.in`. Functions serve from `*.catalystserverless.in`. If these are different domains, cookies set by the OAuth function won't be readable by the Slate frontend. Use Catalyst domain mapping to put both under one custom domain. **Test this early.**

### Feature comparison: catalyst deploy vs Slate

| Feature | `catalyst deploy` | Slate |
|---------|-------------------|-------|
| Deploy command | One (frontend + backend) | Frontend only |
| Git auto-deploy | No | Yes |
| Deployment previews | No | Yes |
| Rollback | Manual redeploy | One-click |
| Edge caching | No | Yes |
| URL format | `*.catalystserverless.in/app/` | `*.onslate.in` |
| Build step | None needed | Expects npm install/build |
| Functions | Included | Separate deploy |
