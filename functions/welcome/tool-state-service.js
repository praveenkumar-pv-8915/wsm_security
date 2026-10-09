/**
 * tool_state — generic run state for scheduled/incremental jobs. The machine-written mirror of
 * `tool_config`.
 *
 * Why a second table instead of another TOOL_KEY namespace inside `tool_config` (2026-09-17):
 * purely so the two stay legible to a human. `tool_config` is a table people open in the console
 * and hand-edit — the `risk_register` → `Compliance_manager` migration was exactly that. Mixing
 * cron watermarks into it means rows a person is meant to edit sit interleaved with rows a person
 * must never touch, distinguishable only by reading TOOL_KEY. Edit the wrong one and a cursor
 * resets, which either re-notifies months of history or silently skips it.
 *
 * Nothing here is a correctness argument: the same code works with one table. It is a
 * mistake-surface argument, and it is the only reason this table exists. Two earlier candidate
 * columns (LAST_STATUS, LOCKED_UNTIL) were cut before creation because nothing used them —
 * LAST_STATUS is derivable from LAST_ERROR being empty, and nothing here overruns its own tick.
 *
 * Table: `tool_state`
 *   TOOL_KEY          Var Char 50,  Mandatory          which feature owns this, e.g. 'vm_notifier'
 *   STATE_KEY         Var Char 100, Mandatory          which entity within it, e.g. 'stratus_client'.
 *                                                      Use '_tool' for whole-feature state.
 *   STATE_LOOKUP_KEY  Var Char 160, Mandatory + Unique app-computed `TOOL_KEY + '::' + STATE_KEY`.
 *                                                      Catalyst has no composite unique constraint,
 *                                                      so this derived column is the DB-level
 *                                                      backstop — same pattern as
 *                                                      tool_config.CONFIG_LOOKUP_KEY.
 *   RESUME_CURSOR            Var Char 100                     resume watermark, opaque to this file: an
 *                                                      epoch-ms, a page token, an ETag, a last-seen
 *                                                      id. Top-level so a job advances it without
 *                                                      rewriting the JSON.
 *   LAST_RUN_AT       Var Char 25                      ISO-8601 UTC. Var Char per this app's date
 *                                                      convention; ISO-8601 also string-sorts
 *                                                      correctly, so a range filter stays possible.
 *   LAST_ERROR        Var Char 255                     truncated here, not by the caller. Var Char
 *                                                      rather than Text so the console list stays
 *                                                      readable and nobody pastes a stack trace in.
 *   STATE_VALUE       Text                             JSON for everything feature-specific — seen
 *                                                      versions, per-source sub-cursors, resolved
 *                                                      ids. Text, so it cannot be Mandatory.
 *
 * These four scalars are columns rather than JSON fields for the same reason the table exists: a
 * person scanning `tool_state` in the console can see when a job last ran and why it failed without
 * opening a blob.
 *
 * NOT a secret store, same as `tool_config` — nothing is encrypted.
 */

const TABLE = 'tool_state';

const ERROR_LIMIT = 255;
const RESUME_CURSOR_LIMIT = 100;

function ds(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) throw new Error('Catalyst authentication required');
  return { table: app.datastore().table(TABLE), zcql: app.zcql() };
}

const unwrap = rows => (rows || []).map(r => r[TABLE] || r);

