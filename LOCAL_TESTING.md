# Local Testing Guide - WSM-Security OAuth Flow

Test the complete OAuth flow on your local machine before deploying to Catalyst.

## **Prerequisites**

- Node.js v18+ (check with `node -v`)
- npm or yarn
- A Zoho account for testing
- Port 3000 (frontend) and 8000 (backend) available locally

---

## **Step 1: Create Local OAuth Test Application**

### Register OAuth App for Localhost

1. Go to **Zoho API Console** → https://api.console.zoho.in
2. Create a new OAuth application:
   - **Application Name:** `WSM-Security-Local` (or similar)
   - **Homepage URL:** `http://localhost:3000`
   - **Authorized Redirect URLs:**
     ```
     http://localhost:8000/api/auth/callback
     ```

3. **Copy the generated:**
   - `Client ID` (save it)
   - `Client Secret` (save it)

⚠️ **Keep these credentials safe!** They're for local testing only.

---

## **Step 2: Create Backend .env File**

Create `backend/.env` (copy from `.env.example` and update):

```bash
cd /Users/praveen-8915/otherProducts/wsm_security/backend

# Copy the template
cp functions/server/.env.example .env

# Wait, the .env needs to be in functions/server/ directory
# Let me create it there instead
```

**Actually, create it here:**

```bash
cd /Users/praveen-8915/otherProducts/wsm_security/backend/functions/server

cat > .env << 'ENVEOF'
# Catalyst Configuration
CATALYST_PROJECT_ID=47976000000030001
ENVIRONMENT=development
PORT=8000

# OAuth 2.0 (Local Testing)
ZOHO_CLIENT_ID=your_test_client_id_here
ZOHO_CLIENT_SECRET=your_test_client_secret_here
ZOHO_REDIRECT_URI=http://localhost:8000/api/auth/callback
ZOHO_AUTH_URL=https://accounts.zoho.in/oauth/v2/auth
ZOHO_TOKEN_URL=https://accounts.zoho.in/oauth/v2/token
ZOHO_API_URL=https://www.zohoapis.in

# Token Configuration
TOKEN_EXPIRY_HOURS=24
REFRESH_TOKEN_EXPIRY_DAYS=30
TOKEN_ENCRYPTION_KEY=test-key-change-in-production
ENVEOF
```

**Replace with your test credentials:**
- `your_test_client_id_here` → Paste your Client ID from Step 1
- `your_test_client_secret_here` → Paste your Client Secret from Step 1

---

## **Step 3: Install Dependencies**

### Backend
```bash
cd /Users/praveen-8915/otherProducts/wsm_security/backend/functions/server
npm install dotenv
npm install
```

### Frontend
```bash
cd /Users/praveen-8915/otherProducts/wsm_security/frontend
npm install
```

---

## **Step 4: Start Backend (Terminal 1)**

```bash
cd /Users/praveen-8915/otherProducts/wsm_security/backend/functions/server

# Start the Express server
node index.js
```

**Expected output:**
```
🚀 WSM-Security API initialized
📋 Config: { projectId: '✓ set', oauth: '✓ enabled', ... }
Listening on port 8000
```

✅ If you see this, backend is running!

---

## **Step 5: Start Frontend (Terminal 2)**

```bash
cd /Users/praveen-8915/otherProducts/wsm_security/frontend

# Start Vite dev server
npm run dev
```

**Expected output:**
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
  ➜  press h to show help
```

✅ If you see this, frontend is running!

---

## **Step 6: Test Health Endpoint**

In a new terminal, verify the backend is responding:

```bash
curl http://localhost:8000/api/health
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

✅ If you see `"oauth": "✓ enabled"`, OAuth is configured correctly!

---

## **Step 7: Test OAuth Flow in Browser**

1. Open your browser to **http://localhost:3000/**
2. You should see the login page with "Sign In with Zoho" button
3. Click **"Sign In with Zoho"**
4. You'll be redirected to Zoho login
5. **Sign in with your Zoho account** (email + password)
6. After authentication, you'll be redirected back to **http://localhost:3000/**
7. The page should now show "Welcome" (authenticated)

✅ If you see this, OAuth flow is working!

---

## **Step 8: Verify Token Storage**

After successful login, check browser localStorage:

1. Open browser DevTools (F12)
2. Go to **Application** → **Local Storage** → **http://localhost:3000**
3. You should see:
   - `authToken` - Encrypted token
   - `user` - User profile JSON

✅ If you see these, token storage is working!

---

## **Step 9: Test Protected Endpoints**

Get your token and test an authenticated endpoint:

```bash
# Get the authToken from localStorage and run:
curl -H "Authorization: Bearer <paste-authToken-here>" \
  http://localhost:8000/api/profile
```

**Expected response:**
```json
{
  "profile": {
    "user_id": "user123",
    "name": "Creator",
    "email": "creator@example.com"
  }
}
```

✅ If you see this, authentication is working!

---

## **Troubleshooting Local Testing**

### ❌ "Cannot GET /api/health"

**Problem:** Backend not running
**Solution:**
```bash
cd backend/functions/server
node index.js
```

### ❌ "EADDRINUSE: address already in use :::8000"

**Problem:** Port 8000 is already in use
**Solution:**
```bash
# Find what's using port 8000
lsof -i :8000

# Kill the process
kill -9 <PID>

# Or start backend on different port:
PORT=9000 node index.js
```

### ❌ "Failed to get login URL" or "Cannot fetch /api/auth/login-url"

**Problem:** Frontend can't reach backend
**Solution:**
1. Check backend is running (`node index.js` in terminal 1)
2. Check `VITE_API_URL` in `.env.development` is set to `http://localhost:8000/api`
3. Verify Vite dev server proxy is working in `vite.config.js`

### ❌ "Invalid client ID" from Zoho

**Problem:** OAuth credentials don't match
**Solution:**
1. Copy Client ID & Secret again from Zoho API Console
2. Update `.env` file
3. Restart backend (`Ctrl+C` then `node index.js`)

### ❌ "Redirect URI mismatch"

**Problem:** Registered redirect URI doesn't match
**Solution:**
1. Check Zoho API Console has: `http://localhost:8000/api/auth/callback`
2. Check `.env` file has: `ZOHO_REDIRECT_URI=http://localhost:8000/api/auth/callback`
3. Should match exactly (including http:// and port)

### ❌ Token appears but can't call protected endpoints

**Problem:** Token encryption/decryption issue
**Solution:**
1. Check `TOKEN_ENCRYPTION_KEY` in `.env` is set
2. Verify `crypto.js` encryption/decryption functions work
3. Try clearing localStorage and login again

---

## **Next Steps After Local Testing**

Once local testing works:

1. ✅ Test OAuth locally
2. ✅ Test token storage & encryption
3. ✅ Test protected endpoints
4. 📋 Deploy to Catalyst (Slate + Serverless)
5. 📋 Update environment variables in Catalyst
6. 📋 Test in production

---

## **Quick Commands Reference**

```bash
# Terminal 1: Start Backend
cd backend/functions/server && node index.js

# Terminal 2: Start Frontend
cd frontend && npm run dev

# Terminal 3: Test Health
curl http://localhost:8000/api/health

# Terminal 3: Test Login URL
curl http://localhost:8000/api/auth/login-url

# Terminal 3: Test Protected Endpoint (with token)
curl -H "Authorization: Bearer <token>" \
  http://localhost:8000/api/profile
```

---

## **Files You Need to Create**

```
backend/functions/server/.env       ← Create this (copy from .env.example)
```

Everything else is already in git!

---

Ready to test locally? Follow the steps above and let me know if you hit any issues!
