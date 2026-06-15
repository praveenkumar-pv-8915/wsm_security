# Slate + Catalyst Serverless Setup Guide

This document explains how to deploy your Team Management App on Catalyst's Slate (frontend) and Serverless Functions (backend).

## Architecture Overview

```
┌─────────────────────┐
│   React Frontend    │  (Deployed on Slate)
│   (Static Assets)   │
└──────────┬──────────┘
           │ API calls
           ▼
┌─────────────────────────────────────────┐
│  Catalyst Serverless Functions          │
│  ├─ /functions/health/GET.js            │
│  ├─ /functions/profile/{GET,POST}.js    │
│  └─ /functions/tasks/{GET,POST,[id]}/   │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────┐
│   Catalyst          │
│   Datastore         │  (PostgreSQL)
│   (creators, tasks) │
└─────────────────────┘
```

## Prerequisites

1. Catalyst account and CLI installed
2. Node.js 18+ 
3. npm or yarn
4. Git

## Deployment Steps

### Step 1: Deploy Backend (Catalyst Serverless Functions)

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Deploy to Catalyst:**
   ```bash
   catalyst deploy
   ```
   
   This will:
   - Create the datastore tables (creators, tasks)
   - Deploy all serverless functions
   - Generate your API endpoint (e.g., `https://project-id.catalyst.zoho.com`)

4. **Note your API endpoint** - you'll need it for the frontend.

### Step 2: Deploy Frontend (Slate)

1. **Navigate to frontend directory:**
   ```bash
   cd ../frontend
   ```

2. **Update environment configuration:**
   
   Open `frontend/.env.production` and replace:
   ```
   VITE_API_URL=https://YOUR-CATALYST-PROJECT-ID.catalyst.zoho.com
   VITE_SAS_AUTH_URL=https://accounts.zoho.com/oauth/v2/auth
   ```
   
   Use the API endpoint from Step 1.

3. **Build the application:**
   ```bash
   npm run build
   ```

4. **Deploy to Slate:**
   ```bash
   catalyst deploy
   ```
   
   This will:
   - Build your React app
   - Deploy static assets to Slate
   - Generate your frontend URL (e.g., `https://your-app.onslate.in`)

### Step 3: Configure CORS (if needed)

If you encounter CORS issues, update the Catalyst project settings to allow your Slate domain.

## Environment Variables

### Frontend (.env files)

| Variable | Purpose | Example |
|----------|---------|---------|
| `VITE_API_URL` | Catalyst serverless endpoint | `https://wsm-security.catalyst.zoho.com` |
| `VITE_SAS_AUTH_URL` | Zoho auth endpoint | `https://accounts.zoho.com/oauth/v2/auth` |

### Backend (catalyst.json)

Already configured with required Catalyst SDK integration.

## API Endpoints

After deployment, your API endpoints will be:

```
GET    /api/health                    - Health check
GET    /api/profile                   - Get user profile
POST   /api/profile                   - Create/update profile
GET    /api/tasks                     - List user's tasks
POST   /api/tasks                     - Create new task
GET    /api/tasks/[id]                - Get specific task
PUT    /api/tasks/[id]                - Update task
DELETE /api/tasks/[id]                - Delete task
```

## Local Development

### Running Locally

1. **Terminal 1 - Backend (Catalyst Local):**
   ```bash
   cd backend
   npm install
   catalyst local
   ```

2. **Terminal 2 - Frontend (Vite Dev):**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

Frontend will proxy API calls to localhost:8000 (Catalyst local).

### Testing Auth Headers

When testing, ensure you send:
```
Authorization: Bearer YOUR_TOKEN
X-User-ID: user-identifier
```

## Troubleshooting

### Issue: CORS errors
**Solution:** Check your Catalyst project's CORS settings and add your Slate domain.

### Issue: 401 Unauthorized
**Solution:** Ensure request headers include valid Authorization and X-User-ID headers.

### Issue: Tasks table not found
**Solution:** Run `catalyst deploy` from the backend directory to ensure datastore tables are created.

### Issue: Frontend can't reach backend
**Solution:** Verify `VITE_API_URL` in .env.production matches your Catalyst project endpoint.

## Monitoring & Debugging

1. **Check function logs:**
   ```bash
   catalyst logs --function health/GET
   ```

2. **View datastore records:**
   ```bash
   catalyst datastore:view creators
   catalyst datastore:view tasks
   ```

3. **Monitor function metrics:**
   Use the Catalyst dashboard to view invocation counts, errors, and latency.

## Next Steps

1. ✅ Deploy backend functions
2. ✅ Deploy frontend on Slate
3. Implement additional features (docs, notifications, etc.)
4. Set up CI/CD for automatic deployments
5. Configure custom domain if needed

## Resources

- [Catalyst Documentation](https://catalyst.zoho.com/)
- [Catalyst CLI Commands](https://catalyst.zoho.com/docs/)
- [Slate Features](https://catalyst.zoho.com/slate)
