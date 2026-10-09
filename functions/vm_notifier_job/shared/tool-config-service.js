/* GENERATED COPY — do not edit.
 * Source: functions/welcome/tool-config-service.js
 * Regenerate: node scripts/sync-job-modules.js   (npm run sync:job)
 * Why: Catalyst packages each function directory separately, so the job function cannot require
 * across into functions/welcome at runtime. See functions/vm_notifier_job/index.js.
 */
/**
 * tool_config — a small, generic, UI-editable configuration store shared by any feature in this
 * app that needs a setting changeable without a redeploy (Risk Register's synced-teams list is the
 * first user; more will follow the same pattern instead of each growing its own bespoke table).
 *
 * Table: `tool_config`
 *   TOOL_KEY            Var Char   which feature this belongs to, e.g. 'risk_register'
 *   CONFIG_KEY           Var Char   which setting within that feature, e.g. 'team_names'
 *   CONFIG_LOOKUP_KEY    Var Char, Mandatory + Unique — app-computed `TOOL_KEY + '::' + CONFIG_KEY`.
 *                        Catalyst has no documented composite/multi-column unique constraint, so
 *                        this derived column is the DB-level backstop (same pattern used for
 *                        connection_config_index in claude/connection-config-store-design.md).
 *   CONFIG_VALUE         Text — JSON-encoded value (array/object/string/number/boolean, whatever
 *                        the caller passes to setConfig). Always JSON, even for a plain string, so
 *                        every reader parses the same way.
 *
 * Deliberately NOT for secrets — nothing here is encrypted. A connection's tokens/client secrets
 * still belong in `connection_credentials` (connections-service.js), never in this table.
 *
 * Usage — any feature just calls these two functions with its own TOOL_KEY:
 *   const teamNames = await getConfig(req, 'risk_register', 'team_names', ['Default Team']);
 *   await setConfig(req, 'risk_register', 'team_names', [...teamNames, 'New Team']);
 */

const TABLE = 'tool_config';

function ds(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) throw new Error('Catalyst authentication required');
  return { table: app.datastore().table(TABLE), zcql: app.zcql() };
}

const unwrap = rows => (rows || []).map(r => r[TABLE] || r);

/** Single-quoted ZCQL string literal — escape embedded quotes, same convention used elsewhere. */
function esc(value) {
  return String(value).replace(/'/g, "''");
}

const EXPECTED_COLUMNS =
  'TOOL_KEY, CONFIG_KEY, CONFIG_LOOKUP_KEY [Mandatory+Unique], CONFIG_VALUE, OWNER_TYPE, ' +
  'STORAGE_LOCATION, CONFIG_TYPE, IS_SENSITIVE';

/**
 * Columns added to `tool_config` in the console (2026-09) after this service was written, carried
 * over from the `connection_config_index` design in connection-config-store-design.md so the two
 * stores share one row shape. Four of them are **Mandatory**, so every insert must supply them —
 * omitting them is rejected with "Column OWNER_TYPE is mandatory and cannot be empty", which is
 * what broke the first write through this service.
 *
 * This service's rows are always the same shape, so these are constants rather than parameters:
 *   OWNER_TYPE       — the row's owner kind. 'TOOL' here; the sibling design uses a connection id.
 *   STORAGE_LOCATION — 'DATASTORE' | 'FILESTORE'. Always DATASTORE: this store is for small
 *                      settings, and nothing here approaches the 4 KB Stratus routing threshold.
 *   CONFIG_TYPE      — 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON' | 'BINARY'. Always JSON, because
 *                      setConfig JSON-encodes every value, even a plain string, so that every
 *                      reader parses the same way.
 *   IS_SENSITIVE     — always 'false'. This store is deliberately not for secrets (see the header);
 *                      a sensitive value would belong in CONFIG_VALUE_ENCRYPTED with the
 *                      crypto-util.js layer on top, which this service does not do.
 *
 * OWNER_TYPE's allowed values are not defined in any doc or code in this repo — 'TOOL' is inferred
 * from the column's role. Confirm against an existing row before relying on it.
 */
const ROW_DEFAULTS = {
  OWNER_TYPE: 'TOOL',
  STORAGE_LOCATION: 'DATASTORE',
  CONFIG_TYPE: 'JSON',
  IS_SENSITIVE: 'false',
};

/**
 * Any failure talking to this table becomes a 424 carrying the original DataStore message.
 *
 * Deliberately broad. An earlier version matched on a guessed wording ("table ... does not exist")
 * and let everything else fall through as an unhandled 500, which index.js masks as a flat
 * "Internal error" — so the one piece of information needed to fix it (the real message) was only
 * in the console function logs, and there is no logs API. The queries here are fixed strings over a
 * fixed schema, so a failure is a storage-configuration problem, not bad caller input; saying so
 * with the original text attached is strictly more useful than hiding it.
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

const lookupKey = (toolKey, configKey) => `${toolKey}::${configKey}`;

/**
 * Read one config value. Returns `defaultValue` (and seeds it as the stored value) the first time
 * this key has never been set — so a feature can call this unconditionally on every load without
 * a separate "does this exist yet" check.
 */
async function getConfig(req, toolKey, configKey, defaultValue) {
  const { table, zcql } = ds(req);
  const key = lookupKey(toolKey, configKey);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID, CONFIG_VALUE FROM ${TABLE} WHERE CONFIG_LOOKUP_KEY = '${esc(key)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  if (!rows.length) {
    await guard(() => table.insertRow({
      ...ROW_DEFAULTS,
      TOOL_KEY: toolKey, CONFIG_KEY: configKey, CONFIG_LOOKUP_KEY: key,
      CONFIG_VALUE: JSON.stringify(defaultValue),
    }));
    return defaultValue;
  }
  try {
    return JSON.parse(rows[0].CONFIG_VALUE);
  } catch {
    return defaultValue;
  }
}