const esc = value => String(value).replace(/'/g, "''");

const EXPECTED_COLUMNS =
  'TOOL_KEY, STATE_KEY, STATE_LOOKUP_KEY [Mandatory+Unique], RESUME_CURSOR, LAST_RUN_AT, ' +
  'LAST_ERROR, STATE_VALUE';

/**
 * Any failure talking to this table becomes a 424 carrying the original DataStore message.
 *
 * Deliberately broad — see the matching note in tool-config-service.js. Matching on a guessed
 * wording let every other failure fall through as an unhandled 500, which index.js masks as a flat
 * "Internal error"; with no logs API, that hid the only useful information. The queries here are
 * fixed strings over a fixed schema, so a failure is a storage-configuration problem rather than
 * bad caller input.
 *
 * 424 is deliberately under 500 so index.js passes the message through instead of masking it.
 */
function storeError(e) {
  const msg = String((e && e.message) || e || 'unknown error');
  if (e && e.status && e.status < 500) return e; // already a decided answer — leave it alone
  const err = new Error(
    `DataStore rejected a "${TABLE}" operation — check the table exists with the expected columns ` +
    `(${EXPECTED_COLUMNS}). Original error: ${msg}`
  );
  err.status = 424;
  return err;
}

/** Run a DataStore call, converting any failure into the 424 above. */
async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    throw storeError(e);
  }
}

const lookupKey = (toolKey, stateKey) => `${toolKey}::${stateKey}`;

const COLUMNS = 'ROWID, TOOL_KEY, STATE_KEY, RESUME_CURSOR, LAST_RUN_AT, LAST_ERROR, STATE_VALUE';

function toDto(row) {
  let value = null;
  if (row.STATE_VALUE) {
    try { value = JSON.parse(row.STATE_VALUE); } catch { value = null; }
  }
  return {
    key: row.STATE_KEY,
    cursor: row.RESUME_CURSOR || '',
    last_run_at: row.LAST_RUN_AT || '',
    last_error: row.LAST_ERROR || '',
    value,
  };
}

/** One entity's state, or `null` if this job has never run for it. Never seeds a row. */
async function getState(req, toolKey, stateKey) {
  const { zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE STATE_LOOKUP_KEY = '${esc(lookupKey(toolKey, stateKey))}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  return rows.length ? toDto(rows[0]) : null;
}

/** Every entity's state for one feature, keyed by STATE_KEY — the UI's status column reads this. */
async function listState(req, toolKey) {
  const { zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE TOOL_KEY = '${esc(toolKey)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  const byKey = {};
  for (const row of rows) byKey[row.STATE_KEY] = toDto(row);
  return byKey;
}

/**
 * Create-or-update, partial: only the fields present in `patch` are written, so a run that only
 * advances the cursor does not have to restate the value blob.
 *
 * patch: { cursor?, value?, error?, ran? }
 *   ran   — default true; stamps LAST_RUN_AT with now
 *   error — '' or null clears a previous failure, which is what makes LAST_STATUS unnecessary
 */
async function setState(req, toolKey, stateKey, patch = {}) {
  const { table, zcql } = ds(req);
  const key = lookupKey(toolKey, stateKey);

  const payload = {};
  if (patch.cursor !== undefined) payload.RESUME_CURSOR = String(patch.cursor == null ? '' : patch.cursor).slice(0, RESUME_CURSOR_LIMIT);
  if (patch.value !== undefined) {
    payload.STATE_VALUE = patch.value == null ? ''
      : (typeof patch.value === 'string' ? patch.value : JSON.stringify(patch.value));
  }
  if (patch.error !== undefined) {
    payload.LAST_ERROR = patch.error ? String(patch.error).slice(0, ERROR_LIMIT) : '';
  }
  if (patch.ran !== false) payload.LAST_RUN_AT = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE STATE_LOOKUP_KEY = '${esc(key)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }

  if (rows.length) {
    await guard(() => table.updateRow({ ROWID: String(rows[0].ROWID), ...payload }));
  } else {
    await guard(() => table.insertRow({
      TOOL_KEY: toolKey, STATE_KEY: stateKey, STATE_LOOKUP_KEY: key, ...payload,
    }));
  }
  return { ...patch };
}

/** Forget one entity's state — called when its configuration is deleted, so nothing is orphaned. */
async function deleteState(req, toolKey, stateKey) {
  const { table, zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE STATE_LOOKUP_KEY = '${esc(lookupKey(toolKey, stateKey))}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  if (!rows.length) return false;
  await guard(() => table.deleteRow(String(rows[0].ROWID)));
  return true;
}

module.exports = { getState, listState, setState, deleteState, TABLE };
