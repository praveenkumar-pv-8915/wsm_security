# Project Structure & CLI Reference

## Table of Contents
1. [Project Directory Structure](#project-directory-structure)
2. [catalyst.json Configuration](#catalystjson)
3. [catalyst-config.json for Functions](#catalyst-configjson-for-functions)
4. [catalyst-config.json for Client](#catalyst-configjson-for-client)
5. [CLI Installation & Login](#cli-installation--login)
6. [CLI Commands Reference](#cli-commands-reference)
7. [Local Testing](#local-testing)
8. [Deployment](#deployment)
9. [Environments](#environments)

---

## Project Directory Structure

When `catalyst init` is run, a standard project layout is created. Claude must always produce code that
matches this structure exactly, or deployment will fail.

```
my-catalyst-project/              # Project root (home directory)
├── catalyst.json                 # Auto-generated project config
├── functions/                    # All server-side functions
│   ├── function_name_1/          # Each function is its own directory
│   │   ├── index.js              # Entry point (Node.js)
│   │   ├── catalyst-config.json  # Function-specific config
│   │   ├── package.json          # NPM dependencies
│   │   └── node_modules/         # Dependencies (auto-installed)
│   └── function_name_2/
│       ├── main.py               # Entry point (Python)
│       ├── catalyst-config.json
│       └── requirements.txt
├── client/                       # Web client (frontend)
│   ├── index.html                # Entry HTML file
│   ├── css/
│   ├── js/
│   ├── images/
│   └── catalyst-config.json      # Client config
└── appsail/                      # AppSail services (optional)
    ├── app.js                    # Express/Hapi/Koa etc.
    ├── catalyst-config.json
    └── package.json
```

Key rules:
- The `functions/` directory name is fixed and cannot be renamed
- The `client/` directory name is fixed and cannot be renamed
- Each function must be in its own subdirectory under `functions/`
- Each function directory must contain its own `catalyst-config.json`
- The web client must have `index.html` at its root level
- `catalyst.json` at the project root is auto-generated — never create it manually

---

## catalyst.json

This file is automatically created at the project root by `catalyst init`. It contains project metadata.

```json
{
  "project_id": "123456789",
  "project_name": "my-project",
  "api_domain": "https://api.catalyst.zoho.com",
  "accounts_url": "https://accounts.zoho.com"
}
```

Do not modify `project_id` or `api_domain` manually. If switching projects, use `catalyst use`.

---

## catalyst-config.json for Functions

Every function directory must contain this file. It tells Catalyst how to execute the function.

### Node.js Basic I/O Function:
```json
{
  "name": "my_basic_io_function",
  "type": "basic_io",
  "stack": "node18",
  "entry_point": "index.js",
  "memory": 256
}
```

### Node.js Advanced I/O Function:
```json
{
  "name": "my_advanced_io_function",
  "type": "advanced_io",
  "stack": "node18",
  "entry_point": "index.js",
  "memory": 512
}
```

### Event Function:
```json
{
  "name": "my_event_function",
  "type": "event",
  "stack": "node18",
  "entry_point": "index.js",
  "memory": 256
}
```

### Cron Function:
```json
{
  "name": "my_cron_function",
  "type": "cron",
  "stack": "node18",
  "entry_point": "index.js",
  "memory": 256
}
```

### Job Function:
```json
{
  "name": "my_job_function",
  "type": "job",
  "stack": "node18",
  "entry_point": "index.js",
  "memory": 512
}
```

### Python Function:
```json
{
  "name": "my_python_function",
  "type": "basic_io",
  "stack": "python39",
  "entry_point": "main.py",
  "memory": 256
}
```

### Java Function:
```json
{
  "name": "my_java_function",
  "type": "basic_io",
  "stack": "java17",
  "entry_point": "com.example.Main",
  "memory": 512
}
```

**Supported stacks:**
- Node.js: `node14`, `node16`, `node18`
- Java: `java8`, `java11`, `java17`
- Python: `python39`

**Memory options:** 128, 256, 384, 512, 640, 768, 896, 1024 (in MB)

---

## catalyst-config.json for Client

```json
{
  "name": "my_web_client"
}
```

---

## CLI Installation & Login

```bash
# Install CLI globally
npm install -g zcatalyst-cli

# Verify installation
catalyst --version

# Login to Zoho account (opens browser for OAuth)
catalyst login

# Check logged-in user
catalyst whoami

# Logout
catalyst logout
```

Prerequisites: Node.js v14+ and NPM.

---

## CLI Commands Reference

### Project Management
```bash
catalyst init                        # Initialize project in current directory
catalyst init --project "MyProject"  # Init with specific project name
catalyst projects:list               # List all projects in account
catalyst use                         # Switch active project
catalyst reset                       # Reset the project association
```

### Function Management
```bash
catalyst functions:setup             # Set up functions after init
catalyst functions:add               # Add a new function
catalyst functions:shell             # Launch Node.js shell for testing
catalyst functions:delete            # Delete a function
catalyst functions:configure-memory  # Configure function memory
```

### Client Management
```bash
catalyst client:setup                # Set up web client
catalyst client:delete               # Delete web client
```

### AppSail Management
```bash
catalyst appsail:add                 # Add AppSail service
```

### Data Store
```bash
catalyst data:import                 # Import data into Data Store
catalyst data:export                 # Export data from Data Store
catalyst data:status                 # Check import/export status
```

### Slate
```bash
catalyst slate:init                  # Initialize Slate app
catalyst slate:create                # Create new Slate app
catalyst slate:link                  # Link existing Slate app
catalyst slate:unlink                # Unlink Slate app
```

### Pull & Export/Import
```bash
catalyst pull                        # Pull resources from remote
catalyst export                      # Export project as ZIP
catalyst import                      # Import project from ZIP
```

---

## Local Testing

```bash
# Serve all resources locally (functions + client)
catalyst serve

# Serve only functions
catalyst serve --only-functions

# Serve only client
catalyst serve --only-client

# Specify custom port
catalyst serve --port 3000

# Launch function shell for testing
catalyst functions:shell
```

When serving locally:
- Functions are available at `http://localhost:<port>/server/<function_name>/execute`
- Client is available at `http://localhost:<port>/app/index.html`
- The serve command connects to the remote Catalyst console for Data Store, File Store, etc.

---

## Deployment

```bash
# Deploy all resources (functions + client + appsail)
catalyst deploy

# Deploy only functions
catalyst deploy --only-functions

# Deploy only a specific function
catalyst deploy --only-functions --name my_function

# Deploy only client
catalyst deploy --only-client

# Deploy only AppSail
catalyst deploy --only-appsail

# Deploy to Slate
catalyst slate:deploy
```

---

## Environments

Catalyst has two environments:

1. **Development (sandbox)**: Where CLI deploys go. Free to use within limits. Used for testing.
2. **Production**: Requires billing setup. Serves live traffic. Deployed separately from the console.

To deploy to production:
1. Set up billing in the Catalyst console (Settings → Billing)
2. Deploy to production from the console (not from CLI)
3. Production gets its own URL and domain mapping

The CLI always works with the Development environment. Production deployment is done through the web console.
