# Quick Start - Local Testing

Get WSM-Security running locally in 5 minutes!

## **1️⃣ Create Test OAuth Application (2 min)**

Go to **Zoho API Console** → https://api.console.zoho.in

1. Create new OAuth application:
   - **Name:** `WSM-Security-Local`
   - **Homepage:** `http://localhost:3000`
   - **Redirect URI:** `http://localhost:8000/api/auth/callback`

2. Copy your **Client ID** and **Client Secret**

---

## **2️⃣ Configure Local Environment (1 min)**

```bash
cd backend/functions/server

# Copy the template
cp .env.example .env

# Edit .env with your test credentials
# Replace:
#   ZOHO_CLIENT_ID=your_test_client_id_here
#   ZOHO_CLIENT_SECRET=your_test_client_secret_here
```

---

## **3️⃣ Install Dependencies (1 min)**

```bash
./setup-local.sh
```

Or manually:
```bash
# Backend
cd backend/functions/server && npm install dotenv && npm install

# Frontend
cd frontend && npm install
```

---

## **4️⃣ Start Backend (Terminal 1)**

```bash
./start-backend.sh
```

**Expected output:**
```
🚀 Server listening on http://localhost:8000
📋 Health check: http://localhost:8000/api/health
🔐 OAuth enabled: Yes
🔗 Redirect URI: http://localhost:8000/api/auth/callback
```

✅ If you see this, backend is ready!

---

## **5️⃣ Start Frontend (Terminal 2)**

```bash
./start-frontend.sh
```

**Expected output:**
```
VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:3000/
```

✅ If you see this, frontend is ready!

---

## **6️⃣ Test in Browser**

1. Open **http://localhost:3000**
2. Click **"Sign In with Zoho"**
3. Sign in with your Zoho account
4. Should see authenticated app

✅ If login works, OAuth is configured correctly!

---

## **Quick Commands**

| Command | What it does |
|---------|------------|
| `./setup-local.sh` | Install all dependencies |
| `./start-backend.sh` | Start backend on http://localhost:8000 |
| `./start-frontend.sh` | Start frontend on http://localhost:3000 |
| `curl http://localhost:8000/api/health` | Check backend health |

---

## **Troubleshooting**

**"Cannot find module 'dotenv'"**
```bash
cd backend/functions/server
npm install dotenv
```

**"Port 8000 already in use"**
```bash
# Edit .env and change PORT=9000
# Or kill the process:
lsof -i :8000
kill -9 <PID>
```

**"OAuth not enabled"**
- Check `.env` file has `ZOHO_CLIENT_ID` set
- Verify file is in `backend/functions/server/.env`
- Restart backend after editing

**"Redirect URI mismatch"**
- Zoho OAuth Console: `http://localhost:8000/api/auth/callback`
- `.env` file: `ZOHO_REDIRECT_URI=http://localhost:8000/api/auth/callback`
- Must match exactly!

---

## **Full Documentation**

- **LOCAL_TESTING.md** — Detailed testing guide with all steps
- **DEPLOYMENT_SETUP.md** — How to deploy to Catalyst
- **CATALYST_SETUP.md** — Catalyst configuration reference

---

## **Next Steps**

After local testing works:
1. ✅ Test OAuth locally
2. 📋 Deploy to Catalyst
3. 📋 Connect Datastore (save users/tasks)
4. 📋 Build features (tasks, documents, team)

Good luck! 🚀
