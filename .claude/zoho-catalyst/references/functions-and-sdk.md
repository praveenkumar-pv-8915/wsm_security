# Functions & SDK Reference

## Table of Contents
1. [Function Types Overview](#function-types-overview)
2. [Basic I/O Functions](#basic-io-functions)
3. [Advanced I/O Functions](#advanced-io-functions)
4. [Event Functions](#event-functions)
5. [Cron Functions](#cron-functions)
6. [Integration Functions](#integration-functions)
7. [Job Functions](#job-functions)
8. [Browser Logic Functions](#browser-logic-functions)
9. [Node.js SDK Setup](#nodejs-sdk-setup)
10. [Python SDK Setup](#python-sdk-setup)
11. [Java SDK Setup](#java-sdk-setup)
12. [Web SDK (Client-Side)](#web-sdk-client-side)
13. [SDK Component Access Patterns](#sdk-component-access-patterns)
14. [Error Handling Patterns](#error-handling-patterns)
15. [Security Rules](#security-rules)

---

## Function Types Overview

| Type | Invocation | Use Case | Handler Args (Node.js) |
|------|-----------|----------|----------------------|
| Basic I/O | HTTP GET via API/SDK | Simple request-response | `(catalystApp, context, basicIO)` |
| Advanced I/O | HTTP any method | REST APIs, webhooks | `(catalystApp, context, req, res)` |
| Event | Event Listeners | React to platform events | `(catalystApp, context, event)` |
| Cron | Scheduled by Cron jobs | Periodic tasks | `(catalystApp, context, cronInfo)` |
| Integration | Zoho service triggers | Zoho ecosystem integration | `(catalystApp, context, reqData)` |
| Job | Job Scheduling service | Background processing | `(catalystApp, context, jobData)` |
| Browser Logic | SmartBrowz | Headless browser scripts | `(catalystApp, context, browserData)` |

Critical: never copy code between function types. Each type has different modules initialized in the boilerplate. Always start from the correct template.

---

## Basic I/O Functions

Simplest function type. Receives a string input, returns a string output. Invoked via GET request.

### Node.js Template
```javascript
// functions/my_basic_io/index.js
'use strict';

module.exports = (catalystApp, context, basicIO) => {
  try {
    // Get input data (sent as query parameter)
    const inputData = context.getArgument();

    // Access Catalyst components
    const dataStore = catalystApp.datastore();

    // Your business logic here
    const result = `Processed: ${inputData}`;

    // Send response (must be a string)
    basicIO.write(result);
  } catch (error) {
    console.error('Error:', error);
    basicIO.write(JSON.stringify({ error: error.message }));
  }
};
```

### package.json
```json
{
  "name": "my_basic_io",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "zcatalyst-sdk-node": "latest"
  }
}
```

Invocation: `GET /server/my_basic_io/execute?args=<input_string>`

---

## Advanced I/O Functions

Full HTTP support with native request/response objects (Express-like). Best for REST APIs.

### Node.js Template
```javascript
// functions/my_api/index.js
'use strict';

module.exports = (catalystApp, context, req, res) => {
  try {
    const method = req.method;

    if (method === 'GET') {
      const queryParam = req.query.id;
      res.status(200).json({ message: 'GET request', id: queryParam });

    } else if (method === 'POST') {
      const body = req.body;
      // Process body
      res.status(201).json({ message: 'Created', data: body });

    } else if (method === 'PUT') {
      const body = req.body;
      res.status(200).json({ message: 'Updated', data: body });

    } else if (method === 'DELETE') {
      res.status(200).json({ message: 'Deleted' });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};
```

Invocation: Any HTTP method to `/server/my_api/execute`

### Handling file uploads in Advanced I/O
```javascript
module.exports = (catalystApp, context, req, res) => {
  // File is available in req.files
  const uploadedFile = req.files?.file;

  if (!uploadedFile) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const fileStore = catalystApp.filestore();
  const folder = fileStore.folder(FOLDER_ID);

  folder.uploadFile({
    code: uploadedFile.data,
    name: uploadedFile.name
  })
  .then(response => res.status(200).json(response))
  .catch(err => res.status(500).json({ error: err.message }));
};
```

---

## Event Functions

Triggered by Event Listeners. Cannot be invoked directly via HTTP.

```javascript
// functions/my_event_fn/index.js
'use strict';

module.exports = (catalystApp, context, event) => {
  try {
    // Get event data
    const eventData = event.getArgument();
    const parsedData = JSON.parse(eventData);

    console.log('Event received:', parsedData);

    // Process the event
    // ...

    // Must close context when done
    context.close();
  } catch (error) {
    console.error('Event processing error:', error);
    context.close();
  }
};
```

Event types that can trigger Event Functions:
- **Component Events**: Data Store row insert/update/delete, File Store upload/delete
- **Custom Events**: User-defined events triggered via SDK/API
- **Zoho Events**: Events from Zoho services (CRM, Books, etc.)

---

## Cron Functions

Invoked by Cron jobs on a schedule. Cannot be invoked directly.

```javascript
// functions/my_cron_fn/index.js
'use strict';

module.exports = async (catalystApp, context, cronInfo) => {
  try {
    const cronDetails = cronInfo.getArgument();
    console.log('Cron job triggered:', cronDetails);

    // Perform scheduled task
    const dataStore = catalystApp.datastore();
    const table = dataStore.table('Reports');

    // Example: Clean up old records
    const zcql = catalystApp.zcql();
    const query = "DELETE FROM Reports WHERE CREATEDTIME < '2024-01-01'";
    await zcql.executeZCQLQuery(query);

    // Signal success
    context.closeWithSuccess();
  } catch (error) {
    console.error('Cron error:', error);
    context.closeWithFailure();
  }
};
```

---

## Integration Functions

For integrating with other Zoho services. Note: NOT available in EU, AU, IN, or CA data centers.

```javascript
// functions/my_integration_fn/index.js
'use strict';

module.exports = (catalystApp, context, reqData) => {
  try {
    const integrationData = reqData.getArgument();
    const parsedData = JSON.parse(integrationData);

    // Access the Zoho service data
    console.log('Integration data:', parsedData);

    // Process and respond
    context.close();
  } catch (error) {
    console.error('Integration error:', error);
    context.close();
  }
};
```

---

## Job Functions

Triggered by the Job Scheduling service for background processing.

```javascript
// functions/my_job_fn/index.js
'use strict';

module.exports = async (catalystApp, context, jobData) => {
  try {
    const jobDetails = jobData.getArgument();
    console.log('Job started:', jobDetails);

    // Long-running background task
    // ...

    context.closeWithSuccess();
  } catch (error) {
    console.error('Job error:', error);
    context.closeWithFailure();
  }
};
```

---

## Browser Logic Functions

Used with SmartBrowz for headless browser automation.

```javascript
// functions/my_browser_fn/index.js
'use strict';

module.exports = (catalystApp, context, browserData) => {
  try {
    const input = browserData.getArgument();
    // Browser automation logic
    context.close();
  } catch (error) {
    console.error('Browser logic error:', error);
    context.close();
  }
};
```

---

## Node.js SDK Setup

### In Functions (auto-initialized)
The `catalystApp` parameter is pre-initialized in function handlers. Just use it directly:
```javascript
module.exports = (catalystApp, context, req, res) => {
  const dataStore = catalystApp.datastore();
  // ...
};
```

### In AppSail (manual initialization)
```javascript
const catalyst = require('zcatalyst-sdk-node');

// Initialize with request context (for user-scoped operations)
app.get('/api/data', (req, res) => {
  const catalystApp = catalyst.initialize(req);
  const dataStore = catalystApp.datastore();
  // ...
});

// Initialize as admin (for system-level operations)
const catalystApp = catalyst.initialize(req, { type: catalyst.credential.admin });
```

### NPM Package
```bash
npm install zcatalyst-sdk-node
```

---

## Python SDK Setup

### In Functions
```python
# functions/my_function/main.py
import zcatalyst_sdk

def handler(context, basicIO):
    catalyst_app = zcatalyst_sdk.initialize()
    datastore = catalyst_app.datastore()

    # Business logic
    result = "Processed"
    basicIO.write(result)
```

### pip Package
```bash
pip install zcatalyst-sdk
```

---

## Java SDK Setup

### In Functions
```java
// Maven dependency: com.zoho.catalyst:zcatalyst-sdk
import com.zoho.catalyst.api.CatalystApp;
import com.zoho.catalyst.api.beans.*;

public class MainFunction implements BasicIO {
    @Override
    public void runner(CatalystApp catalystApp, Context context, BasicIOObject basicIO) {
        try {
            String input = context.getArgument();
            // Business logic
            basicIO.write("Result");
        } catch (Exception e) {
            basicIO.write("Error: " + e.getMessage());
        }
    }
}
```

---

## Web SDK (Client-Side)

The Web SDK is used in frontend code to interact with Catalyst backend services.

### Include via script tag
```html
<script src="https://static.zohocdn.com/catalyst/sdk/js/4.0.0/catalystWebSDK.js"></script>
<script>
  catalyst.auth.init("applogic-url", {
    // optional config
  });
</script>
```

### Authentication flow
```javascript
// Sign up a new user
catalyst.auth.signUp({
  email_id: "user@example.com",
  first_name: "John",
  last_name: "Doe"
});

// Login
catalyst.auth.login("user@example.com", "password");

// Check if logged in
const isLoggedIn = catalyst.auth.isUserAuthenticated();

// Logout
catalyst.auth.signOut();
```

### Calling functions from client
```javascript
// Call a Basic I/O function
catalyst.server.callFunction("my_basic_io", { args: "input_data" })
  .then(response => console.log(response))
  .catch(err => console.error(err));

// Call an Advanced I/O function
catalyst.server.callAdvancedIO("my_api", {
  method: "POST",
  body: JSON.stringify({ key: "value" }),
  headers: { "Content-Type": "application/json" }
})
  .then(response => console.log(response))
  .catch(err => console.error(err));
```

---

## SDK Component Access Patterns

All components are accessed through the initialized `catalystApp` object:

```javascript
// Data Store
const dataStore = catalystApp.datastore();
const table = dataStore.table('TableName');      // by name
const table = dataStore.table(TABLE_ID);         // by ID

// File Store
const fileStore = catalystApp.filestore();
const folder = fileStore.folder(FOLDER_ID);

// Cache
const cache = catalystApp.cache();
const segment = cache.segment(SEGMENT_ID);

// ZCQL
const zcql = catalystApp.zcql();

// Email
const email = catalystApp.email();

// Search
const search = catalystApp.search();

// User Management
const userManagement = catalystApp.userManagement();

// Push Notifications
const pushNotification = catalystApp.pushNotification();

// Connections (for third-party auth)
const connection = catalystApp.connection();
```

---

## Error Handling Patterns

### Recommended pattern for Advanced I/O functions
```javascript
module.exports = async (catalystApp, context, req, res) => {
  try {
    // Validate input
    if (!req.body || !req.body.name) {
      return res.status(400).json({
        status: 'error',
        message: 'Name is required'
      });
    }

    // Business logic
    const result = await someOperation(catalystApp, req.body);

    res.status(200).json({
      status: 'success',
      data: result
    });
  } catch (error) {
    console.error('Function error:', error);

    // Check for Catalyst-specific errors
    if (error.code === 'INVALID_DATA') {
      return res.status(400).json({ status: 'error', message: error.message });
    }

    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};
```

---

## Security Rules

Security Rules control who can invoke Basic I/O and Advanced I/O functions.

Access levels:
- **`no_auth`**: Anyone can invoke (public access)
- **`user_auth`**: Only authenticated users
- **`admin_auth`**: Only project admins

Security rules are configured in the Catalyst console under Serverless → Security Rules. They define
JSON-based rules that determine access per function.

Default: all functions require `user_auth` (authenticated users only). Override to `no_auth` for
public APIs, or use the API Gateway for more granular control.
