# Hacksaw OAuth 2.0 Authentication Guide

## Overview

OAuth 2.0 provides secure, delegated access to Hacksaw API without storing client secrets. This guide implements the **Authorization Code Grant** flow from Zoho's OAuth 2.0 specification.

**Reference:** https://www.zoho.com/accounts/protocol/oauth/web-server-applications.html

---

## OAuth Scopes

The following read scopes are automatically requested:

| Scope | Purpose |
|-------|---------|
| `Hacksaw.repository.READ` | Repository and component data |
| `Hacksaw.scan.READ` | Scan results and history |
| `Hacksaw.report.READ` | Reports and summaries |
| `Hacksaw.product.READ` | Products list and information |
| `Hacksaw.component.READ` | Component details and metadata |
| `Hacksaw.vulnerability.READ` | Vulnerability data and details |
| `Hacksaw.sla.READ` | SLA profiles and settings |
| `Hacksaw.organization.READ` | Organization data and info |
| `Hacksaw.user.READ` | User information and permissions |
| `Hacksaw.api.READ` | API access permissions |

**Custom Scopes:** You can add additional scopes via the `scopes` query parameter.

---

## OAuth 2.0 Flow Diagram

```
┌─────────────┐                                      ┌──────────────┐
│   Client    │                                      │  Zoho OAuth  │
│ (Frontend)  │                                      │   Server     │
└──────┬──────┘                                      └──────┬───────┘
       │                                                    │
       │ 1. Click "Authorize Hacksaw"                      │
       ├────────────────────────────────────────────────→  │
       │                                                    │
       │ 2. Redirect to authorization endpoint             │
       │ GET /api/hacksaw/oauth/authorize                  │
       │                                                    │
       │ 3. Get authorization URL (with all scopes)        │
       │←────────────────────────────────────────────────  │
       │                                                    │
       │ 4. Redirect user to Zoho with scopes              │
       ├───────────────────────────────────────────────→   │
       │                                                    │
       │                                          (User grants permission)
       │                                                    │
       │ 5. Redirect back with authorization code          │
       │←───────────────────────────────────────────────   │
       │                                                    │
       │ 6. POST /api/hacksaw/oauth/callback with code     │
       ├─────────────────────────────────────────────────→ │
       │                                                    │
       │ 7. Exchange code for access token                 │
       │                                    (Behind the scenes)
       │                                                    │
       │ 8. Return access token (with all scopes)          │
       │←────────────────────────────────────────────────  │
       │                                                    │
       │ 9. Store token & redirect to dashboard            │
       │                                                    │
```

---

## Implementation

### Step 1: Get Authorization URL

```bash
curl "http://localhost:8000/api/hacksaw/oauth/authorize"
```

**Response:**
```json
{
  "success": true,
  "auth_url": "https://accounts.zoho.in/oauth/v2/auth?...",
  "redirect_uri": "http://localhost:8000/api/hacksaw/oauth/callback"
}
```

**Then:**
1. Frontend opens the `auth_url` in a browser
2. User logs in to Zoho
3. User grants permission to access Hacksaw

### Step 2: Handle OAuth Callback

After user grants permission, Zoho redirects to:

```
http://localhost:8000/api/hacksaw/oauth/callback?code=xxx&state=yyy
```

The system automatically:
- Exchanges `code` for `access_token`
- Stores token securely (encrypted)
- Returns success response

**Response:**
```json
{
  "success": true,
  "user_id": "default_user",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

### Step 3: Check Authorization Status

```bash
curl "http://localhost:8000/api/hacksaw/oauth/status?user_id=user123"
```

**Response (if authorized):**
```json
{
  "success": true,
  "authorized": true,
  "user_id": "user123",
  "token_type": "Bearer"
}
```

### Step 4: Use OAuth Token for API Calls

Once authorized, Hacksaw API calls use the OAuth token instead of Basic Auth:

```bash
curl "http://localhost:8000/api/hacksaw/violations?organisation=zoho&..." \
  -H "Authorization: Bearer <access_token>"
```

### Step 5: Revoke Authorization (Optional)

```bash
curl -X POST "http://localhost:8000/api/hacksaw/oauth/revoke?user_id=user123"
```

**Response:**
```json
{
  "success": true,
  "message": "OAuth token revoked successfully"
}
```

---

## API Endpoints

### 1. Generate Authorization URL
```
GET /api/hacksaw/oauth/authorize
Query Parameters:
  - redirect_uri (optional): Custom redirect URI
  - scopes (optional): Comma-separated additional scopes

Response:
  - auth_url: OAuth authorization URL (includes all read scopes)
  - redirect_uri: Callback URI to use
  - scopes: "All Hacksaw read scopes included"
  - additional_scopes: Any extra scopes requested

Examples:
  # Default (all read scopes)
  GET /api/hacksaw/oauth/authorize

  # With custom redirect URI
  GET /api/hacksaw/oauth/authorize?redirect_uri=https://example.com/callback

  # With additional scopes
  GET /api/hacksaw/oauth/authorize?scopes=Hacksaw.custom.READ,Hacksaw.admin.READ
