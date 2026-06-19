# Local Testing Guide - WSM-Security OAuth Flow (Connections Pattern)

Test the OAuth flow locally using the Connections Manager pattern (similar to agent-knowledge-kit).

## **Prerequisites**

- Node.js v18+ (check with `node -v`)
- npm
- A Zoho account for testing (India datacenter)
- Ports 3000 (frontend) and 8000 (backend) available

---

## **Step 1: Create Test OAuth Application**

### Register OAuth App for Your Zoho Region

1. Go to **Zoho API Console** → https://api.console.zoho.in (for India)
   - Or https://api.console.zoho.com (for US)
   - Or https://api.console.zoho.eu (for Europe)

2. Create new OAuth application:
   - **Application Name:** `WSM-Security-Local`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorized Redirect URLs:** `http://localhost:8000/api/auth/callback`

3. **Copy:**
   - `Client ID`
   - `Client Secret`

---

## **Step 2: Create Backend .env File**

```bash
cd /Users/praveen-8915/otherProducts/wsm_security/backend/functions/server

cat > .env << 'ENVEOF'
CATALYST_PROJECT_ID=47976000000030001
ENVIRONMENT=development
PORT=8000

# Select your Zoho region
ZOHO_PROFILE=in

# Your test credentials (from Step 1)
ZOHO_CLIENT_ID_IN=paste_your_client_id_here
ZOHO_CLIENT_SECRET_IN=paste_your_client_secret_here

TOKEN_EXPIRY_HOURS=24
REFRESH_TOKEN_EXPIRY_DAYS=30
TOKEN_ENCRYPTION_KEY=test-key-change-in-production
ENVEOF
```

**Replace:**
- `paste_your_client_id_here` → Your Client ID
- `paste_your_client_secret_here` → Your Client Secret

---

## **Step 3: How It Works**

The Connections Manager loads `connections.config.json` which defines:

```json
{
  "services": {
    "wsm-security": {
      "scope": "userprofile.read",
      "redirect_port": 8000
    }
  },
  "profiles": {
    "in": {
      "accounts_domain": "accounts.zoho.in",
      "api_domain": "www.zohoapis.in"
    },
    "us": {
      "accounts_domain": "accounts.zoho.com",
      "api_domain": "www.zohoapis.com"
    }
  },
  "credentials": {
    "in": {
      "client_id": "${ZOHO_CLIENT_ID_IN}",
      "client_secret": "${ZOHO_CLIENT_SECRET_IN}"
    }
  }
}
```

The Connection Manager:
1. ✅ Reads from `connections.config.json`
2. ✅ Selects profile based on `ZOHO_PROFILE` env var
3. ✅ Resolves credentials from environment variables
4. ✅ Handles OAuth flow for multiple regions
5. ✅ Automatically uses correct Zoho endpoints

---

## **Step 4: Install Dependencies**

```bash
cd /Users/praveen-8915/otherProducts/wsm_security

# Install everything
./setup-local.sh

# Or manually:
cd backend/functions/server && npm install dotenv && npm install
cd ../../.. && cd frontend && npm install
```

---

## **Step 5: Start Backend**

```bash
./start-backend.sh
```

**Expected output:**
```
✅ Connection Manager initialized
📋 Connection Info: { 
  profile: 'in',
  service: 'wsm-security',
  datacenter: 'in',
  timezone: 'Asia/Kolkata',
  redirect_port: 8000
}
🔐 OAuth 2.0 enabled via Connection Manager
🚀 Server listening on http://localhost:8000
📋 Health check: http://localhost:8000/api/health
```

---

## **Step 6: Start Frontend**

```bash
./start-frontend.sh
```

**Expected output:**
```
VITE v5.x.x ready in xxx ms
  ➜  Local:   http://localhost:3000/
```

---

## **Step 7: Test Health Endpoint**

```bash
curl http://localhost:8000/api/health
```

**Expected response:**
```json
{
  "status": "ok",
  "message": "WSM-Security API Running",
  "oauth_enabled": true,
  "connection": {
    "profile": "in",
    "service": "wsm-security",
    "datacenter": "in",
    "timezone": "Asia/Kolkata",
    "redirect_port": 8000
  }
}
```

✅ If you see this, Connection Manager is working!

---

## **Step 8: Test OAuth Flow**

1. Open **http://localhost:3000/**
2. Click **"Sign In with Zoho"**
3. Sign in with your Zoho account
4. After login, should see authenticated content

✅ If login works, OAuth is configured correctly!

---

## **Step 9: Test Protected Endpoints**

Get your token from localStorage and test:

```bash
curl -H "Authorization: Bearer <encrypted-token>" \
  http://localhost:8000/api/profile
```

**Expected response:**
```json
{
  "profile": {
    "user_id": "user123",
    "name": "Your Name",
    "email": "your.email@zoho.in"
  }
}
```

✅ If you see this, authentication is working!

---

## **Switching Regions (Optional)**

To test with different Zoho datacenters:

### **For US:**
```bash
# In .env:
ZOHO_PROFILE=us
ZOHO_CLIENT_ID_US=your_us_client_id
ZOHO_CLIENT_SECRET_US=your_us_client_secret

# Create US OAuth app at: https://api.console.zoho.com
```

### **For Europe:**
```bash
# In .env:
ZOHO_PROFILE=eu
ZOHO_CLIENT_ID_EU=your_eu_client_id
ZOHO_CLIENT_SECRET_EU=your_eu_client_secret

# Create EU OAuth app at: https://api.console.zoho.eu
```

Then restart backend: `Ctrl+C` and `./start-backend.sh`

---

## **Troubleshooting**

### ❌ "Connection Manager not available"

**Problem:** `connections.config.json` not found
**Solution:**
```bash
ls -la backend/connections.config.json
# Should exist in backend directory (not functions/server)
```

### ❌ "Invalid profile: in"

**Problem:** Profile name doesn't match
**Solution:**
```bash
# Check available profiles in connections.config.json
# Valid: in, us, eu
# In .env, set: ZOHO_PROFILE=in
```

### ❌ "Environment variable not set: ZOHO_CLIENT_ID_IN"

**Problem:** Missing environment variable
**Solution:**
```bash
# Check .env file has:
ZOHO_CLIENT_ID_IN=your_actual_client_id
ZOHO_CLIENT_SECRET_IN=your_actual_secret

# Restart backend after editing .env
```

### ❌ "Redirect URI mismatch"

**Problem:** Registered redirect URI doesn't match
**Solution:**
1. Zoho API Console: `http://localhost:8000/api/auth/callback`
2. Backend: Automatically uses correct URI from connections config
3. Should match automatically!

---

## **Connection Manager Features**

The Connections Manager (similar to agent-knowledge-kit):

✅ **Multi-Region Support** — Switch between in/us/eu with one env var  
✅ **Service Definitions** — Scopes and configuration per service  
✅ **Profile-Based** — Automatic datacenter & timezone management  
✅ **Credential Resolution** — Environment variable placeholders  
✅ **OAuth Standardization** — Consistent flow across all regions  
✅ **State Protection** — CSRF tokens for OAuth security  

---

## **Next Steps**

1. ✅ Test locally with Connections Manager
2. 📋 Deploy to Catalyst
3. 📋 Connect Catalyst Datastore
4. 📋 Build features (tasks, documents, team)

Good luck! 🚀
