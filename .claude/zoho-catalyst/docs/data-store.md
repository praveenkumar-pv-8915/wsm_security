FILE_PURPOSE: Read when creating tables, defining columns, setting scopes/permissions, or performing bulk operations in the Catalyst Data Store. For ZCQL query syntax, read references/datastore-sdk.md instead.
TRIGGER_KEYWORDS: Data Store, ROWID, CREATORID, table schema, column data type, table scope, table permissions, bulk delete, OLAP, truncate table, Foreign Key, Var Char, IsMandatory, IsUnique
SOURCE_DOC: help-docs/data-store.md

TECHNICAL_CONSTRAINTS:
- Column limit: 100 per table in dev env; no limit in production
- Default columns (auto-created, non-deletable): ROWID (BigInt), CREATORID (BigInt), CREATEDTIME (DateTime), MODIFIEDTIME (DateTime)
- ROWID and CREATORID values cannot be modified
- Table name: alphanumeric + underscores only; no whitespace, no special chars, no leading numbers
- Column name: alphanumeric + certain special chars; no whitespace
- Data types and limits:
  - Text: max 10,000 chars
  - Var Char: max 255 chars; Max Length can only be increased after creation, never decreased
  - Date: YYYY-MM-DD
  - DateTime: YYYY-MM-DD HH:MM:SS
  - Int: max 10 digits (4-byte)
  - Double: max 17 digits including decimal
  - BigInt: max 19 digits (8-byte)
  - Boolean: true / false
  - Encrypted text: max 10,000 chars
  - Foreign Key: references ROWID of parent table; On Delete = Null or Cascade
- Cannot edit after column created: Column ID, Data Type, IsUnique constraint
- Search Index constraint: NOT available for Text data type
- Bulk Delete: max 200 rows per API call or SDK operation
- Bulk Write: source must be a CSV file in a Stratus bucket; generates report file on completion
- Bulk Read: generates CSV output file
- OLAP database: read-only (SELECT only — no INSERT, UPDATE, DELETE); auto-syncs from primary Data Store; use for analytical/aggregation queries
- Truncate: async background operation; deletes all records, retains schema; other operations can run during truncate

REQUIRED_PARAMETERS:
- Table ID: auto-generated; find at Console → Data Store → click table → shown below table name; used in SDK/API calls
- Column ID: auto-generated; visible in schema view
- Table Scopes (per user role): Global | Org | User
- Table Permissions (per user role, checkboxes): Select, Update, Insert, Delete
- Foreign Key column: requires Parent Table selection and On Delete action (Null or Cascade)
- Search by column in Data Views: only works on columns with Search Index constraint enabled

UI_ONLY_ACTIONS:
- Create table: Console → Cloud Scale → Data Store → Create a new Table → enter name → Create
- Rename table: Console → Data Store → ellipsis on table → Edit → new name → Update
- Truncate table: Console → Data Store → ellipsis on table → Truncate → type "TRUNCATE" → Confirm
- Delete table: Console → Data Store → ellipsis on table → Delete → Yes, Proceed
- Add column: Console → Data Store → click table → Schema View → [+New Column] → name + type + constraints → Create
- Edit column: Console → Data Store → Schema View → ellipsis on column → Edit → modify allowed fields → Update
- Delete column: Console → Data Store → Schema View → ellipsis on column → Delete → Yes, Proceed
- Set scopes/permissions: Console → Data Store → click table → Scopes & Permissions → configure per role → save
- Add record manually: Console → Data Store → click table → Data Views → Add Row / [+New Row] → enter values → Add
- Edit record: Console → Data Store → Data Views → ellipsis on row → Edit → Update
- Delete record: Console → Data Store → Data Views → ellipsis on row → Delete → Yes, Proceed
- Note: Bulk Read/Write/Delete available via CLI and API; ZCQL execution available via console query window and SDK/API

CRITICAL_FAILURE_MODES:
- Var Char Max Length decrease: blocked; can only increase Max Length after initial creation
- Changing Data Type after column creation: not allowed; must delete and recreate column (data loss)
- IsUnique cannot be toggled after creation: if set at creation, permanent; plan schema carefully
- Foreign Key value: must be a valid ROWID from the parent table; invalid ROWID causes insert/update failure
- Search on non-indexed column: Console search in Data Views returns no results silently for non-indexed columns
- Bulk Delete > 200 rows per call: must loop in batches of 200; single call over limit is rejected
- OLAP write attempt: any INSERT/UPDATE/DELETE on OLAP returns error; OLAP is read-only
- Table name with spaces or special characters: table creation fails; use underscores only
- Truncate is async: do not assume completion immediately; wait for console notification before writing new data
