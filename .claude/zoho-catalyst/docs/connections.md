FILE_PURPOSE: Read when integrating Catalyst with Zoho services or third-party APIs using managed auth tokens — creating connections, retrieving credentials in functions, or configuring Signals webhooks with auth.
TRIGGER_KEYWORDS: Connections, Connection Link Name, getConnectionCredentials, Default Service, Custom Service, OAuth2 connection, Signals webhook auth, ZCConnections
SOURCE_DOC: help-docs/connections.md

TECHNICAL_CONSTRAINTS:
- 25+ Default Services (pre-configured): Zoho CRM, Bigin, Voice, Payroll, Shifts, Catalyst, FSM, Booking, IOT, Sprints, Books, Directory, One, Desk, Recruit, Commerce, Projects, Meeting, Writer, ManageEngine ServiceDesk Plus Cloud, Zakya, Arattai, AlarmsOne, Google, MailChimp, Dropbox, DocuSign, Adobe Sign, GoToMeeting
- Custom Service auth types: API Key, Basic Authentication (Query String ONLY — no other param type), OAuth2
- Connection Link Name: auto-generated from connection name; CANNOT be edited after creation
- Scopes: CANNOT be modified after connection is created — must delete and recreate to change scopes
- Cannot edit/delete a Custom Service while a live connection exists for it
- Cannot edit Authentication Type, Parameter Key, or Service Link Name of a Custom Service after creation
- Only the developer who created a connection can edit or delete it; others must revoke first, then recreate
- SDK only accessible inside Catalyst Functions and AppSail — not from external services or local environments

REQUIRED_PARAMETERS:
- Connection Link Name: string used to reference connection in SDK calls (auto-generated, shown in console)
- SDK — Node.js:
  ```js
  const connections = app.connections();
  const creds = await connections.getConnectionCredentials('connection_link_name');
  ```
- SDK — Python:
  ```python
  connections = app.connections()
  creds = connections.get_connection_credentials('connection_link_name')
  ```
- SDK — Java:
  ```java
  ZCConnections connections = ZCConnections.getInstance();
  ZCConnectionResponse creds = connections.getConnectionCredentials("connection_link_name");
  // access via creds.getHeaders() and creds.getParameters()
  ```

UI_ONLY_ACTIONS:
- Create Default Service connection: Console → Cloud Scale → Connections → Create Connection → select service → enter name + scopes → Create And Connect → authenticate via service login
- Create Custom Service: Console → Connections → Custom Services → Create Service → enter name + auth type + params/scopes → Create Service
- Create Custom Service connection: Console → Connections → select custom service → Create Connection → Create And Connect → authenticate
- Revoke connection: Console → Connections → My Connections → hover connection → revoke icon → Revoke
- Edit connection (own only): Console → Connections → My Connections → ellipsis → Edit → update → Update
- Delete connection (own only): Console → Connections → My Connections → ellipsis → Delete → Yes, Delete
- Edit Custom Service: Console → Connections → Custom Services → Edit icon → make changes (name only if connection is live) → Update
- Delete Custom Service: Console → Connections → Custom Services → Delete icon → Yes, Delete (only if no live connections)
- Use connection in Signals webhook: Console → Signals → Webhooks → Create Webhook → enable "Authorize via Connection" → select connection → Save

CRITICAL_FAILURE_MODES:
- Wrong Connection Link Name in SDK call: runtime error; verify exact link name from console (Console → Connections → My Connections → connection details)
- Trying to change scopes: not possible on existing connection — must revoke, delete, and recreate with correct scopes
- Basic Auth Custom Service: only Query String parameter type supported; Header or Body param types are not available for Basic Auth
- Editing connection you didn't create: blocked by Catalyst; requires the original creator to edit, or revoke + recreate
- SDK call from outside Catalyst Functions/AppSail (e.g., local dev): fails; SDK has no access to connection token store externally
