FILE_PURPOSE: Read for ZCQL syntax reference — SELECT/INSERT/UPDATE/DELETE operations, LIMIT/OFFSET pagination, JOIN, GROUP BY, ORDER BY, and ZCQL V2 migration. For SDK patterns and the 300-row pagination gotcha, also read references/datastore-sdk.md.
TRIGGER_KEYWORDS: ZCQL, ZCQL query, SELECT, INSERT, UPDATE, DELETE, ZCQL LIMIT, ZCQL JOIN, ZCQL V2, executeZCQLQuery, ZCQL WHERE, ZCQL GROUP BY, ZCQL ORDER BY
SOURCE_DOC: help-docs/zcql.md

TECHNICAL_CONSTRAINTS:
- SELECT hard limit: 300 rows per query — NO error or indication when rows are truncated — ALWAYS paginate (see SKILL.md Critical Gotcha #1)
- ZCQL V2 Parser migration:
  - Dev: automatic from December 1, 2024
  - Production: automatic from April 1, 2025 (when production is enabled)
  - Must set appropriate environment variable in code to use ZCQL V2
- Operations: SELECT, INSERT, UPDATE, DELETE (no DDL — no CREATE/ALTER/DROP table from ZCQL)
- OLAP database: SELECT only — INSERT/UPDATE/DELETE return error (see docs/data-store.md)
- No semicolons needed when executing in the ZCQL console query window
- Available in: Java, Node.js, Python, Web, Android, iOS, Flutter SDKs and API
- ZCQL console query window: available for testing at Console → Data Store → ZCQL tab

REQUIRED_PARAMETERS: Syntax reference:
```sql
-- SELECT with pagination (REQUIRED pattern)
SELECT col1, col2 FROM TableName
  [JOIN OtherTable ON TableName.FK = OtherTable.ROWID]
  [WHERE condition]
  [GROUP BY col]
  [HAVING condition]
  [ORDER BY col ASC|DESC]
  LIMIT offset, count

-- Pagination pattern (always use)
LIMIT 0, 300    -- first page
LIMIT 300, 300  -- second page
LIMIT 600, 300  -- third page

-- INSERT
INSERT INTO TableName (col1, col2) VALUES ('val1', 'val2')

-- UPDATE
UPDATE TableName SET col1 = 'newval' WHERE ROWID = 12345

-- DELETE
DELETE FROM TableName WHERE ROWID = 12345
```
- SDK (Node.js): `await zcql.executeZCQLQuery('SELECT * FROM TableName LIMIT 0, 300')`
- For full SDK init and credential patterns: see `references/datastore-sdk.md`

UI_ONLY_ACTIONS:
- Execute ZCQL in console: Console → Data Store → click table → ZCQL tab → enter query → Execute
- Note: All ZCQL operations available via SDK and API

CRITICAL_FAILURE_MODES:
- SELECT without LIMIT: returns max 300 rows silently; if table has >300 records, data loss in result — see SKILL.md gotcha #1 for pagination helper
- ZCQL V2 environment variable not set: code may behave differently in V2 environments (dev post-Dec 2024, prod post-Apr 2025); check env var requirement in Catalyst docs
- INSERT/UPDATE/DELETE on OLAP table: returns error — OLAP is read-only
- Column names with spaces or special characters: must be quoted in ZCQL; unquoted non-alphanumeric names cause parse errors
- HAVING without GROUP BY: ZCQL may reject or return unexpected results; always pair HAVING with GROUP BY
- JOIN on non-ROWID columns: ZCQL JOIN only works on ROWID references (Foreign Key columns); cannot JOIN on arbitrary columns