/** Write one config value (create or replace), JSON-encoding whatever is passed. */
async function setConfig(req, toolKey, configKey, value) {
  const { table, zcql } = ds(req);
  const key = lookupKey(toolKey, configKey);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE CONFIG_LOOKUP_KEY = '${esc(key)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  const payload = {
    ...ROW_DEFAULTS,
    TOOL_KEY: toolKey, CONFIG_KEY: configKey, CONFIG_LOOKUP_KEY: key, CONFIG_VALUE: JSON.stringify(value),
  };
  if (rows.length) {
    await guard(() => table.updateRow({ ROWID: String(rows[0].ROWID), ...payload }));
  } else {
    await guard(() => table.insertRow(payload));
  }
  return value;
}

/**
 * Read one config value WITHOUT seeding a default — returns `undefined` when the key has never been
 * set. getConfig() deliberately self-seeds, which makes it useless as an existence check; this is
 * the variant for "does this already exist" and for reading a value whose absence is meaningful.
 */
async function readConfig(req, toolKey, configKey) {
  const { zcql } = ds(req);
  const key = lookupKey(toolKey, configKey);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID, CONFIG_VALUE FROM ${TABLE} WHERE CONFIG_LOOKUP_KEY = '${esc(key)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  if (!rows.length) return undefined;
  try {
    return JSON.parse(rows[0].CONFIG_VALUE);
  } catch {
    return undefined;
  }
}

/**
 * Every setting belonging to one feature, as `{ [CONFIG_KEY]: value }`.
 *
 * The pattern this enables: a feature that stores a LIST of things gives each one its own row
 * (CONFIG_KEY = the item's key) rather than one row holding a JSON array. Per-row writes then can't
 * clobber each other, and the 10,000-char CONFIG_VALUE cap applies per item instead of to the whole
 * list. The Dependency Upgrade Notifier is the first user — one row per watched dependency.
 */
async function listConfig(req, toolKey) {
  const { zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID, CONFIG_KEY, CONFIG_VALUE FROM ${TABLE} WHERE TOOL_KEY = '${esc(toolKey)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  const out = {};
  for (const row of rows) {
    try { out[row.CONFIG_KEY] = JSON.parse(row.CONFIG_VALUE); } catch { /* skip a corrupt row rather than failing the list */ }
  }
  return out;
}

/** Remove one setting. Returns false when it wasn't there. */
async function deleteConfig(req, toolKey, configKey) {
  const { table, zcql } = ds(req);
  const key = lookupKey(toolKey, configKey);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE CONFIG_LOOKUP_KEY = '${esc(key)}'`
    ));
  } catch (e) {
    throw storeError(e);
  }
  if (!rows.length) return false;
  await guard(() => table.deleteRow(String(rows[0].ROWID)));
  return true;
}

module.exports = { getConfig, setConfig, readConfig, listConfig, deleteConfig, TABLE };
