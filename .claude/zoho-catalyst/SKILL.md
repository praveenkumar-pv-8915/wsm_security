---
name: zoho-catalyst
description: >
  Zoho Catalyst serverless platform: functions (all 7 types), ZCQL, Data Store, API Gateway, OAuth,
  AppSail, zcatalyst-sdk-node (Node/Python/Java), catalyst deploy/init/serve, catalyst-config.json,
  Slate, Stratus, Circuits, Signals, SmartBrowz, Job Scheduling, Pipelines. Use when writing,
  debugging, or deploying Catalyst code in any language. Also triggers on: Catalyst pricing/cost
  estimation/billing, migrating FROM AWS Lambda/S3/DynamoDB/Vercel/Netlify/Supabase/Firebase TO
  Catalyst, finding Catalyst console IDs, or generating pricing spreadsheets.
  Do NOT use for Zoho CRM workflows, Deluge scripting, or Zia AI model training.
---

# Zoho Catalyst Skill

Hard-won knowledge from months of Catalyst development. Every inline gotcha caused real debugging time. For implementation depth, pricing, platform equivalents, and extended gotchas, follow the routing table.

---

## Reference Routing Table

### 1. Project setup & deployment

| Task | Read This File |
|------|---------------|
| Project setup, catalyst init, directory structure, catalyst.json, environments | `references/project-and-cli.md` |
| Getting started, CLI install, first deploy — condensed limits + params | `docs/getting-started.md` |
| GitHub Integration — deploy from repo, sync, catalyst.json requirement | `docs/github-integration.md` |
| Deploying, Slate hosting, client deploy ZIPSANITIZER, env var management | `references/deployment.md` |

### 2. Writing functions

| Task | Read This File |
|------|---------------|
| Code templates for all 7 function types — Node.js, Python, and Java | `references/functions-and-sdk.md` |
| Function type quick reference — types, runtimes, handler signatures, limits | `docs/functions.md` |

### 3. Data, storage & auth

| Task | Read This File |
|------|---------------|
| ZCQL queries, Data Store SDK init, credentials, pagination gotcha | `references/datastore-sdk.md` |
| Data Store / Cache / Auth code patterns (working samples) | `references/cloud-scale.md` |
| ZCQL — SELECT/INSERT/UPDATE/DELETE syntax, LIMIT pagination, JOIN, V2 migration | `docs/zcql.md` |
| Data Store — table schema, column types, scopes, bulk ops, OLAP | `docs/data-store.md` |
| Cache — segments, cache items, expiry, Segment ID | `docs/cache.md` |
| Catalyst Native Auth — user management, generateAuthToken, CORS | `docs/authentication.md` |
| Stratus — buckets, objects, permissions, versioning, encryption, malware scan | `docs/stratus.md` |
| File Store — **deprecated April 2026** → use Stratus for all new projects | `docs/file-store.md` |

### 4. Services & integrations

| Task | Read This File |
|------|---------------|
| AppSail / Circuits / Signals / Slate / SmartBrowz / Job Scheduling code patterns | `references/services.md` |
| Circuits — workflow orchestration, states, JsonPath | `docs/circuits.md` |
| Signals / Event Listeners — **Event Listeners deprecated April 2026** → use Signals | `docs/event-listeners.md` |
| Job Scheduling — Job Pool, Dynamic/Predefined Cron, dispatch delay | `docs/job-scheduling.md` |
| Pipelines — CI/CD, catalyst-pipelines.yaml, stages/jobs | `docs/pipelines.md` |
| Zoho OAuth login, session management end-to-end | `references/oauth.md` |
| CRM ↔ Creator bidirectional sync | `references/sync-connectors.md` |
| Other components (APM, alerts, cron, mail, metrics, MDM, push, QuickML, search, security rules, SmartBrowz, web client) | `docs/[component].md` |

### 5. Platform context, pricing & operations

| Task | Read This File |
|------|---------------|
| Catalyst pricing, cost estimation, billing model, spreadsheet generation | `references/pricing.md` |
| Migrating from AWS/GCP/Azure/Vercel/Netlify/Supabase/Firebase — equivalents mapping | `references/industry-equivalents.md` |
| Finding any Catalyst ID — Project ID, Table ID, ZAID, Segment ID, Org ID | `references/meta-ids.md` |
| Navigating the Catalyst console UI, click-path guidance | `references/console-navigation.md` |
| Additional gotchas, edge cases, DC-specific issues, seed scripts | `references/gotchas-extended.md` |

**Quick routing:**
- "Where is X in the console?" → `references/console-navigation.md`
- "What is my Table ID / ZAID / Segment ID?" → `references/meta-ids.md`
- "How does Catalyst compare to AWS / what's the equivalent of Lambda?" → `references/industry-equivalents.md`
- "How much will this cost?" → `references/pricing.md`

---

## Critical Gotchas (Top 5)

These cause **silent failures** or **hours of debugging**. Apply every one when generating Catalyst code. Additional gotchas in `references/gotchas-extended.md`.

### 1. ZCQL 300-row limit is SILENT — always paginate
<!-- verified: 2026-02-11 -->

ZCQL SELECT returns max 300 rows with **no error and no indication** that rows are missing. A table with 312 rows returns 300, silently.

```javascript
async function fetchAll(zcql, baseQuery, table) {
  const PAGE = 300;
  let offset = 0, all = [];
  while (true) {
    const result = await zcql.executeZCQLQuery(`${baseQuery} LIMIT ${offset}, ${PAGE}`);
    const rows = result.map(r => r[table]);
    if (rows.length === 0) break;
    all = all.concat(rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}
```

