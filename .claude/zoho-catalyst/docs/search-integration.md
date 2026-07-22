FILE_PURPOSE: Read when implementing full-text search across Catalyst Data Store tables — indexing columns, executing search queries, or understanding search behavior and limits.
TRIGGER_KEYWORDS: Search Integration, Search Index, indexed column, searchword, search query, sortBy, wildcard search, full-text search, Amplify Search, Search SDK
SOURCE_DOC: help-docs/search-integration.md

TECHNICAL_CONSTRAINTS:
- Search only works on columns with Search Index constraint enabled — non-indexed columns are invisible to search
- Text data type: Search Index is NOT compatible with Text columns (see docs/data-store.md)
- Default columns: ROWID = Search Index NOT available; CREATORID, CREATEDTIME, MODIFIEDTIME = auto-indexed (cannot modify)
- Max tables per search query: 25
- Max records returned per query: 500
- Multi-keyword search (space-separated): OR operation — "Zylker Corporation" returns records matching "Zylker" OR "Corporation", not AND
- Wildcard: `c*` syntax returns all records starting with 'c'
- Sorting: sortBy parameter available for ascending/descending order
- Available environments: Java, Node.js, Python, Web.js (Web SDK)
- Code templates are pre-populated with project-specific IDs; available in console at Amplify → Search
- Indexing an existing column: async process; console notification on completion or failure
- Search Index can be toggled on/off on existing columns via Schema View (except ROWID and MODIFIEDTIME default columns)

REQUIRED_PARAMETERS:
- Template variables to replace: `${searchword}`, `${column_name}`, `${table_name}`
- Search call (Node.js pattern):
  ```js
  const search = app.search();
  const results = await search.executeSearchQuery({
    select_columns: [{ table_name: 'TableName', column_name: ['col1', 'col2'] }],
    search_options: { searchword: 'querystring', order_by: 'asc' }
  });
  ```
- Multi-table search: add multiple objects to `select_columns` array (up to 25 tables)

UI_ONLY_ACTIONS:
- Index existing column: Console → Data Store → click table → Schema View → ellipsis on column → Edit → enable Search Index → Update
- View indexed columns across project: Console → Amplify → Search → view list of all indexed columns per table
- Access code templates: Console → Amplify → Search → select language tab (Node.js/Java/Python/Web.js) → copy template
- Note: Search query execution is available via SDK and API; column indexing toggle is console-only

CRITICAL_FAILURE_MODES:
- Querying a non-indexed column: returns no results silently — no error; verify column has Search Index enabled in Schema View
- Trying to index a Text data type column: Search Index toggle is blocked for Text columns; use Var Char instead if search is needed
- Multi-keyword treated as AND: "first last" actually returns OR results — if exact phrase match is needed, this search does not support it natively
- Querying more than 25 tables: request fails; must split into multiple queries
- Results capped at 500: no indication that more records exist beyond the limit; design pagination or refine query if data volumes require it
- Indexing not complete: searching an in-progress column returns incomplete results; wait for console notification confirming indexing complete
- ROWID cannot be indexed: attempting to enable Search Index on ROWID column is blocked; use ROWID in ZCQL queries instead (docs/data-store.md)
