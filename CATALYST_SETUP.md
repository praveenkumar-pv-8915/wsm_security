# Zoho Catalyst Serverless Setup Guide

Complete setup guide for deploying a full-stack app on Zoho Catalyst Serverless.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Authentication](#authentication)
4. [Project Initialization](#project-initialization)
5. [Development](#development)
6. [Deployment](#deployment)
7. [API Integration](#api-integration)
8. [Datastore Setup](#datastore-setup)
9. [Monitoring & Debugging](#monitoring--debugging)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements
- **Node.js**: v18 or higher
- **npm**: v8 or higher
- **Operating System**: macOS, Linux, or Windows
- **Administrator Access**: Required for CLI installation

### Accounts & Access
- Zoho account (free or paid)
- Access to [Zoho Catalyst Dashboard](https://catalyst.zoho.com)
- Git (optional, but recommended)

### Check Your Node Version

```bash
node --version    # Should be v18.x.x or higher
npm --version     # Should be v8.x.x or higher
```

If you have `nvm` (Node Version Manager):
```bash
nvm install 18
nvm use 18
```

---

## Installation

### Install Catalyst CLI

**On macOS/Linux:**
```bash
npm install -g zcatalyst-cli
```

**On macOS with Homebrew:**
```bash
brew install zoho-catalyst
```

**On Windows (Admin PowerShell):**
```bash
npm install -g zcatalyst-cli
```

### Verify Installation

```bash
zcatalyst --version
```

Expected output:
```
zcatalyst-cli/1.25.1 darwin-arm64 node-v18.18.0
```

---

## Authentication

### Login to Catalyst

```bash
zcatalyst auth login
```

This will:
1. Open your browser
2. Redirect to Zoho Catalyst login
3. Ask for permission to access your account
4. Store credentials locally

### Verify Authentication

```bash
zcatalyst auth whoami
```

Expected output:
```
Logged in as: your-email@example.com
```

---

## Project Initialization

### Initialize New Catalyst Project

```bash
zcatalyst init
```

Follow the prompts:
```
? Project Name: team-management-app
? Description: Team management and task tracking app
? Runtime: nodejs18
? Build Framework: express
```

This creates:
```
team-management-app/
├── src/
│   └── server.js
├── package.json
├── catalyst.json
└── README.md
```

### Initialize in Existing Project

If working in an existing directory:

```bash
cd /path/to/project
zcatalyst init --project-name team-management-app
```

---

## Development

### Local Development Setup

#### 1. Install Dependencies

```bash
cd team-management-app
npm install
```

#### 2. Run Locally with Catalyst

```bash
zcatalyst local
```

This starts:
- Local Catalyst emulator
- Your serverless function on `http://localhost:9090`
- Datastore emulation

#### 3. Test API Endpoint

```bash
curl http://localhost:9090/api/health
```

Expected response:
```json
{ "status": "ok" }
```

#### 4. Hot Reload

The local server auto-reloads on file changes. Just edit and save!

---

## Deployment

### Pre-Deployment Checklist

```bash
# 1. Verify Node version
node --version

# 2. Check dependencies
npm list

# 3. Verify catalyst.json
cat catalyst.json

# 4. Test locally
zcatalyst local

# 5. Build (if needed)
npm run build
```

### Deploy to Catalyst

```bash
zcatalyst deploy
```

Output example:
```
✓ Creating project...
✓ Building application...
✓ Creating datastore tables...
✓ Deploying serverless function...
✓ Deployment successful!

Project URL: https://team-mgmt-12345.catalyst.zoho.com
Region: us
```

### Save Your Project URL

```
https://your-project-id.catalyst.zoho.com
```

Use this URL to access your deployed app.

---

## API Integration

### Express Server Setup

Your `src/server.js`:

```javascript
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (frontend)
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await getTasks(req.headers['x-user-id']);
    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

module.exports = app;
```

### Request Headers

When making API calls, include:

```javascript
const headers = {
  'Authorization': 'Bearer YOUR_TOKEN',
  'X-User-ID': 'user-identifier',
  'Content-Type': 'application/json'
};

fetch('/api/tasks', { headers });
```

---

## Datastore Setup

### Define Tables in catalyst.json

```json
{
  "name": "team-management-app",
  "type": "nodejs",
  "runtime": "18",
  "handler": "src/server.js",
  "datastore": {
    "tables": [
      {
        "name": "creators",
        "columns": [
          {
            "name": "CREATORID",
            "type": "bigint",
            "primary_key": true,
            "auto_increment": true
          },
          {
            "name": "user_id",
            "type": "string",
            "unique": true
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "email",
            "type": "string"
          },
          {
            "name": "created_at",
            "type": "string"
          }
        ]
      },
      {
        "name": "tasks",
        "columns": [
          {
            "name": "task_id",
            "type": "bigint",
            "primary_key": true,
            "auto_increment": true
          },
          {
            "name": "user_id",
            "type": "string"
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "status",
            "type": "string"
          },
          {
            "name": "priority",
            "type": "string"
          },
          {
            "name": "due_date",
            "type": "string"
          },
          {
            "name": "created_at",
            "type": "string"
          },
          {
            "name": "updated_at",
            "type": "string"
          }
        ]
      }
    ]
  }
}
```

### Using Datastore in Code

```javascript
const { DataStore } = require('zcatalyst-sdk');

const datastore = new DataStore();

// Create record
async function createTask(userId, taskData) {
  const response = await datastore
    .getTable('tasks')
    .insertRow({
      user_id: userId,
      ...taskData,
      created_at: new Date().toISOString()
    });
  return response;
}

// Read records
async function getTasks(userId) {
  const response = await datastore
    .getTable('tasks')
    .getRecords({
      filters: [['user_id', '==', userId]]
    });
  return response.rows || [];
}

// Update record
async function updateTask(taskId, updateData) {
  const response = await datastore
    .getTable('tasks')
    .updateRow(taskId, updateData);
  return response;
}

// Delete record
async function deleteTask(taskId) {
  const response = await datastore
    .getTable('tasks')
    .deleteRow(taskId);
  return response;
}
```

---

## Monitoring & Debugging

### View Function Logs

```bash
# Real-time logs
zcatalyst logs --live

# Filter by function
zcatalyst logs --function api

# Last 100 lines
zcatalyst logs -n 100
```

### View Datastore Records

```bash
# List all records in a table
zcatalyst datastore:records tasks

# View specific table schema
zcatalyst datastore:schema tasks

# Query with filters
zcatalyst datastore:query tasks --filter "status=pending"
```

### Deployment Status

```bash
# Check deployment status
zcatalyst deploy:status

# View deployment history
zcatalyst deploy:history

# Rollback to previous version
zcatalyst deploy:rollback
```

### Monitor Performance

1. Go to [Catalyst Dashboard](https://catalyst.zoho.com)
2. Select your project
3. View:
   - Function invocations
   - Execution time
   - Memory usage
   - Error rates

---

## Troubleshooting

### Issue: `catalyst: command not found`

**Solution:**
```bash
# Reinstall globally
npm install -g zcatalyst-cli

# Or use full path
/Users/YOUR_USERNAME/.nvm/versions/node/v18.x.x/bin/zcatalyst --version
```

### Issue: `EACCES: permission denied`

**Solution:**
```bash
# Use sudo for installation
sudo npm install -g zcatalyst-cli

# Or fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
```

### Issue: Authentication fails

**Solution:**
```bash
# Clear cached credentials
zcatalyst auth logout

# Login again
zcatalyst auth login

# Verify
zcatalyst auth whoami
```

### Issue: Datastore table not found

**Solution:**
```bash
# Redeploy to create tables
zcatalyst deploy

# Check table schema
zcatalyst datastore:schema tasks

# Manually create table via dashboard
# Catalyst Dashboard > Datastore > Create Table
```

### Issue: `Cannot find module 'express'`

**Solution:**
```bash
# Install dependencies
npm install

# Redeploy
zcatalyst deploy
```

### Issue: CORS errors

**Solution:**

Update `src/server.js`:
```javascript
app.use(cors({
  origin: ['https://your-domain.com', 'http://localhost:3000'],
  credentials: true
}));
```

### Issue: 502 Bad Gateway

**Solution:**
1. Check logs: `zcatalyst logs --live`
2. Verify handler export: `module.exports = app;`
3. Test locally: `zcatalyst local`
4. Redeploy: `zcatalyst deploy`

### Issue: Slow performance

**Solution:**
```bash
# Check function metrics
zcatalyst logs --function api

# Optimize database queries
# Add indexes to frequently queried columns

# Increase timeout in catalyst.json
{
  "timeout": 30
}

# Redeploy
zcatalyst deploy
```

---

## Common Commands Reference

```bash
# Authentication
zcatalyst auth login              # Login to Catalyst
zcatalyst auth logout             # Logout
zcatalyst auth whoami             # Check logged-in user

# Project Management
zcatalyst init                    # Initialize new project
zcatalyst deploy                  # Deploy to Catalyst
zcatalyst local                   # Run locally

# Monitoring
zcatalyst logs                    # View function logs
zcatalyst logs --live             # Real-time logs
zcatalyst logs -n 50              # Last 50 lines

# Datastore
zcatalyst datastore:records TABLE  # View table records
zcatalyst datastore:schema TABLE   # View table schema
zcatalyst datastore:query TABLE    # Query records

# Deployment
zcatalyst deploy:status           # Check status
zcatalyst deploy:history          # View history
zcatalyst deploy:rollback         # Rollback version
```

---

## Environment Variables

### Set Environment Variables

In `catalyst.json`:
```json
{
  "environment": {
    "NODE_ENV": "production",
    "API_URL": "https://your-api.com",
    "LOG_LEVEL": "info"
  }
}
```

### Access in Code

```javascript
const apiUrl = process.env.API_URL;
const logLevel = process.env.LOG_LEVEL;
```

---

## Next Steps

1. ✅ Install Catalyst CLI
2. ✅ Authenticate with account
3. ✅ Initialize project
4. ✅ Develop locally
5. ✅ Deploy to Catalyst
6. ✅ Monitor and debug
7. Implement features:
   - Task management
   - User profiles
   - Document storage
   - Notifications
   - Team collaboration

---

## Resources

- [Catalyst Documentation](https://docs.catalyst.zoho.com/)
- [Catalyst CLI Reference](https://docs.catalyst.zoho.com/en/faq/catalyst-cli/)
- [Node.js Runtime Guide](https://docs.catalyst.zoho.com/en/serverless/help/nodejs/)
- [Datastore Documentation](https://docs.catalyst.zoho.com/en/serverless/help/datastore/)
- [Zoho Catalyst Support](https://catalyst.zoho.com/support)

---

## Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section
2. View logs: `zcatalyst logs --live`
3. Check [Catalyst Documentation](https://docs.catalyst.zoho.com/)
4. Contact [Zoho Support](https://catalyst.zoho.com/support)
