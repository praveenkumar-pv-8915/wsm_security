# Cloud Scale Components Reference

## Table of Contents
1. [Data Store](#data-store)
2. [ZCQL (Zoho Catalyst Query Language)](#zcql)
3. [File Store](#file-store)
4. [Stratus (Object Storage)](#stratus)
5. [NoSQL](#nosql)
6. [Cache](#cache)
7. [Search](#search)
8. [Authentication & User Management](#authentication--user-management)
9. [API Gateway](#api-gateway)
10. [Connections](#connections)
11. [Cron (Job Scheduler)](#cron)
12. [Event Listeners](#event-listeners)
13. [Mail](#mail)
14. [Push Notifications](#push-notifications)
15. [Web Client Hosting](#web-client-hosting)
16. [Domain Mappings](#domain-mappings)

---

## Data Store

Catalyst Data Store is a fully-managed relational database. Tables are created and managed via the console.

### System columns (auto-managed, present in every table)
- `ROWID` — unique row identifier (bigint, auto-increment)
- `CREATORID` — user ID of the creator
- `CREATEDTIME` — timestamp of creation
- `MODIFIEDTIME` — timestamp of last modification

### CRUD Operations (Node.js SDK)

```javascript
// Get a table reference
const table = catalystApp.datastore().table('Employees');
// or by ID: const table = catalystApp.datastore().table(TABLE_ID);

// INSERT a row
const insertedRow = await table.insertRow({
  Name: 'Alice',
  Email: 'alice@example.com',
  Department: 'Engineering',
  Salary: 85000
});
console.log('Inserted ROWID:', insertedRow.ROWID);

// GET a row by ROWID
const row = await table.getRow(ROWID);

// GET all rows (paginated, max 200 per call)
const allRows = await table.getAllRows({
  nextToken: null,     // for pagination
  maxRows: 100         // max 200
});

// UPDATE a row (must include ROWID)
const updatedRow = await table.updateRow({
  ROWID: '12345',
  Salary: 90000
});

// DELETE a row
await table.deleteRow(ROWID);

// BULK INSERT (up to 200 rows)
const rows = [
  { Name: 'Bob', Email: 'bob@example.com' },
  { Name: 'Carol', Email: 'carol@example.com' }
];
const insertedRows = await table.insertRows(rows);

// BULK UPDATE (up to 200 rows, each must have ROWID)
const updatedRows = await table.updateRows([
  { ROWID: '123', Name: 'Robert' },
  { ROWID: '456', Name: 'Caroline' }
]);

// BULK DELETE
await table.deleteRows([ROWID_1, ROWID_2]);
```

### Column types supported
- Text, Integer, BigInt, Decimal, Double
- Boolean, Date, DateTime
- Foreign Key (references another table's ROWID)
- Text Area (for large text)
- Encrypted Text (for sensitive data)

---

## ZCQL

ZCQL is Catalyst's query language, modeled after SQL with important differences.

### Basic queries
```javascript
const zcql = catalystApp.zcql();

// SELECT
const result = await zcql.executeZCQLQuery(
  "SELECT * FROM Employees WHERE Department = 'Engineering'"
);

// SELECT with conditions
const result = await zcql.executeZCQLQuery(
  "SELECT Name, Email FROM Employees WHERE Salary > 80000 ORDER BY Name ASC LIMIT 50"
);

// INSERT (prefer SDK methods, but ZCQL supports it)
await zcql.executeZCQLQuery(
  "INSERT INTO Employees (Name, Email) VALUES ('Dave', 'dave@example.com')"
);

// UPDATE
await zcql.executeZCQLQuery(
  "UPDATE Employees SET Salary = 95000 WHERE ROWID = 12345"
);

// DELETE
await zcql.executeZCQLQuery(
  "DELETE FROM Employees WHERE Department = 'Obsolete'"
);

// Aggregate functions
const result = await zcql.executeZCQLQuery(
  "SELECT COUNT(ROWID) AS total, AVG(Salary) AS avg_salary FROM Employees"
);
```

### ZCQL differences from standard SQL
- Table names are **case-sensitive** — must match exactly as created in the console
- Column names are **case-sensitive**
- String values use **single quotes only**
- Supported aggregate functions: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`
- `LIKE` operator is supported for pattern matching
- `IN`, `NOT IN`, `BETWEEN` are supported
- `ORDER BY` and `LIMIT` are supported
- `GROUP BY` and `HAVING` are supported
- `COALESCE` function is supported
- `DISTINCT` is supported
- **No JOINs** between tables of different types (you can join within the same Data Store)
- Results always include system columns unless you select specific columns
- Maximum 200 rows returned per query unless using pagination
- `LIMIT` maximum value is 200

### Pagination with ZCQL
```javascript
// Use ROWID-based pagination
let lastRowId = 0;
let allResults = [];

while (true) {
  const batch = await zcql.executeZCQLQuery(
    `SELECT * FROM Employees WHERE ROWID > ${lastRowId} ORDER BY ROWID LIMIT 200`
  );
  if (batch.length === 0) break;
  allResults = allResults.concat(batch);
  lastRowId = batch[batch.length - 1].Employees.ROWID;
}
```

---

## File Store

Cloud file storage organized in folders. **For new projects, prefer Stratus (object storage) instead.**
File Store is simpler but has a 100MB-per-file limit and less scalable folder-based organization. Use
File Store only when folder semantics are specifically needed or for legacy projects.

```javascript
const fileStore = catalystApp.filestore();
const folder = fileStore.folder(FOLDER_ID);

// Upload a file
const uploadedFile = await folder.uploadFile({
  code: fileBuffer,          // Buffer or ReadStream
  name: 'report.pdf'
});

// Download a file
const fileContent = await folder.downloadFile(FILE_ID);

// Get file details
const fileDetails = await folder.getFileDetails(FILE_ID);

// Delete a file
await folder.deleteFile(FILE_ID);

// List files in a folder
const files = await folder.getAllFiles();
```

Limits: 100MB per file (default tier). Folders are created via the console.

---

## Stratus (Object Storage)

**Stratus is the preferred storage solution for all file/object storage needs in new Catalyst projects.**
S3-compatible object storage with bucket-based organization, prefix-based listing, and better scalability
than File Store.

```javascript
const stratus = catalystApp.stratus();
const bucket = stratus.bucket('my-bucket');

// Upload an object
await bucket.putObject({
  key: 'data/file.json',
  body: JSON.stringify(data),
  contentType: 'application/json'
});

// Download an object
const obj = await bucket.getObject('data/file.json');

// Delete an object
await bucket.deleteObject('data/file.json');

// List objects
const objects = await bucket.listObjects({ prefix: 'data/' });
```

---

## NoSQL

Document database for semi-structured data.

```javascript
const nosql = catalystApp.nosql();

// Access a collection
const collection = nosql.collection('UserProfiles');

// Insert a document
const doc = await collection.insertDocument({
  userId: 'u123',
  preferences: { theme: 'dark', language: 'en' },
  tags: ['premium', 'beta']
});

// Get a document
const doc = await collection.getDocument(DOCUMENT_ID);

// Update a document
await collection.updateDocument(DOCUMENT_ID, {
  preferences: { theme: 'light' }
});

// Delete a document
await collection.deleteDocument(DOCUMENT_ID);

// Query documents
const results = await collection.queryDocuments({
  filter: { 'preferences.theme': 'dark' }
});
```

---

## Cache

In-memory cache for ephemeral, real-time data. Organized in segments.

```javascript
const cache = catalystApp.cache();
const segment = cache.segment(SEGMENT_ID);

// Put a value (TTL in seconds, max 172800 = 48 hours)
await segment.put('user:123', JSON.stringify({ name: 'Alice' }), 3600);

// Get a value
const value = await segment.getValue('user:123');

// Delete a value
await segment.delete('user:123');

// Update a value
await segment.update('user:123', JSON.stringify({ name: 'Alice Updated' }));
```

Important: Cache values are strings only. Serialize/deserialize JSON yourself. Max value size: 5MB.
Max TTL: 48 hours (172800 seconds). Data is ephemeral and not persisted.

---

## Search

Full-text search across Data Store tables.

```javascript
const search = catalystApp.search();

// Search across all searchable columns
const results = await search.searchQuery('engineering manager', {
  search_table_columns: {
    Employees: ['Name', 'Title', 'Department']
  }
});
```

Search must be enabled per-column in the console. Only Text and Text Area columns can be searched.

---

## Authentication & User Management

```javascript
const userMgmt = catalystApp.userManagement();

// Get current user
const currentUser = await userMgmt.getCurrentUser();

// Get all users
const users = await userMgmt.getAllUsers();

// Get a specific user
const user = await userMgmt.getUserDetails(USER_ID);

// Delete a user
await userMgmt.deleteUser(USER_ID);

// Register a new user (sends invite email)
const newUser = await userMgmt.registerUser({
  email_id: 'newuser@example.com',
  first_name: 'New',
  last_name: 'User'
});
```

Auth types supported: Catalyst built-in auth, Zoho accounts, custom SSO.

---

## API Gateway

Create APIs that route to functions. Configured in the console or via CLI.

Features:
- Path-based routing to functions
- Rate limiting and throttling
- Authentication enforcement
- CORS configuration
- Request/response transformation
- API versioning

Enable via CLI:
```bash
catalyst api-gateway:enable
catalyst api-gateway:status
catalyst api-gateway:disable
```

---

## Connections

Token manager for third-party service integrations.

```javascript
const connection = catalystApp.connection();

// Get a connector by name
const connector = connection.getConnector('ZohoCRM');

// Get access token
const token = await connector.getAccessToken();
```

Connections handle OAuth2 token refresh automatically. Set up connection details in the console.

---

## Cron

Schedule jobs that invoke Cron Functions.

Configured in the console:
- **One-time cron**: Executes at a specific date/time
- **Recurring cron**: Executes on a schedule (minutely, hourly, daily, weekly, monthly, or custom cron expression)

Cron expressions follow standard format: `minute hour day-of-month month day-of-week`

---

## Event Listeners

React to events by triggering Event Functions.

Three categories:
1. **Component Events**: Triggered by Catalyst component actions (Data Store insert/update/delete, File Store upload/delete)
2. **Custom Events**: Triggered programmatically via SDK/API
3. **Zoho Events**: Triggered by events in other Zoho products

```javascript
// Trigger a custom event from code
const event = catalystApp.event();
await event.trigger('my_custom_event', {
  key: 'value',
  timestamp: Date.now()
});
```

---

## Mail

Send emails from your application.

```javascript
const email = catalystApp.email();

await email.sendMail({
  from_email: 'noreply@yourdomain.com',
  to_email: ['user@example.com'],
  subject: 'Welcome!',
  content: '<h1>Hello!</h1><p>Welcome to our app.</p>',
  html_mode: true
});
```

Requires email configuration in the console (domain verification, sender setup).

---

## Push Notifications

Send push notifications to mobile/web apps.

```javascript
const pushNotification = catalystApp.pushNotification();

// Send to specific users
await pushNotification.sendNotification({
  message: 'New update available!',
  recipients: [USER_ID_1, USER_ID_2]
});
```

Requires push notification setup in project settings (APNs for iOS, FCM for Android).

---

## Web Client Hosting

**Legacy frontend hosting.** For new projects, use **Slate** instead — it offers Git-based workflows,
framework-native builds, SSR support, and preview deployments. Web Client Hosting is the older approach
using the `client/` directory.

Host frontend applications on Catalyst's CDN.

- Deploy via CLI: `catalyst deploy --only-client`
- Supports any frontend framework (React, Vue, Angular, vanilla HTML/CSS/JS)
- Client files go in the `client/` directory
- `index.html` is the entry point
- Supports versioning — previous deployments are retained
- Custom domain mapping available

---

## Domain Mappings

Map custom domains to your Catalyst app.

- Configure in the console under Cloud Scale → Domain Mappings
- Free SSL certificates provided automatically
- Supports subdomain mapping
- DNS configuration required (CNAME record)
