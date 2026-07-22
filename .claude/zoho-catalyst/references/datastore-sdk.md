# Data Store, ZCQL & SDK Reference

> Covers Data Store schema design, ZCQL query patterns, pagination, SDK initialization,
> credential management, scopes, and data center configuration.
> For the ZCQL 300-row gotcha and SDK version warning, see SKILL.md.

---

## Table of Contents

- [Data Store Basics](#data-store-basics)
- [Column Types and Limits](#column-types-and-limits)
- [Schema Design Patterns](#schema-design-patterns)
- [ZCQL Query Patterns](#zcql-query-patterns)
- [ZCQL Pagination Helper](#zcql-pagination-helper)
- [ZCQL Result Format](#zcql-result-format)
- [SDK Initialization](#sdk-initialization)
- [Credential Management](#credential-management)
- [OAuth Scopes](#oauth-scopes)
- [Data Center Domains](#data-center-domains)
- [Finding Project IDs](#finding-project-ids)
- [Seed Script Patterns](#seed-script-patterns)

---

## Data Store Basics

SQL-like relational database with ZCQL query language.

- Max 200 tables per project, 100 columns per table (dev)
- 5GB free storage
- Auto-generated columns on every table: `ROWID` (BigInt PK), `CREATORID` (BigInt), `CREATEDTIME` (DateTime), `MODIFIEDTIME` (DateTime)

---

## Column Types and Limits

| Type | Max Size | Notes |
|------|----------|-------|
| Varchar | 255 chars | Short strings |
| Text | 10,000 chars | Don't stuff large JSON -- normalize instead |
| Int | 10 digits | |
| BigInt | 19 digits | Used for ROWID, CREATORID |
| Double | 17 digits | |
| Boolean | -- | |
| Date | -- | |
| DateTime | -- | |
| Encrypted Text | 10,000 chars | |
| Foreign Key | -- | Supports `ON DELETE NULL` and `ON DELETE CASCADE` |

### ZCQL limits

- **Max 300 rows** per SELECT query (silent -- see SKILL.md gotcha #1)
- **Max 20 columns** per SELECT
- 100 columns per table in dev (no limit in production)

### Reserved column names

Catalyst rejects certain column names. Known reserved: `priority`. Likely others exist.

**Workaround**: Use descriptive suffixes (`priority_level`, `status_code`). Map to clean names at the API layer. Always test column creation before finalizing schema.

### Column creation form order

The Console dialog presents fields in this order:
1. Column Name
2. Data Type (Varchar/Text shows Max Length)
3. Is Unique (toggle)
4. Is Mandatory (toggle)
5. PII/ePHI (toggle)

Search Index is set separately. Match your schema docs to this order for efficient data entry.

---

## Schema Design Patterns

### Natural keys vs ROWID foreign keys

Using human-readable Varchar keys (slugs, emails) instead of ROWID integers for cross-table references:

**Benefits:**
- Queries are readable
- Seed scripts don't need to track ROWID mappings
- Data is portable

**Tradeoffs:**
- No cascade deletes (requires FK columns)
- Referential integrity enforced at API layer
- Acceptable for internal tools

### CREATORID with custom OAuth

With custom Zoho OAuth (not Catalyst Native Auth), `CREATORID` won't auto-populate with your user. Track `employee_email` as a denormalized column in user-scoped tables.

---

## ZCQL Query Patterns

### Basic queries

```sql
SELECT * FROM Notes WHERE attendee_id = '123'
INSERT INTO Notes (attendee_id, note_text, user_email) VALUES ('123', 'Met at booth', 'user@co.com')
UPDATE Notes SET note_text = 'Updated note' WHERE ROWID = 456
DELETE FROM Notes WHERE ROWID = 456
```

### Always paginate

```sql
-- NEVER do this if table could have > 300 rows:
SELECT * FROM LargeTable

-- ALWAYS paginate:
SELECT * FROM LargeTable LIMIT 0, 300
SELECT * FROM LargeTable LIMIT 300, 300
SELECT * FROM LargeTable LIMIT 600, 300
```

---

## ZCQL Pagination Helper

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

// Usage:
const allAttendees = await fetchAll(zcql, 'SELECT * FROM Attendees', 'Attendees');
```

---

## ZCQL Result Format

Queries wrap each row in a table-name key:

**Single table:**
```javascript
[{ Attendees: { ROWID: "123", slug: "abhi-kumar", name: "Abhi" } }]
```

**JOINs:**
```javascript
[{ Attendees: { ROWID: "123", ... }, Organizations: { ROWID: "456", ... } }]
```

Always unwrap with a helper:

```javascript
function unwrapRows(result, tableName) {
  return result.map(r => r[tableName]);
}
```

---

## SDK Initialization

### Inside a Catalyst function (Express template)

```javascript
const catalyst = require('zcatalyst-sdk-node');

app.get('/endpoint', async (req, res) => {
  const catalystApp = catalyst.initialize(req);  // Uses request headers for auth
  const zcql = catalystApp.zcql();
  // ...
});
```

### Outside Catalyst functions (scripts, seed tools)

**IMPORTANT**: `catalyst.initialize(req)` is for IN-FUNCTION use only. External scripts MUST use `catalyst.initializeApp()`.

```javascript
// Set DC-specific env vars BEFORE requiring the SDK
require('dotenv').config({ path: '.env' });

const catalyst = require('zcatalyst-sdk-node');

const cred = catalyst.credential.refreshToken({
  client_id: process.env.CATALYST_CLIENT_ID,       // Self Client ID
  client_secret: process.env.CATALYST_CLIENT_SECRET, // Self Client Secret
  refresh_token: process.env.CATALYST_REFRESH_TOKEN, // From grant token exchange
});

const app = catalyst.initializeApp({
  project_id: process.env.CATALYST_PROJECT_ID,   // Internal ID from .catalystrc
  project_key: process.env.CATALYST_PROJECT_KEY,  // ZAID from Environment Settings
  environment: process.env.CATALYST_ENVIRONMENT || 'Development',
  credential: cred,
});

const datastore = app.datastore();
const zcql = app.zcql();
```

### SDK version

Latest: **3.1.1** (as of 2026-02-11). Version 4.x does NOT exist.

---

## Credential Management

### Self Client vs Server-based Application

Zoho has multiple OAuth client types in the API Console (`api-console.zoho.com`):

| Type | For | Has Own Credentials |
|------|-----|-------------------|
| **Server-based Application** | User-facing OAuth with redirect URIs | Yes (Client ID/Secret) |
| **Self Client** | Server-to-server scripts (no user interaction) | Yes (separate Client ID/Secret) |

**Do NOT reuse the app's OAuth credentials for scripts.** Create a Self Client specifically for seed scripts and admin tools.

### Grant token -> Refresh token exchange

```bash
curl -X POST "https://accounts.zoho.{dc}/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_SELF_CLIENT_ID" \
  -d "client_secret=YOUR_SELF_CLIENT_SECRET" \
  -d "code=GRANT_TOKEN_FROM_CONSOLE"
```

- Use the correct DC domain
- Grant tokens expire in ~3 minutes
- Refresh tokens don't expire unless revoked

---

## OAuth Scopes

### Data Store operations -- use specific table-level scopes

- `ZohoCatalyst.tables.rows.CREATE` -- insert rows
- `ZohoCatalyst.tables.rows.READ` -- query via ZCQL
- `ZohoCatalyst.tables.rows.DELETE` -- delete rows

**Gotcha**: `ZohoCatalyst.tables.ALL` and `ZohoCatalyst.projects.ALL` do NOT grant Data Store row access. Use the specific `tables.rows.*` scopes.

---

## Data Center Domains

The SDK defaults to `.zoho.com`. For other DCs, set these env vars **BEFORE** `require('zcatalyst-sdk-node')`:

| DC | `X_ZOHO_CATALYST_ACCOUNTS_URL` | `X_ZOHO_CATALYST_CONSOLE_URL` |
|----|-------------------------------|-------------------------------|
| US | `https://accounts.zoho.com` (default) | `https://api.catalyst.zoho.com` |
| India | `https://accounts.zoho.in` | `https://api.catalyst.zoho.in` |
| EU | `https://accounts.zoho.eu` | `https://api.catalyst.zoho.eu` |
| AU | `https://accounts.zoho.com.au` | `https://api.catalyst.zoho.com.au` |

**Gotcha**: If you get `invalid_client` during token exchange, you're hitting the wrong DC's accounts server.

---

## Finding Project IDs

### Three different numbers -- don't confuse them

| ID | Where to Find | Used For |
|----|--------------|----------|
| **Internal Project ID** | `.catalystrc` -> `projects[0].id` (e.g., `22249000000014089`) | SDK API path (`project_id` in `initializeApp`) |
| **Environment ID** | Console -> Settings -> Project Settings (e.g., `60047883702`) | URL domain only, NOT in API calls |
| **ZAID (projectKey)** | Console -> Settings -> Environment Settings -> General | `project_key` in `initializeApp`. **Different for Dev vs Prod.** |

**Critical**: If you get `PERMISSION_NEEDED` errors on Data Store operations, check that you're using the internal project ID from `.catalystrc`, NOT the environment ID from the Console UI.

### How to find the ZAID

1. Switch to target environment (Dev or Prod) in Console dropdown
2. Go to **Settings -> Environment Settings -> General**
3. Copy the numeric **ZAID** value

**ZAID may not be visible until you enable Authentication:**
- Go to **CloudScale -> Security & Identity -> Authentication**
- Enable **Native Catalyst Authentication**
- Enable any non-Zoho social login provider (Google, LinkedIn, etc.)
- This unlocks the ZAID in Environment Settings
- You can disable providers after copying the ZAID

**Alternative**: Edit a social login -- sample redirect URIs contain the ZAID:
`https://accounts.zohoportal.com/accounts/extoauth/{ZAID}/clientcallback`

---

## Seed Script Patterns

### Idempotency

Before inserting, query `COUNT(ROWID)` for each table. Behavior modes:
- **Default**: Skip if rows exist
- `--force`: Insert anyway
- `--reset`: Clear table first

Always support `--dry-run`.

**Gotcha**: Tables without unique constraints (junction tables) get duplicate rows on re-run without `--reset`.

### Example seed script env vars

```
CATALYST_CLIENT_ID=1000.xxx        # Self Client ID (not app OAuth)
CATALYST_CLIENT_SECRET=xxx         # Self Client Secret
CATALYST_REFRESH_TOKEN=1000.xxx    # From grant token exchange
CATALYST_PROJECT_ID=22249...       # Internal ID from .catalystrc
CATALYST_PROJECT_KEY=60047...      # ZAID from Environment Settings
CATALYST_ENVIRONMENT=Development
X_ZOHO_CATALYST_ACCOUNTS_URL=https://accounts.zoho.in
X_ZOHO_CATALYST_CONSOLE_URL=https://api.catalyst.zoho.in
```
