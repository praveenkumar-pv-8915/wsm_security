# Catalyst Environment Configuration Setup

This guide explains how to set up environment variables in Catalyst Console for the WSM-Security API.

## Required Environment Variables

The backend requires these environment variables to be set in Catalyst:

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `CATALYST_PROJECT_ID` | Your Catalyst project ID | `47976000000030001` | ✅ Yes |
| `CATALYST_API_KEY` | API key for Catalyst services | (provided by Zoho) | ⚠️ Optional |
| `CATALYST_API_URL` | API endpoint URL | `https://api.zoho.in` | ❌ No (defaults to India DC) |
| `ENVIRONMENT` | Deployment environment | `production` | ❌ No (defaults to development) |

---

## Step 1: Find Your Catalyst Project ID

1. Go to **Zoho Catalyst Console** → https://catalyst.zoho.in
2. Select your **WSM-Security** project
3. In the project dashboard, find your **Project ID** (visible in the URL or dashboard header)
4. Example: `47976000000030001`

---

## Step 2: Set Environment Variables in Catalyst Console

### **For the `server` Function:**

1. Go to **Catalyst Console** → **WSM-Security Project**
2. Navigate to **Functions** → **server** (or your function name)
3. Click the **⚙️ Settings** icon or **Environment Variables** tab
4. Click **Add Variable** and enter:

   ```
   Variable Name: CATALYST_PROJECT_ID
   Value: 47976000000030001
   ```

5. (Optional) Add API key if needed:

   ```
   Variable Name: CATALYST_API_KEY
   Value: (your API key)
   ```

6. (Optional) Specify data center:

   ```
   Variable Name: CATALYST_API_URL
   Value: https://api.zoho.in
   ```

   Valid values:
   - `https://api.zoho.in` — India (default)
   - `https://api.zoho.com` — US
   - `https://api.zoho.eu` — Europe
   - `https://api.zoho.ae` — Middle East
   - `https://api.zoho.uk` — UK
   - `https://api.zoho.jp` — Japan
   - `https://api.zoho.com.au` — Australia

7. Click **Save**

---

## Step 3: Verify Configuration

Call the health endpoint to verify environment variables are loaded:

```bash
curl https://your-catalyst-domain/api/health
```

Expected response:
```json
{
  "status": "ok",
  "message": "WSM-Security API Running",
  "config": {
    "projectId": "✓ set",
    "apiKey": "✗ missing",
    "environment": "development",
    "apiUrl": "https://api.zoho.in"
  }
}
```

If `projectId` shows `✗ missing`, go back to Step 2 and add it.

---

## Step 4: Local Development (Optional)

For local testing, create a `.env` file in `backend/`:

```bash
# backend/.env
CATALYST_PROJECT_ID=47976000000030001
CATALYST_API_KEY=
CATALYST_API_URL=https://api.zoho.in
ENVIRONMENT=development
PORT=8000
```

**Important:** Add `.env` to `.gitignore` so credentials aren't committed:

```bash
# backend/.gitignore
.env
.env.local
*.log
node_modules/
```

Install dotenv in the backend (optional for local testing):

```bash
cd backend/functions/server
npm install dotenv
```

Then in your code, load it at the top:

```javascript
require('dotenv').config();
```

---

## Troubleshooting

### ❌ "Missing required environment variables" on deployment

**Solution:**
1. Go to Catalyst Console → Functions → Environment Variables
2. Verify that `CATALYST_PROJECT_ID` is set
3. Check for typos (variable names are case-sensitive)
4. Redeploy the function after changes

### ❌ "Cannot connect to API"

**Solution:**
1. Verify `CATALYST_API_URL` matches your data center
2. Check that your API key (if set) is valid
3. Ensure your Catalyst project is active and not archived

### ✓ Health endpoint shows all required variables

Great! Your configuration is correct. You can now:
- Deploy the API to Catalyst
- Call API endpoints
- Extend with Datastore when needed

---

## Security Best Practices

✅ **Do:**
- Store credentials in Catalyst Environment Variables
- Use different credentials for dev/staging/production
- Rotate API keys periodically
- Never commit `.env` files to git

❌ **Don't:**
- Hardcode credentials in source files
- Commit `.env` files to version control
- Share your Project ID publicly
- Use the same credentials across environments

---

## Next Steps

Once environment variables are configured:

1. **Deploy the function** to Catalyst (via GitHub auto-deployment)
2. **Test the API** by calling `/api/health`
3. **Build features** (task tracking, documents, etc.)
4. **Add org isolation** when needed (for multi-tenant support)

---

## OAuth 2.0 Setup (Optional - For User Authentication)

To enable OAuth authentication with Zoho accounts:

### **Step 1: Register Application in Zoho API Console**

1. Go to **Zoho API Console** → https://api.console.zoho.in
2. Create a new **OAuth Application**:
   - **Application Name:** WSM-Security
   - **Homepage URL:** `https://your-catalyst-domain`
   - **Authorized Redirect URLs:** `https://your-catalyst-domain/api/auth/callback`
3. Copy the generated **Client ID** and **Client Secret**

### **Step 2: Set OAuth Environment Variables in Catalyst**

Go to **Catalyst Console** → **Functions** → **server** → **Environment Variables**

Add the following:

```
Variable Name: ZOHO_CLIENT_ID
Value: (your client ID from Step 1)

Variable Name: ZOHO_CLIENT_SECRET
Value: (your client secret from Step 1)

Variable Name: ZOHO_REDIRECT_URI
Value: https://your-catalyst-domain/api/auth/callback

Variable Name: ZOHO_AUTH_URL
Value: https://accounts.zoho.in/oauth/v2/auth

Variable Name: ZOHO_TOKEN_URL
Value: https://accounts.zoho.in/oauth/v2/token

Variable Name: ZOHO_API_URL
Value: https://www.zohoapis.in

Variable Name: TOKEN_ENCRYPTION_KEY
Value: (change to a secure random string in production)
```

### **Step 3: Test OAuth Login**

1. Navigate to your app in the browser
2. Click **"Sign In with Zoho"**
3. You should be redirected to Zoho login
4. After login, you should return to the app authenticated

### **Token Storage Flow**

```
User clicks "Sign In"
    ↓
Frontend calls /api/auth/login-url (gets Zoho auth URL)
    ↓
Frontend redirects to Zoho login (user enters credentials)
    ↓
Zoho redirects back with authorization code
    ↓
Frontend receives code & calls /api/auth/callback
    ↓
Backend exchanges code for token (server-side, secret is safe)
    ↓
Backend encrypts token & returns to frontend
    ↓
Frontend stores encrypted token in localStorage
    ↓
All API requests include token in Authorization header
    ↓
Backend validates token on each request
```

### **Token Encryption Details**

- Tokens are encrypted with AES-256-GCM before storage
- Encryption key from `TOKEN_ENCRYPTION_KEY` environment variable
- Frontend stores encrypted token (safe even if localStorage is compromised)
- Backend decrypts token on each request

### **Security Checklist**

✅ **Do:**
- Use strong `TOKEN_ENCRYPTION_KEY` in production
- Rotate encryption keys periodically
- Use HTTPS only (Catalyst provides this)
- Store refresh tokens server-side (TODO: implement)
- Validate token expiry

❌ **Don't:**
- Share Client Secret publicly
- Hardcode credentials in frontend code
- Use default encryption key in production
- Store unencrypted tokens