```

### 2. OAuth Callback Handler
```
GET /api/hacksaw/oauth/callback
Query Parameters:
  - code: Authorization code from Zoho (required)
  - state: State parameter for CSRF protection (required)
  - user_id: Optional user identifier

Response:
  - user_id: User identifier
  - expires_in: Token expiration time (seconds)
  - token_type: Bearer
```

### 3. Check Authorization Status
```
GET /api/hacksaw/oauth/status
Query Parameters:
  - user_id: User identifier (default: "default_user")

Response:
  - authorized: true/false
  - token_type: Bearer (if authorized)
```

### 4. Revoke Authorization
```
POST /api/hacksaw/oauth/revoke
Query/Body Parameters:
  - user_id: User identifier (default: "default_user")

Response:
  - success: true/false
```

---

## Implementation Details

### Token Storage

Tokens are encrypted and stored in-memory (ready for SQLite/Catalyst):

```
global.hacksawOAuthTokens = {
  "user123": {
    access_token: "encrypted_token_xyz",
    refresh_token: "encrypted_refresh_xyz",
    expires_at: 1687443600000,
    token_type: "Bearer"
  }
}
```

### Token Refresh

When a token approaches expiration:
1. System automatically refreshes using `refresh_token`
2. New token stored
3. No user action required

### Security Features

✅ **Token Encryption:** All tokens encrypted at rest  
✅ **CSRF Protection:** State parameter validation  
✅ **Token Expiration:** Automatic validation before use  
✅ **Secure Scopes:** Limited to `Hacksaw.repository.READ`  
✅ **Per-User Tokens:** Separate token per user  
✅ **Token Revocation:** Full revocation capability  

---

## Frontend Integration Example

```javascript
// Step 1: Get authorization URL
async function authorizeHacksaw() {
  const response = await fetch('/api/hacksaw/oauth/authorize');
  const { auth_url } = await response.json();
  
  // Redirect user to Zoho
  window.location.href = auth_url;
}

// Step 2: After redirect back (handled by backend)
// Check authorization status
async function checkHacksawAuth() {
  const response = await fetch('/api/hacksaw/oauth/status?user_id=myuser');
  const { authorized } = await response.json();
  
  return authorized;
}

// Step 3: Use OAuth token for API calls
async function fetchViolations() {
  const response = await fetch(
    '/api/hacksaw/violations?organisation=zoho&productname=Logs360cloud&reportlabel=...',
    {
      headers: {
        'Authorization': 'Bearer ' + accessToken // Token managed by backend
      }
    }
  );
  return response.json();
}

// Step 4: Revoke access
async function revokeAccess() {
  await fetch('/api/hacksaw/oauth/revoke?user_id=myuser', {
    method: 'POST'
  });
}
```

---

## Comparison: Basic Auth vs OAuth 2.0

| Feature | Basic Auth | OAuth 2.0 |
|---------|-----------|----------|
| **Security** | Stores credentials | Uses bearer tokens |
| **Credential Exposure** | High risk | Low risk |
| **Token Expiration** | N/A | Automatic |
| **User Revocation** | Manual | Immediate |
| **Per-User Access** | Single account | Multiple users |
| **Compliance** | Basic | Enterprise-grade |
| **Setup Complexity** | Simple | Moderate |

---

## Troubleshooting

### "Authorization URL generation failed"
- Ensure `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` are set
- Verify OAuth credentials are correct

### "Invalid authorization code"
- Code may have expired (valid for 10 minutes)
- User may have cancelled authorization
- Retry authorization flow

### "Token refresh failed"
- Refresh token may have expired
- User needs to re-authorize
- Run revoke and restart authorization flow

### "OAuth not available"
- OAuth manager not initialized
- Check server logs for initialization errors
- Restart server

---

## Best Practices

1. **Store user_id with token** - Associate tokens with specific users
2. **Refresh proactively** - Refresh token before expiration
3. **Implement logout** - Always revoke token on user logout
4. **Error handling** - Handle token expiration gracefully
5. **HTTPS only** - Always use HTTPS in production
6. **Validate state** - Always validate state parameter for CSRF protection

---

## References

- [Zoho OAuth 2.0 Web Server Applications](https://www.zoho.com/accounts/protocol/oauth/web-server-applications.html)
- [RFC 6749 - The OAuth 2.0 Authorization Framework](https://tools.ietf.org/html/rfc6749)
- [OWASP - OAuth 2.0 Security](https://owasp.org/www-community/attacks/OAuth_2_0_Authorization_Code_Injection)

---

## Migration from Basic Auth

To migrate from Basic Auth to OAuth 2.0:

1. ✅ Remove Basic Auth credentials storage
2. ✅ Implement OAuth 2.0 flow (already done!)
3. ✅ Update API calls to use `Authorization: Bearer <token>`
4. ✅ Test with multiple users
5. ✅ Remove old credential form

Current status: **OAuth 2.0 endpoints implemented and ready!**