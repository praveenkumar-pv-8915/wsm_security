# Catalyst Environment Configuration Setup

This guide explains how to set up environment variables in Catalyst Console for the WSM-Security API.

## Required Environment Variables

The backend requires these environment variables to be set in Catalyst:

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `CATALYST_PROJECT_ID` | Your Catalyst project ID | `47976000000030001` | ✅ Yes |
| `ZOHO_ORGID` | Your Zoho organization ID | `1234567890000000001` | ✅ Yes |
| `CATALYST_API_KEY` | API key for Catalyst services | (provided by Zoho) | ⚠️ Optional* |
| `CATALYST_API_URL` | API endpoint URL | `https://api.zoho.in` | ❌ No (defaults to India DC) |
| `ENVIRONMENT` | Deployment environment | `production` | ❌ No (defaults to development) |

*Only needed if you're using external APIs; not needed for Catalyst Datastore access.

---

## Step 1: Find Your Catalyst Project ID

1. Go to **Zoho Catalyst Console** → https://catalyst.zoho.in
2. Select your **WSM-Security** project
3. In the project dashboard, find your **Project ID** (visible in the URL or dashboard header)
4. Example: `47976000000030001`

---

## Step 2: Find Your Zoho Organization ID

1. Go to **Zoho Admin** → https://accounts.zoho.in/adminmanagement
2. Click **Organization Settings** (left sidebar)
3. Copy your **Organization ID** from the top of the page
4. Example: `1234567890000000001`

---

## Step 3: Set Environment Variables in Catalyst Console

### **For the `server` Function:**

1. Go to **Catalyst Console** → **WSM-Security Project**
2. Navigate to **Functions** → **server** (or your function name)
3. Click the **⚙️ Settings** icon or **Environment Variables** tab
4. Click **Add Variable** and enter:

   ```
   Variable Name: CATALYST_PROJECT_ID
   Value: 47976000000030001
   ```

5. Click **Add Variable** again for the organization ID:

   ```
   Variable Name: ZOHO_ORGID
   Value: 1234567890000000001
   ```

6. (Optional) Add API key if needed:

   ```
   Variable Name: CATALYST_API_KEY
   Value: (your API key)
   ```

7. (Optional) Specify data center:

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

8. Click **Save**

---

## Step 4: Verify Configuration

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
    "orgId": "✓ set",
    "apiKey": "✗ missing",
    "environment": "development",
    "apiUrl": "https://api.zoho.in"
  }
}
```

If any required variables show `✗ missing`, go back to Step 3 and add them.

---

## Step 5: Local Development (Optional)

For local testing, create a `.env` file in `backend/`:

```bash
# backend/.env
CATALYST_PROJECT_ID=47976000000030001
ZOHO_ORGID=1234567890000000001
CATALYST_API_KEY=(your API key)
ENVIRONMENT=development
```

**Important:** Add `.env` to `.gitignore` so credentials aren't committed:

```bash
# backend/.gitignore
.env
.env.local
*.log
node_modules/
```

Install dotenv in the backend:

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
2. Verify that `CATALYST_PROJECT_ID` and `ZOHO_ORGID` are set
3. Check for typos (variable names are case-sensitive)
4. Redeploy the function after changes

### ❌ "Cannot connect to API"

**Solution:**
1. Verify `CATALYST_API_URL` matches your data center
2. Check that your API key (if set) is valid
3. Ensure your Catalyst project is active and not archived

### ✓ Health endpoint shows all required variables

Great! Your configuration is correct. You can now:
- Connect to Catalyst Datastore
- Call Zoho APIs with your org credentials
- Deploy confidently knowing credentials are secure

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
- Share your Project ID and Org ID publicly
- Use the same credentials across environments

---

## Next Steps

Once environment variables are configured:

1. **Deploy the function** to Catalyst
2. **Test the API** by calling `/api/health`
3. **Connect to Catalyst Datastore** for task/user storage
4. **Implement authentication** when ready

See [CATALYST_DATASTORE.md](./CATALYST_DATASTORE.md) for database setup instructions (create this when ready).
