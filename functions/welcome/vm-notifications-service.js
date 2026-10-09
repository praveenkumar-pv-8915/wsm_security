/**
 * vm_notifications — what the notifier found, one row per dependency + version.
 *
 * The third store behind the Dependency Upgrade Notifier, alongside `tool_config` (human-written
 * configuration) and `tool_state` (the cron's cursors). It exists because the notifier's output is
 * now shown *in the page*, not only posted to Cliq and forgotten: the design doc's own condition
 * for this table ("if notified summaries ever need keeping, that is when it earns itself") is met.
 *
 * ── Why a DataStore row is the right size for this ───────────────────────────────────────────
 *
 * What is stored is the FACTS of a release, never a rendered message: dependency, version, title,
 * a ≤700-char excerpt (the Python tool's own `notify.py::_clean` limit), source link, timestamps
 * and delivery outcome. That is well under 1.5 KB per row against a 10,000-char `Text` cap.
 *
 * The consolidated Cliq card — eight dependencies at roughly a kilobyte each — would not fit that
 * cap, which is exactly why it is rendered at post/display time from these rows and never stored.
 * If full release-note bodies are ever wanted, that is the >4 KB case and the routing rule in
 * `claude/connection-config-store-design.md` already answers it: blob in Stratus, pointer in the
 * row. Deliberately not built.
 *
 * ── Idempotence ──────────────────────────────────────────────────────────────────────────────
 *
 * `DEP_VERSION_KEY` (`<dep>::<version>`) is Mandatory + Unique, so a re-scan that re-discovers a
 * version cannot produce a second notification. That is the DB-level backstop; `insertNotification`
 * also checks first, so the normal path never relies on a constraint violation. This is what makes
 * a cursor reset survivable — re-reading six months of Connect history re-finds old versions and
 * silently skips every one of them instead of re-notifying the team.
 *
 * Not a secret store: nothing here is encrypted, and `notify_url` (which carries a Cliq zapikey)
 * is deliberately NOT copied into these rows — it stays in `tool_config`.
 */

'use strict';

const TABLE = 'vm_notifications';

function ds(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) throw new Error('Catalyst authentication required');
  return { table: app.datastore().table(TABLE), zcql: app.zcql() };
}

const unwrap = rows => (rows || []).map(r => r[TABLE] || r);

/** Single-quoted ZCQL string literal — the same escaping convention as the sibling services. */
function esc(value) {
  return String(value).replace(/'/g, "''");
}

const EXPECTED_COLUMNS =
  'DEP_KEY, VERSION, DEP_VERSION_KEY [Mandatory+Unique], DEP_NAME, SOURCE_TYPE, SOURCE_URL, ' +
  'TITLE, SUMMARY, POSTED_AT, DETECTED_AT, DELIVERY_STATUS, DELIVERY_ERROR, DELIVERY_AT';

/**
 * Any failure against this table becomes a 424 carrying the original DataStore message — the same
 * decision, for the same reason, as `tool-config-service.js`: these queries are fixed strings over
 * a fixed schema, so a failure is a storage-configuration problem and saying so beats index.js
 * masking it as "Internal error" with the real text only in console logs.
 */
function storeError(e) {
  const msg = String((e && e.message) || e || 'unknown error');
  if (e && e.status && e.status < 500) return e;
  const err = new Error(
    `DataStore rejected a "${TABLE}" operation — check the table exists with the expected columns ` +
    `(${EXPECTED_COLUMNS}). Original error: ${msg}`
  );
  err.status = 424;
  return err;
}

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    throw storeError(e);
  }
}

const LIMITS = { DEP_KEY: 60, VERSION: 60, DEP_NAME: 100, SOURCE_TYPE: 20, SOURCE_URL: 255, TITLE: 255, DELIVERY_ERROR: 255 };
const SUMMARY_LIMIT = 9000; // under the 10,000-char Text cap, with headroom for JSON escaping
const COLUMNS =
  'ROWID, DEP_KEY, VERSION, DEP_NAME, SOURCE_TYPE, SOURCE_URL, TITLE, SUMMARY, POSTED_AT, ' +
  'DETECTED_AT, DELIVERY_STATUS, DELIVERY_ERROR, DELIVERY_AT, CREATEDTIME';

const DELIVERY = { PENDING: 'pending', SENT: 'sent', FAILED: 'failed', SKIPPED: 'skipped' };

const clip = (value, limit) => String(value == null ? '' : value).slice(0, limit);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const versionKey = (depKey, version) => `${depKey}::${version}`;

