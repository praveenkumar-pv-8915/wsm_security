# Zoho OAuth 2.0 - Common Authentication System

## Overview

A generic, service-agnostic OAuth 2.0 implementation for all Zoho applications and services. This unified system handles authentication for Hacksaw, CRM, Projects, Books, and any other Zoho service.

**Key Benefits:**
- ✅ Single OAuth handler for all Zoho services
- ✅ Easy to add new services
- ✅ Service-specific scope management
- ✅ Per-service, per-user token isolation
- ✅ Extensible architecture
- ✅ No hardcoded credentials needed

---

## Supported Services

| Service | ID | Scopes | Use Case |
|---------|-----|--------|----------|
| **Hacksaw** | `hacksaw` | 10 read scopes | Security scanning, vulnerability data |
| **CRM** | `crm` | CRM modules, users, settings | Sales & customer management |
| **Projects** | `projects` | Projects, tasks | Project management |
| **Books** | `books` | Bills, invoices, contacts | Accounting |
| **Custom** | (register) | As needed | Any Zoho service |

---

## API Endpoints

All endpoints are service-agnostic. Pass the `service` parameter to specify which service to use.

### 1. List Supported Services

```bash
curl http://localhost:8000/api/oauth/services
```

**Response:**
```json
{
  "success": true,
  "services": [
    {
      "service_id": "hacksaw",
      "name": "Hacksaw",
      "scopes": [...],
      "scope_count": 10
    },
    {
      "service_id": "crm",
      "name": "CRM",
      "scopes": [...],
      "scope_count": 3
    }
  ],
  "total_services": 2
}
```

### 2. Generate Authorization URL

```bash
# Default (Hacksaw)
curl "http://localhost:8000/api/oauth/authorize"

# Specific service
curl "http://localhost:8000/api/oauth/authorize?service=crm"

# Custom redirect URI
curl "http://localhost:8000/api/oauth/authorize?service=hacksaw&redirect_uri=https://example.com/callback"

# Additional scopes
curl "http://localhost:8000/api/oauth/authorize?service=hacksaw&scopes=Hacksaw.admin.READ"
```

**Response:**
```json
{
  "success": true,
  "service": "hacksaw",
  "service_name": "Hacksaw",
  "auth_url": "https://accounts.zoho.in/oauth/v2/auth?...",
  "redirect_uri": "http://localhost:8000/api/oauth/callback",
  "scopes": ["Hacksaw.repository.READ", ...],
  "scope_count": 10
}
```

### 3. OAuth Callback Handler

Automatic handling after user grants permission:

```
http://localhost:8000/api/oauth/callback?code=xxx&service=hacksaw&user_id=user123
```

**Response:**
```json
{
  "success": true,
  "service": "hacksaw",
  "user_id": "user123",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

### 4. Check Authorization Status

```bash
# Default user, Hacksaw
curl "http://localhost:8000/api/oauth/status"

# Specific user and service
curl "http://localhost:8000/api/oauth/status?service=crm&user_id=user456"
```

**Response:**
```json
{
  "success": true,
  "service": "hacksaw",
  "user_id": "user123",
  "authorized": true,
  "token_type": "Bearer",
  "expires_at": 1687443600000
}
```

### 5. Revoke Authorization

```bash
# Via query parameter
curl -X POST "http://localhost:8000/api/oauth/revoke?service=hacksaw&user_id=user123"

# Via request body
curl -X POST "http://localhost:8000/api/oauth/revoke" \
  -H "Content-Type: application/json" \
  -d '{"service": "hacksaw", "user_id": "user123"}'
```

**Response:**
```json
{
  "success": true,
  "message": "OAuth authorization revoked successfully",
  "service": "hacksaw",
  "user_id": "user123"
}
```

---

## OAuth 2.0 Flow

```
┌─────────────┐         Request Auth URL              ┌──────────────┐
│   Client    │─────────────────────────────────────→ │  OAuth API   │
│ (Frontend)  │                                       └──────┬───────┘
└──────┬──────┘                                              │
       │                                           Generate auth_url
       │ Redirect to Zoho OAuth                            │
       │←─────────────────────────────────────────────────┘
       │
       ├──────────────→ https://accounts.zoho.in/oauth/v2/auth
       │               (User logs in and grants permission)
       │
       │ Redirect with authorization code
       └─────────────→ /api/oauth/callback?code=xxx&service=hacksaw
                       │
                       ├─→ Exchange code for token
                       │
                       └─→ Store encrypted token
                           └──→ Return success
```

---

## Frontend Integration Example

```javascript
// Step 1: List available services
async function getServices() {
  const response = await fetch('/api/oauth/services');
  const { services } = await response.json();
  return services;
}

// Step 2: Start OAuth flow
async function authorizeService(serviceName) {
  const response = await fetch(`/api/oauth/authorize?service=${serviceName}`);
  const { auth_url, scopes } = await response.json();
  
  console.log(`Authorizing ${serviceName} with ${scopes.length} scopes`);
  
  // Redirect user to Zoho login
  window.location.href = auth_url;
}

