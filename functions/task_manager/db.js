/**
 * DataStore / ZCQL helpers for the task_manager function.
 *
 * Everything here runs with the Catalyst SDK's default ADMIN scope, which means the platform will
 * NOT filter rows for the calling user. Row-level authorisation is the application's job — see
 * auth.js (membership) and task-service.js (assignee/reporter/admin checks).
 */

/** ZCQL caps a SELECT at 300 rows per query, so anything unbounded has to be paged. */
const ZCQL_PAGE = 300;

/** Escape a value for inlining into a ZCQL string literal. */
function esc(value) {
  return String(value === undefined || value === null ? '' : value).replace(/'/g, "''");
}

/**
 * ZCQL returns each row grouped by table name — { tasks: { ROWID, TITLE, ... } } — and JOINs return
 * one sub-object per table. Merge them into one flat object so callers get plain columns.
 */
function flatten(row) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  let merged = false;
  for (const value of Object.values(row)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, value);
      merged = true;
    }
  }
  return merged ? out : row;
}

/**
 * Run a SELECT, paging past the 300-row cap and concatenating the result.
 * The query MUST carry a stable ORDER BY or pagination can repeat/skip rows.
 */
async function selectAll(app, query) {
  const zcql = app.zcql();
  const all = [];
  let offset = 0;
  for (;;) {
    const page = await zcql.executeZCQLQuery(`${query} LIMIT ${offset}, ${ZCQL_PAGE}`);
    all.push(...page.map(flatten));
    if (page.length < ZCQL_PAGE) break;
    offset += ZCQL_PAGE;
  }
  return all;
}

/** Run a SELECT expected to return at most one row. */
async function selectOne(app, query) {
  const rows = await app.zcql().executeZCQLQuery(`${query} LIMIT 0, 1`);
  return rows.length ? flatten(rows[0]) : null;
}

/** Insert one row and return it (with the generated ROWID). */
async function insert(app, tableName, row) {
  return app.datastore().table(tableName).insertRow(row);
}

/** Patch one row by ROWID. `patch` must not contain ROWID. */
async function update(app, tableName, rowId, patch) {
  return app.datastore().table(tableName).updateRow({ ROWID: String(rowId), ...patch });
}

/** Hard-delete one row by ROWID. Used only for checklist items. */
async function remove(app, tableName, rowId) {
  return app.datastore().table(tableName).deleteRow(String(rowId));
}

module.exports = { ZCQL_PAGE, esc, flatten, selectAll, selectOne, insert, update, remove };
