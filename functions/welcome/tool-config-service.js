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

class MissingTable extends Error {
  constructor(message) {
    super(message);
    this.status = 424; // deliberately under 500 — see risk-service.js's MissingTable for why
  }
}

function friendlyTableError(e) {
  const msg = String(e && e.message || '');
  if (/table/i.test(msg) && /(not exist|invalid|not found)/i.test(msg)) {
    return new MissingTable(
      `The "${TABLE}" DataStore table doesn't exist yet — create it first (Var Char TOOL_KEY, ` +
      'Var Char CONFIG_KEY, Var Char CONFIG_LOOKUP_KEY [Mandatory+Unique], Text CONFIG_VALUE). ' +
      'See datastore-conventions.md.'
    );
  }
  return e;
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
    throw friendlyTableError(e);
  }
  if (!rows.length) {
    await table.insertRow({
      TOOL_KEY: toolKey, CONFIG_KEY: configKey, CONFIG_LOOKUP_KEY: key,
      CONFIG_VALUE: JSON.stringify(defaultValue),
    });
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
    throw friendlyTableError(e);
  }
  const payload = { TOOL_KEY: toolKey, CONFIG_KEY: configKey, CONFIG_LOOKUP_KEY: key, CONFIG_VALUE: JSON.stringify(value) };
  if (rows.length) {
    await table.updateRow({ ROWID: String(rows[0].ROWID), ...payload });
  } else {
    await table.insertRow(payload);
  }
  return value;
}

module.exports = { getConfig, setConfig, TABLE };
