# WSM-Security Deployment & Configuration Guide

Your application is deployed on Catalyst with both Slate (frontend) and Serverless (backend).

## **Your Application URLs**

| Component | URL | Type |
|-----------|-----|------|
| **Frontend (Slate)** | `https://wsm-security.onslate.in/` | React App |
| **Backend (Serverless)** | `https://wsm-security-60073792083.development.catalystserverless.in/server/server/execute` | Express API |

---

## **Step 1: Set Up OAuth Application in Zoho**

### Register Your Application

1. Go to **Zoho API Console** → https://api.console.zoho.in
2. Click **Create OAuth Application**
3. Fill in the details:
   - **Application Name:** `WSM-Security`
   - **Homepage URL:** `https://wsm-security.onslate.in/`
   - **Authorized Redirect URLs:**
     ```
     https://wsm-security-60073792083.development.catalystserverless.in/server/server/execute/api/auth/callback
     ```

4. Click **Create**
5. **Copy the generated:**
   - `Client ID`
   - `Client Secret`

⚠️ **Save these values securely!** You'll need them in the next step.

---

## **Step 2: Configure Environment Variables in Catalyst**

### In Catalyst Console:

1. Go to **Catalyst Console** → https://catalyst.zoho.in
2. Select **WSM-Security** project
3. Navigate to **Functions** → **server**
4. Click **Settings** → **Environment Variables**
5. Add all of the following variables:

#### **Required Variables**

```
CATALYST_PROJECT_ID = 47976000000030001

ZOHO_CLIENT_ID = (paste your Client ID from Step 1)
ZOHO_CLIENT_SECRET = (paste your Client Secret from Step 1)

ZOHO_REDIRECT_URI = https://wsm-security-60073792083.development.catalystserverless.in/server/server/execute/api/auth/callback
```

#### **OAuth URLs** (Copy exactly)

```
ZOHO_AUTH_URL = https://accounts.zoho.in/oauth/v2/auth
ZOHO_TOKEN_URL = https://accounts.zoho.in/oauth/v2/token
ZOHO_API_URL = https://www.zohoapis.in
```

#### **Token Configuration**

```
TOKEN_EXPIRY_HOURS = 24
REFRESH_TOKEN_EXPIRY_DAYS = 30
TOKEN_ENCRYPTION_KEY = your-secure-random-key-here
```

(Generate a random string for the encryption key, e.g., using a password generator)

#### **Optional Variables**

```
CATALYST_API_URL = https://api.zoho.in
ENVIRONMENT = development
```

### Save Configuration

1. Click **Save** after adding all variables
2. The backend function will reload with new environment variables

---

## **Step 3: Verify Configuration**

### Test the Health Endpoint

```bash
curl https://wsm-security-60073792083.development.catalystserverless.in/server/server/execute/api/health
```

**Expected response:**
```json
{
  "status": "ok",
  "message": "WSM-Security API Running",
  "config": {
    "projectId": "✓ set",
    "oauth": "✓ enabled",
    "apiKey": "✗ missing",
    "environment": "development",
    "apiUrl": "https://api.zoho.in"
  }
}
```

If `oauth` shows `✓ enabled`, configuration is correct!

---

## **Step 4: Test OAuth Flow**

1. Open your app in browser: `https://wsm-security.onslate.in/`
2. Click **"Sign In with Zoho"**
3. You should be redirected to Zoho login
4. Sign in with your Zoho account
5. After login, you should return to the app authenticated

---

## **Frontend API Configuration**

The frontend automatically uses the correct API URL:

- **Development:** `http://localhost:8000/api` (local testing)
- **Production:** `/api` (relative path, same domain as Slate)

No additional frontend configuration needed!

---

## **Environment Variables Summary**

| Variable | Purpose | Where to Get |
|----------|---------|--------------|
| `CATALYST_PROJECT_ID` | Identify your Catalyst project | Catalyst Console |
| `ZOHO_CLIENT_ID` | OAuth application ID | Zoho API Console |
| `ZOHO_CLIENT_SECRET` | OAuth secret (keep secure!) | Zoho API Console |
| `ZOHO_REDIRECT_URI` | Where Zoho redirects after login | Your serverless URL (provided above) |
| `ZOHO_AUTH_URL` | Zoho OAuth authorization endpoint | Use provided URL |
| `ZOHO_TOKEN_URL` | Zoho OAuth token endpoint | Use provided URL |
| `ZOHO_API_URL` | Zoho API base URL | Use provided URL |
| `TOKEN_ENCRYPTION_KEY` | Encrypt tokens before storage | Generate random string |

---

## **Security Best Practices**

✅ **Do:**
- Store credentials ONLY in Catalyst Environment Variables
- Use a strong `TOKEN_ENCRYPTION_KEY` (minimum 32 characters)
- Rotate encryption keys regularly
- Never commit `.env` files to git
- Use HTTPS only (Catalyst provides this)

❌ **Don't:**
- Share your `ZOHO_CLIENT_SECRET` publicly
- Commit credentials to version control
- Use default/weak encryption keys
- Store unencrypted tokens
- Hardcode URLs in code

---

## **Troubleshooting**

### ❌ "OAuth not configured" error

**Solution:**
1. Verify all OAuth variables are set in Catalyst Console
2. Check for typos in variable names (case-sensitive)
3. Confirm `ZOHO_REDIRECT_URI` exactly matches your serverless URL
4. Redeploy function after changes

### ❌ "Invalid redirect URI" from Zoho

**Solution:**
1. Go to Zoho API Console
2. Check that your registered redirect URI matches exactly:
   ```
   https://wsm-security-60073792083.development.catalystserverless.in/server/server/execute/api/auth/callback
   ```
3. Update if needed
4. Wait a few minutes for changes to propagate

### ❌ "Cannot connect to API"

**Solution:**
1. Verify frontend can reach backend
2. Check that Slate frontend is configured to call `/api/...` endpoints
3. Verify Catalyst function is deployed and running
4. Check browser console (F12) for actual error messages

### ✅ Login successful!

If you can log in and see authenticated content, everything is working!

---

## **API Endpoints**

| Endpoint | Method | Purpose | Auth Required |
|----------|--------|---------|----------------|
| `/api/health` | GET | Health check | ❌ No |
| `/api/auth/login-url` | GET | Get Zoho OAuth URL | ❌ No |
| `/api/auth/callback` | POST | Exchange code for token | ❌ No |
| `/api/profile` | GET | Get user profile | ✅ Yes |
| `/api/profile` | POST | Update user profile | ✅ Yes |
| `/api/tasks` | GET | List user's tasks | ✅ Yes |
| `/api/tasks` | POST | Create new task | ✅ Yes |

---

## **Next Steps**

1. ✅ Set up OAuth application in Zoho
2. ✅ Configure environment variables in Catalyst
3. ✅ Test health endpoint
4. ✅ Test OAuth login flow
5. 📋 Connect Catalyst Datastore (save users/tasks)
6. 📋 Build task management features
7. 📋 Build document management features

Ready to proceed?