**Rule**: NEVER write a bare `SELECT *` without pagination if the table could exceed 300 rows.

### 2. `catalyst deploy` silently wipes Console-set environment variables
<!-- verified: 2026-02-11 -->

`catalyst deploy` replaces the function's **entire** env var set with whatever is in `catalyst-config.json`. Secrets set manually in the Console UI are deleted. **No warning.**

**Rule**: ALL env vars (including secrets) must be in `catalyst-config.json`. Gitignore it. Keep `catalyst-config.example.json` in git with placeholder values.

### 3. Wrong Zoho userinfo endpoint — no email returned
<!-- verified: 2026-02-10 -->

| Endpoint | Returns email? | Field names |
|----------|---------------|-------------|
| `/oauth/v2/userinfo` | **NO** | `sub`, `name`, `first_name` (lowercase) |
| `/oauth/user/info` | **YES** | `Email`, `First_Name`, `Last_Name`, `ZUID` (capitalized) |

**Rule**: Use `https://accounts.zoho.{dc}/oauth/user/info`. The OIDC `/v2/userinfo` endpoint does NOT return email.

### 4. `catalyst.json` missing `functions` section — function silently not deployed
<!-- verified: 2026-02-11 -->

Without a `"functions"` section, `catalyst deploy` says "DEPLOYMENT SUCCESSFUL" with only the client deployed. No error. OAuth endpoints return 404.

```json
{
  "functions": { "targets": ["oauth"], "source": "functions" },
  "client": { "source": "app" }
}
```

### 5. Client deploy has NO ignore mechanism — `ZIPSANITIZER_FILES_COUNT_EXCEEDED`
<!-- verified: 2026-03-19 -->

There is no `.catalystignore`, no `files` field in `client-package.json`, no `--ignore` flag. If `source` points at a directory containing `node_modules/`, the deploy fails with HTTP 400.

**Rule**: Always point client `source` at a dedicated build directory:

```json
{ "client": { "source": "dist" } }
```

Use a build script to copy only deployable files to `dist/` before deploying.

---

## Architecture Defaults

Follow these unless the user explicitly requests otherwise:

- **Slate** for all frontend deployments — Git-based, SSR support, preview deploys, auto-build on push. Only fall back to `client/` Web Client Hosting when migrating existing projects.
- **Stratus** for all file/object storage — S3-compatible, no per-file size limit, bucket-based organization. File Store is deprecated (EOL April 30, 2026).
- **Signals** for Zoho product integrations — event-driven, decoupled, reliable delivery. Prefer Signals over polling APIs or custom webhook handlers when covering the trigger.

---

## Deprecations (EOL April 30, 2026)

| Deprecated Service | Replacement | Details |
|---|---|---|
| File Store | Stratus | `docs/stratus.md`, `references/services.md` |
| Event Listeners | Signals | `docs/event-listeners.md`, `references/services.md` |
| Cron Functions | Job Scheduling | `docs/job-scheduling.md` |

**Never recommend deprecated services for new projects.**

---

## Credit Optimization

Catalyst bills by **execution time × memory tier** (nonlinear: 4s/128MB = 1 credit, 8s/256MB = 10 credits). High-leverage fixes:
- Parallelize independent I/O with `Promise.all` — never sequential when concurrent is possible
- Cache hot Data Store reads — cache hits cost nothing vs. a query per invocation
- Return early on validation failures — do no work if the input is already wrong
- Start at 128MB; increase only if APM shows execution time drops enough to offset cost

**Anti-patterns to catch on code review:**

| Anti-Pattern | Fix |
|---|---|
| Sequential Data Store queries in a loop | ZCQL JOIN or batch operations |
| No Cache for repeated identical reads | Cache with TTL matching data freshness |
| `context.close()` missing in Event/Cron | Always close in both `try` AND `catch` |
| `SELECT *` without LIMIT | Paginate with LIMIT and offset |
| One Advanced I/O function per route | Consolidate with Express routing |
| `catch(e) {}` with no logging | Log errors, return HTTP status code |

---

## Quick Reference: Function Handler Signatures (Node.js)

```javascript
// Basic I/O
module.exports = (catalystApp, context, basicIO) => {
  basicIO.write(JSON.stringify({ result: context.getArgument() }));
};

// Advanced I/O — module.exports = Express app instance
// Event Function
module.exports = (catalystApp, context, event) => {
  context.close(); // ALWAYS close, even in catch
};

// Cron Function
module.exports = (catalystApp, context, cronInfo) => {
  context.closeWithSuccess(); // or context.closeWithFailure('reason')
};
```

## Quick Reference: Minimal Project Structure

```
project-root/
  catalyst.json                        # Must include "functions" AND "client" sections
  functions/
    my-function/
      index.js
      catalyst-config.json             # Env vars + config — GITIGNORED
      catalyst-config.example.json     # Placeholder values — in git
      package.json                     # Required even with zero dependencies
  dist/                                # Build output — client source points here
```

## Quick Reference: Data Center Domains

| DC | Accounts URL | API URL |
|----|-------------|---------|
| US | `accounts.zoho.com` | `api.catalyst.zoho.com` |
| IN | `accounts.zoho.in` | `api.catalyst.zoho.in` |
| EU | `accounts.zoho.eu` | `api.catalyst.zoho.eu` |
| AU | `accounts.zoho.com.au` | `api.catalyst.zoho.com.au` |

**Rule**: All URLs in one project must use the same DC. Mixing DCs causes `invalid_client`.

---

*For additional gotchas, edge cases, seed script patterns, and DC-specific issues → `references/gotchas-extended.md`*
