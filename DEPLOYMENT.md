# Deployment Guide - Creator App to Zoho Catalyst

## Prerequisites

1. **Catalyst CLI** installed locally (requires Node 14+)
2. **Zoho Catalyst Account** with your org credentials
3. **Zoho SAS Application** configured (for authentication)

## Step 1: Install Catalyst CLI

```bash
npm install -g zcatalyst-cli
```

If you get Node version errors, upgrade Node.js first:
```bash
# Using nvm
nvm install 18
nvm use 18
```

## Step 2: Login to Catalyst

```bash
cd /Users/praveen-8915/creator-app
zcatalyst login
```

This opens a browser to authenticate. Select your Catalyst org.

## Step 3: Initialize Catalyst Project

```bash
zcatalyst init
```

Follow the prompts and select:
- **App Name**: `creator-app`
- **Folder Structure**: Select the default structure
- **Framework**: Node.js for backend, React for frontend

## Step 4: Configure Environment Variables

Create `.env` files with your Catalyst credentials:

**backend/.env:**
```
CATALYST_ENABLE_DATASTORE=true
NODE_ENV=production
PORT=8000
```

**frontend/.env:**
```
VITE_API_URL=https://<your-catalyst-domain>/api
VITE_SAS_AUTH_URL=https://accounts.zoho.com/oauth/v2/auth
VITE_SAS_CLIENT_ID=<your-sas-app-id>
VITE_SAS_REDIRECT_URI=https://<your-catalyst-domain>/auth/callback
```

## Step 5: Configure SAS Integration

1. Go to Zoho Catalyst Console
2. Create a **SAS Application** with:
   - **App Name**: Creator App
   - **Redirect URI**: `https://<your-catalyst-domain>/auth/callback`
   - **Scope**: `userinfo` (at minimum)
3. Copy the Client ID and Client Secret
4. Add to Catalyst environment variables

## Step 6: Deploy Backend

```bash
cd backend
npm install
# Verify catalyst.json is configured
zcatalyst deploy
```

This will:
- Upload the Node.js server code
- Create the DataStore tables (creators table)
- Configure the environment

## Step 7: Deploy Frontend

```bash
cd ../frontend
npm install
npm run build
# The build output (dist/) will be deployed as static assets
zcatalyst deploy-frontend
```

## Step 8: Verify Deployment

```bash
# Check deployment status
zcatalyst status

# View logs
zcatalyst logs --function creator-app-backend
```

## Post-Deployment Configuration

1. **DataStore Access**:
   - Go to Catalyst Console → DataStore
   - Verify the `creators` table is created
   - Configure read/write permissions for your functions

2. **SAS Callback**:
   - After user authenticates, the token is stored in `localStorage`
   - Backend validates token in Authorization header

3. **API Endpoints**:
   - `GET /api/health` — Health check (auth required)
   - `GET /api/creator/profile` — Get creator profile
   - `POST /api/creator/profile` — Create/update profile

## Troubleshooting

**Issue**: DataStore tables not created
- **Solution**: Check `catalyst.json` configuration, re-run `zcatalyst deploy`

**Issue**: SAS authentication fails
- **Solution**: Verify Client ID/Secret in Catalyst environment variables

**Issue**: CORS errors
- **Solution**: Add your frontend domain to CORS whitelist in backend `server.js`

**Issue**: Frontend can't reach backend API
- **Solution**: Update `VITE_API_URL` to match your Catalyst domain

## Local Development

To test locally before deploying:

```bash
# Terminal 1: Backend
cd backend
npm install
npm run dev

# Terminal 2: Frontend  
cd frontend
npm install
npm run dev
```

Backend runs on `http://localhost:8000`
Frontend runs on `http://localhost:3000`

## Next Steps

1. Deploy following steps above
2. Configure SAS credentials in Catalyst Console
3. Add creator features as needed
4. Update welcome page content with your branding

## Support

- **Catalyst Docs**: https://catalyst.zoho.com/docs
- **Zoho SAS**: https://www.zoho.com/sas/
- **Node.js/Express**: https://expressjs.com/
- **React**: https://react.dev/