function toDto(row) {
  return {
    id: String(row.ROWID),
    dep_key: row.DEP_KEY || '',
    dep_name: row.DEP_NAME || row.DEP_KEY || '',
    version: row.VERSION || '',
    source_type: row.SOURCE_TYPE || '',
    source_url: row.SOURCE_URL || '',
    title: row.TITLE || '',
    summary: row.SUMMARY || '',
    posted_at: row.POSTED_AT || '',
    detected_at: row.DETECTED_AT || '',
    delivery_status: row.DELIVERY_STATUS || '',
    delivery_error: row.DELIVERY_ERROR || '',
    delivery_at: row.DELIVERY_AT || '',
    created_time: row.CREATEDTIME || '',
  };
}

/** Which of a dependency's versions already notified — the set the scan diffs against. */
async function knownVersions(req, depKey) {
  const { zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT VERSION FROM ${TABLE} WHERE DEP_KEY = '${esc(depKey)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  return new Set(rows.map(r => String(r.VERSION || '')).filter(Boolean));
}

/**
 * Record one discovered release. Returns the row, or `null` when this version is already recorded —
 * so a caller can treat "nothing new" and "already notified" identically without a pre-check.
 */
async function insertNotification(req, entry) {
  const { table } = ds(req);
  const depKey = clip(entry.dep_key, LIMITS.DEP_KEY);
  const version = clip(entry.version, LIMITS.VERSION);
  if (!depKey || !version) throw Object.assign(new Error('dep_key and version are required.'), { status: 400 });

  const key = versionKey(depKey, version);
  const { zcql } = ds(req);
  let existing;
  try {
    existing = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE DEP_VERSION_KEY = '${esc(key)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  if (existing.length) return null;

  const row = {
    DEP_KEY: depKey,
    VERSION: version,
    DEP_VERSION_KEY: key,
    DEP_NAME: clip(entry.dep_name || depKey, LIMITS.DEP_NAME),
    SOURCE_TYPE: clip(entry.source_type, LIMITS.SOURCE_TYPE),
    SOURCE_URL: clip(entry.source_url, LIMITS.SOURCE_URL),
    TITLE: clip(entry.title, LIMITS.TITLE),
    SUMMARY: clip(entry.summary, SUMMARY_LIMIT),
    POSTED_AT: clip(entry.posted_at, 25),
    DETECTED_AT: nowIso(),
    DELIVERY_STATUS: entry.delivery_status || DELIVERY.PENDING,
    DELIVERY_ERROR: '',
    DELIVERY_AT: '',
  };
  const saved = await guard(() => table.insertRow(row));
  return toDto({ ...row, ROWID: (saved && saved.ROWID) || '' });
}

/**
 * The page's feed: newest first, across every dependency.
 *
 * Ordered by DETECTED_AT rather than POSTED_AT because POSTED_AT is blank for Learn-sourced rows
 * (that page has no per-version timestamp — the Python store writes `posted_at: 0` for all of
 * them), so sorting on it would bury exactly the releases a Learn-only dependency reports.
 */
async function listNotifications(req, { limit = 50, depKey = '' } = {}) {
  const { zcql } = ds(req);
  const capped = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  let where = '';
  if (depKey) where = ` WHERE DEP_KEY = '${esc(depKey)}'`;
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${COLUMNS} FROM ${TABLE}${where} ORDER BY DETECTED_AT DESC LIMIT ${capped}`
    ));
  } catch (e) {
    throw storeError(e);
  }
  return rows.map(toDto);
}

/** Stamp the outcome of posting a notification to its channel. */
async function setDelivery(req, rowId, status, error = '') {
  // insertRow is expected to echo a ROWID; if a platform response ever lacks one, losing the
  // delivery stamp must not fail the scan that already sent the message.
  if (!rowId) return false;
  const { table } = ds(req);
  await guard(() => table.updateRow({
    ROWID: String(rowId),
    DELIVERY_STATUS: status,
    DELIVERY_ERROR: clip(error, LIMITS.DELIVERY_ERROR),
    DELIVERY_AT: nowIso(),
  }));
  return true;
}

/** Remove a dependency's notifications — called when the dependency itself is removed. */
async function deleteForDependency(req, depKey) {
  const { table, zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE DEP_KEY = '${esc(depKey)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  for (const row of rows) {
    await guard(() => table.deleteRow(String(row.ROWID)));
  }
  return rows.length;
}

module.exports = {
  knownVersions, insertNotification, listNotifications, setDelivery, deleteForDependency,
  TABLE, DELIVERY, EXPECTED_COLUMNS,
};
