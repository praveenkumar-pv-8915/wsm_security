# CRM <-> Creator Sync via Catalyst Connectors

> Covers bidirectional sync between Zoho CRM and Zoho Creator using Catalyst Functions
> and Connectors. Three approaches compared, with code patterns and setup steps.

---

## Table of Contents

- [Decision Tree](#decision-tree)
- [Feature Comparison](#feature-comparison)
- [Architecture](#architecture)
- [Minimal Setup (Recommended)](#minimal-setup-recommended)
- [Full Connector Setup (Alternative)](#full-connector-setup-alternative)
- [Creator Workflow Code](#creator-workflow-code)
- [CRM Custom Button Code](#crm-custom-button-code)
- [Sync Behavior](#sync-behavior)
- [Connector Scopes](#connector-scopes)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Production Checklist](#production-checklist)

---

## Decision Tree

```
Do you need per-user OAuth or multi-tenant support?
+-- Yes -> Build custom solution (not covered here)
+-- No  -> Are all users in same Zoho org?
            +-- Yes -> Use Minimal approach (recommended)
            +-- No  -> You need multi-tenant (build custom)
```

---

## Feature Comparison

| Feature | Minimal | Full Connector | Manual OAuth (Legacy) |
|---------|---------|----------------|----------------------|
| Code lines | ~250 | ~400 | ~400 |
| Setup steps | 5 | 6 | 7 |
| OAuth management | Automatic | Automatic | Manual |
| Security | High | High | **Low** |
| Maintenance | Low | Low | **High** |
| Extensibility | Good | Better | Poor |
| Error handling | Basic | Detailed | Complex |
| **Recommended** | Yes | Alternative | **No -- deprecated** |

**Do NOT use Manual OAuth.** Secrets end up in code, tokens expire, and maintenance is ongoing.

---

## Architecture

```
Creator Form Submit -> Catalyst Function -> OAuth Connector -> CRM API
CRM Button Click    -> Catalyst Function -> OAuth Connector -> Creator API
```

One service account. Same OAuth credentials for both. Auto-refresh tokens via Catalyst Connectors.

### What Catalyst Connectors manage for you

- OAuth Client Credentials (stored encrypted)
- Refresh Token (auto-rotated, never exposed)
- Access Token (auto-refreshed before expiry)
- Scope Enforcement (least-privilege access)
- Audit Logs (all API calls logged)
- Environment Separation (Dev/Prod isolation)

---

## Minimal Setup (Recommended)

### Step 1: Create Catalyst project

```bash
npm install -g zcatalyst-cli
catalyst login
catalyst init
# Choose: Functions > Node.js (Express)
```

### Step 2: Create Connectors (Catalyst Console)

**CRM Connector:**
1. Catalyst Console -> Connectors -> Create Connector
2. Name: `crm_connector`
3. Service: Zoho CRM
4. Scopes: `ZohoCRM.modules.ALL`
5. Authorize -> Grant permissions

**Creator Connector:**
1. Connectors -> Create Connector
2. Name: `creator_connector`
3. Service: Zoho Creator
4. Scopes: `ZohoCreator.report.READ`, `ZohoCreator.report.CREATE`, `ZohoCreator.report.UPDATE`, `ZohoCreator.form.CREATE`
5. Authorize -> Grant permissions

### Step 3: Set environment variable

In Catalyst Console -> Functions -> Configuration -> Environment Variables:

| Key | Secure | Description |
|-----|--------|-------------|
| `SYNC_SECRET` | Yes | Shared secret for request validation |

Generate:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 4: Deploy

```bash
catalyst deploy
```

Copy the function URL from output.

### Step 5: Configure workflows

See [Creator Workflow Code](#creator-workflow-code) and [CRM Custom Button Code](#crm-custom-button-code) below.

---

## Full Connector Setup (Alternative)

Same as Minimal but with:
- More abstraction and helper functions
- More detailed error handling and logging
- Better for debugging complex issues

Additional step: Add `ZohoCRM.settings.fields.READ` scope to CRM Connector and `ZohoCreator.meta.application.READ` scope to Creator Connector.

### Code pattern

```javascript
// Same connector usage
const crmConn = app.connection("crm_connector");
const creatorConn = app.connection("creator_connector");

// Wrapped in helper with detailed logging
async function getCRMRecord(recordId, crmConn) {
  try {
    const response = await crmConn.request({
      method: "GET",
      url: `/crm/v8/Quotes/${recordId}`
    });
    console.log('Fetched CRM record:', recordId);
    return response.data[0];
  } catch (error) {
    console.error('Failed to fetch CRM record:', error);
    throw new Error(`Failed to fetch CRM record ${recordId}`);
  }
}
```

---

## Creator Workflow Code

**Location:** Creator -> Service_Order Form -> Workflows -> On Submit

```deluge
recordId = input.ID;

payload = Map();
payload.put("actionType", "creator_to_crm");
payload.put("creatorRecordId", recordId);
payload.put("secret", "YOUR_SYNC_SECRET_HERE");

response = invokeUrl
[
    url: "YOUR_CATALYST_FUNCTION_URL"
    type: POST
    parameters: payload.toString()
];

if (response.get("success") == true)
{
    action = response.get("action");
    crmId = response.get("crmRecordId");
    if (action == "create")
    {
        info "Created CRM Quote: " + crmId;
    }
    else
    {
        info "Updated CRM Quote: " + crmId;
    }
}
else
{
    info "Sync failed: " + response.get("error");
}
```

Replace `YOUR_SYNC_SECRET_HERE` and `YOUR_CATALYST_FUNCTION_URL`.

---

## CRM Custom Button Code

**Location:** CRM -> Setup -> Customization -> Modules -> Quotes -> Custom Buttons

Button config:
- Name: **Sync to Creator**
- Execute: **Custom Function**
- Location: **View Page**

```deluge
void syncToCreator()
{
    recordId = ${Quotes.id};

    payload = Map();
    payload.put("actionType", "crm_to_creator");
    payload.put("crmRecordId", recordId);
    payload.put("secret", "YOUR_SYNC_SECRET_HERE");

    response = invokeUrl
    [
        url: "YOUR_CATALYST_FUNCTION_URL"
        type: POST
        parameters: payload.toString()
    ];

    if (response.get("success") == true)
    {
        action = response.get("action");
        creatorId = response.get("creatorRecordId");
        if (action == "create")
        {
            alert("Created Creator Service Order: " + creatorId);
        }
        else
        {
            alert("Updated Creator Service Order: " + creatorId);
        }
    }
    else
    {
        alert("Sync failed: " + response.get("error"));
    }
}

syncToCreator();
```

Replace `YOUR_SYNC_SECRET_HERE` and `YOUR_CATALYST_FUNCTION_URL`.

---

## Sync Behavior

### Creator -> CRM flow

1. User submits Creator form
2. Creator calls Catalyst with `creatorRecordId`
3. Catalyst gets access token via connector (auto-refresh)
4. Catalyst fetches Creator record
5. **If `BOM_CRM_Record_ID` exists:** Update CRM Quote
6. **If `BOM_CRM_Record_ID` empty:** Create CRM Quote + write ID back to Creator
7. Cache mapping (optional)

### CRM -> Creator flow

1. User clicks CRM button
2. CRM calls Catalyst with `crmRecordId`
3. Catalyst gets access token via connector (auto-refresh)
4. Catalyst fetches CRM record
5. **If `Creator_Record_ID` exists:** Update Creator Service_Order
6. **If `Creator_Record_ID` empty:** Create Service_Order + write ID back to CRM
7. Cache mapping (optional)

### What gets synced

| Creator -> CRM | CRM -> Creator |
|----------------|----------------|
| Subject_field -> Subject | Subject -> Subject_field |
| BOM_Stage -> Quote_Stage | Quote_Stage -> BOM_Stage |
| Quoted_Items -> Quoted_Items (subform) | Quoted_Items -> Quoted_Items (grid) |
| BOM_CRM_Record_ID (link field) | Creator_Record_ID (link field) |

### Optional: Cache for record mappings

```javascript
const cache = app.cache();
const segment = cache.segment();

// Cache for 24 hours
await segment.put(`mapping:creator:${creatorRecordId}`, crmRecordId, 24);
await segment.put(`mapping:crm:${crmRecordId}`, creatorRecordId, 24);
```

---

## Connector Scopes

### CRM Connector

| Scope | Purpose |
|-------|---------|
| `ZohoCRM.modules.ALL` | Read/write Quotes and related data |
| `ZohoCRM.settings.fields.READ` | Read field metadata (Full Connector only) |

### Creator Connector

| Scope | Purpose |
|-------|---------|
| `ZohoCreator.meta.application.READ` | Read app structure (Full Connector only) |
| `ZohoCreator.report.READ` | Fetch Service_Order records |
| `ZohoCreator.report.CREATE` | Create Service_Order records |
| `ZohoCreator.report.UPDATE` | Update Service_Order records |
| `ZohoCreator.form.CREATE` | Submit forms |

---

## Testing

### Test Creator -> CRM

1. Open a Service_Order record in Creator
2. Submit form (or click sync button)
3. Check CRM Quotes for new/updated Quote
4. Verify `BOM_CRM_Record_ID` field is populated in Creator

### Test CRM -> Creator

1. Open a Quote record in CRM
2. Click "Sync to Creator" button
3. Check Creator for new/updated Service_Order
4. Verify `Creator_Record_ID` field is populated in CRM

### Check logs

```bash
catalyst logs:functions --function-name zoho_sync
```

Or: Catalyst Console -> Functions -> Logs

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| 401 Unauthorized | Check `SYNC_SECRET` matches in all 3 places (env var, Creator workflow, CRM button) |
| Connector not found | Verify connector names match exactly: `crm_connector`, `creator_connector` |
| Insufficient scope | Add missing scopes to connector in Console, re-authorize |
| 401 from Zoho API | Re-authorize connector: Console -> Connectors -> Re-authorize |
| Record not found | Verify record IDs and permissions |
| Function timeout | Increase timeout in `catalyst.json` or via `catalyst functions:update --timeout 60` |
| Token refresh failed | Verify Client ID/Secret/Refresh Token, check DC URLs |
| Env var not found | Set in Console -> Functions -> Configuration, redeploy if needed |

---

## Security

### What's protected

- Catalyst validates secret on every call
- Invalid secret = 401 Unauthorized
- OAuth tokens auto-managed by Catalyst (never exposed)
- All API calls made as one service identity
- Encrypted credential storage

### Best practices

- Use same `SYNC_SECRET` in all 3 places
- Mark it as **Secure** in environment variables
- Rotate periodically
- Function URL should only be called from Creator/CRM (not exposed publicly)
- Connectors use minimum required scopes

---

## Production Checklist

- [ ] Both connectors created and authorized
- [ ] `SYNC_SECRET` set as secure environment variable
- [ ] Function deployed to Catalyst
- [ ] Creator workflow configured with correct URL and secret
- [ ] CRM custom button configured with correct URL and secret
- [ ] Tested Creator -> CRM sync
- [ ] Tested CRM -> Creator sync
- [ ] Verified bidirectional links populated
- [ ] Checked Catalyst logs for errors
- [ ] Promoted to production environment (if needed)

---

## Migration: Manual OAuth -> Connectors

If moving from the legacy Manual OAuth approach:

1. Replace handler file with Minimal connector version
2. Create two connectors (CRM + Creator)
3. Set `SYNC_SECRET` environment variable
4. Remove hardcoded OAuth credentials from code
5. Update workflows to include `secret` in payload
6. Deploy

**Time:** ~15 minutes