// Step 3: Check authorization status
async function checkAuthorization(serviceName, userId) {
  const response = await fetch(
    `/api/oauth/status?service=${serviceName}&user_id=${userId}`
  );
  const { authorized, expires_at } = await response.json();
  
  return { authorized, expiresAt: expires_at };
}

// Step 4: Use OAuth token for API calls
async function fetchServiceData(serviceName) {
  const response = await fetch(`/api/${serviceName}/violations`);
  return response.json();
}

// Step 5: Revoke access when user logs out
async function logout(serviceName, userId) {
  await fetch(`/api/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: serviceName, user_id: userId })
  });
}
```

---

## Registering a New Service

To add support for a new Zoho service:

```javascript
// In ZohoOAuthManager constructor or via registerService():
zohoOAuth.registerService('zoho-desk', {
  name: 'Zoho Desk',
  scopes: [
    'ZohoDesk.tickets.READ',
    'ZohoDesk.contacts.READ',
    'ZohoDesk.departments.READ',
  ],
});

// Now available via:
// GET /api/oauth/authorize?service=zoho-desk
// GET /api/oauth/status?service=zoho-desk
// POST /api/oauth/revoke?service=zoho-desk
```

---

## Token Management

### Token Storage

Tokens are encrypted and stored per service and user:

```javascript
global.zohoOAuthTokens = {
  'hacksaw:user123': {
    access_token: 'encrypted_token',
    refresh_token: 'encrypted_refresh',
    expires_at: 1687443600000,
    token_type: 'Bearer',
    scope: '...',
  },
  'crm:user456': {
    ...
  }
}
```

### Token Refresh

When a token approaches expiration:
```javascript
const token = zohoOAuth.getOAuthToken(serviceName, userId);
if (token && Date.now() >= token.expires_at) {
  // Token is expired, user needs to re-authorize
  console.log('Token expired, please re-authorize');
}
```

### Token Encryption

All tokens are encrypted using the application's crypto utilities:
- Access tokens: AES encryption
- Refresh tokens: AES encryption
- Plaintext is never stored

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Service not supported` | Invalid service name | Check `/api/oauth/services` for valid IDs |
| `No token to revoke` | User not authorized | Check status first |
| `Token expired` | Token > 1 hour old | User must re-authorize |
| `Missing authorization code` | Bad callback URL | Verify redirect URI matches |

### Error Responses

```json
{
  "error": "Service not supported",
  "message": "Service 'unknown' is not registered",
  "available_services": ["hacksaw", "crm", "projects", "books"]
}
```

---

## Security Features

✅ **Token Encryption** — All tokens encrypted at rest  
✅ **CSRF Protection** — State parameter validation  
✅ **Token Isolation** — Per-service, per-user tokens  
✅ **Expiration Handling** — Automatic validation  
✅ **Secure Revocation** — Complete token cleanup  
✅ **No Hardcoded Secrets** — OAuth eliminates shared credentials  

---

## Migration from Service-Specific OAuth

If you have service-specific OAuth endpoints, migrate to the generic system:

**Before:**
```bash
GET /api/hacksaw/oauth/authorize
GET /api/hacksaw/oauth/callback
GET /api/hacksaw/oauth/status
```

**After:**
```bash
GET /api/oauth/authorize?service=hacksaw
GET /api/oauth/callback?service=hacksaw
GET /api/oauth/status?service=hacksaw
```

All other behavior remains identical.

---

## Architecture

### Core Classes

- **ZohoOAuthManager**: Unified OAuth handler
  - Service registration
  - Token management
  - OAuth flow orchestration

- **Token Storage**: Encrypted in-memory (ready for SQLite/Catalyst)
  - Per-service isolation
  - Per-user isolation
  - Automatic expiration handling

### Extensibility

Add support for any Zoho service:
1. Call `registerService()` with scopes
2. Use standard endpoints with `service=` parameter
3. No code changes needed

---

## FAQ

**Q: Can I use the same OAuth manager for multiple services simultaneously?**
A: Yes. Each service maintains separate tokens per user.

**Q: What happens if I don't pass the `service` parameter?**
A: It defaults to `'hacksaw'` for backward compatibility.

**Q: Can I add custom scopes for a service?**
A: Yes, pass them via the `scopes=` query parameter (comma-separated).

**Q: Are tokens shared between users?**
A: No. Each user gets their own encrypted token per service.

**Q: What if I want to add a service that's not in the predefined list?**
A: Call `registerService()` with the name and scopes. It works immediately.

---

## Production Checklist

- [ ] Enable HTTPS (OAuth requires secure redirect URIs in production)
- [ ] Implement persistent token storage (SQLite or Catalyst)
- [ ] Set up token refresh background job (for long-running services)
- [ ] Configure rate limiting on OAuth endpoints
- [ ] Monitor token revocation events
- [ ] Test multi-service scenarios
- [ ] Document service-specific scopes for your team