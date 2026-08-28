/**
 * Risk Register — the first slice of compliancemanager (risk_manager) ported into the Welcome app.
 *
 * Table: `compliance_risks` — CREATE THIS IN THE CONSOLE BEFORE DEPLOYING (Serverless → DataStore →
 * Create Table). Catalyst DataStore tables aren't defined in code (see catalyst.json — no schema
 * section), so this is a manual step, same as `connection_credentials` was:
 *
 *   RISK_ID            varchar, IsUnique   business key from the source register, e.g. "ISMS-014"
 *   REGISTER           varchar             'isms' | 'pims' | 'qms' | 'bcms'
 *   TITLE              varchar
 *   FEATURE            varchar
 *   SEVERITY           varchar             'critical' | 'high' | 'medium' | 'low'
 *   REVIEW_STATUS      varchar             'ok' | 'review' | 'dpia'
 *   OWNER_ID           varchar             Catalyst user_id — never email/name, per
 *                                          datastore-conventions.md's no-PII-identity rule
 *   DESCRIPTION        varchar
 *   GUIDELINE_CHECKS   varchar             JSON-encoded [["G6","pass"],["G7","fail"], ...]
 *   SOURCE_UPDATED_AT  varchar             'YYYY-MM-DD' (day-precision date convention)
 *
 * Data source: compliancemanager's `risk fetch_risks` pulls the four registers via the team's Zoho
 * Creator connection and compliancemanager's own OAuth (macOS Keychain scripts) — neither runs
 * inside a Catalyst function. Until that sync path is designed (open question, see
 * claude/compliancemanager-integration-design.md), this table starts empty and seedIfEmpty() below
 * loads the same demo rows the design used, so the screen is usable end to end. Replace
 * seedIfEmpty() with a real sync job once the integration approach is decided — do not build more
 * on top of the demo seed.
 *
 * `draftRisk` and `compareDpias` mirror `risk draft_risk` / `risk compare_risks`, both of which need
 * a server-callable LLM path (compliancemanager shells out to `claude -p`) that doesn't exist yet
 * either. They're stubbed to a clear 501 rather than faked.
 */

const TABLE = 'compliance_risks';

function ds(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) throw new Error('Catalyst authentication required');
  return { table: app.datastore().table(TABLE), zcql: app.zcql() };
}

const unwrap = rows => (rows || []).map(r => r[TABLE] || r);

/** Single-quoted ZCQL string literal — escape embedded quotes, same convention as crypto-util.esc. */
function esc(value) {
  return String(value).replace(/'/g, "''");
}

class ServiceUnavailable extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
  }
}

/** Turn a DataStore "no such table" error into an actionable message instead of a raw 500. */
function friendlyTableError(e) {
  const msg = String(e && e.message || '');
  if (/table/i.test(msg) && /(not exist|invalid|not found)/i.test(msg)) {
    return new ServiceUnavailable(
      `The "${TABLE}" DataStore table doesn't exist yet — create it first (see the schema in ` +
      'functions/welcome/risk-service.js).'
    );
  }
  return e;
}

const DEMO_ROWS = [
  { RISK_ID: 'ISMS-014', REGISTER: 'isms', TITLE: 'Backup restore tested less than annually',
    FEATURE: 'Backup & Recovery', SEVERITY: 'high', REVIEW_STATUS: 'review',
    DESCRIPTION: 'Restore drills are logged only sporadically; no evidence of a full restore test in the last 12 months.',
    GUIDELINE_CHECKS: JSON.stringify([['G6', 'pass'], ['G7', 'pass'], ['G8', 'fail'], ['G9', 'pass'], ['G10', 'pass'], ['G19', 'fail']]),
    SOURCE_UPDATED_AT: '2026-08-20' },
  { RISK_ID: 'PIMS-031', REGISTER: 'pims', TITLE: 'Notification emails stored unencrypted in history table',
    FEATURE: 'Notifications', SEVERITY: 'critical', REVIEW_STATUS: 'dpia',
    DESCRIPTION: 'The notification history table persists rendered email bodies in plaintext; flagged by DPIA-2026-07 as an uncovered risk.',
    GUIDELINE_CHECKS: JSON.stringify([['G6', 'pass'], ['G7', 'fail'], ['G8', 'pass'], ['G9', 'pass'], ['G10', 'fail'], ['G19', 'fail']]),
    SOURCE_UPDATED_AT: '2026-08-18' },
  { RISK_ID: 'QMS-009', REGISTER: 'qms', TITLE: 'Release checklist missing rollback verification step',
    FEATURE: 'Release Process', SEVERITY: 'medium', REVIEW_STATUS: 'ok',
    DESCRIPTION: 'The release checklist does not require confirming a rollback path before sign-off.',
    GUIDELINE_CHECKS: JSON.stringify([['G6', 'pass'], ['G7', 'pass'], ['G8', 'pass'], ['G9', 'pass'], ['G10', 'pass'], ['G19', 'pass']]),
    SOURCE_UPDATED_AT: '2026-08-15' },
  { RISK_ID: 'BCMS-004', REGISTER: 'bcms', TITLE: 'DR failover runbook not updated after infra migration',
    FEATURE: 'Disaster Recovery', SEVERITY: 'high', REVIEW_STATUS: 'review',
    DESCRIPTION: 'The failover runbook still references the retired data center; needs a rewrite against current infra.',
    GUIDELINE_CHECKS: JSON.stringify([['G6', 'pass'], ['G7', 'pass'], ['G8', 'pass'], ['G9', 'fail'], ['G10', 'pass'], ['G19', 'pass']]),
    SOURCE_UPDATED_AT: '2026-08-12' },
  { RISK_ID: 'ISMS-021', REGISTER: 'isms', TITLE: 'Service account credentials rotated on an ad-hoc basis',
    FEATURE: 'Credential Management', SEVERITY: 'medium', REVIEW_STATUS: 'ok',
    DESCRIPTION: 'Rotation happens but is not on a fixed schedule; recommend a quarterly cadence with an audit trail.',
    GUIDELINE_CHECKS: JSON.stringify([['G6', 'pass'], ['G7', 'pass'], ['G8', 'pass'], ['G9', 'pass'], ['G10', 'pass'], ['G19', 'pass']]),
    SOURCE_UPDATED_AT: '2026-08-10' },
];

async function seedIfEmpty(req) {
  const { table, zcql } = ds(req);
  let existing;
  try {
    existing = unwrap(await zcql.executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`));
  } catch (e) {
    throw friendlyTableError(e);
  }
  if (existing.length) return;
  for (const row of DEMO_ROWS) {
    // eslint-disable-next-line no-await-in-loop
    await table.insertRow(row);
  }
}

const toPublic = row => ({
  id: row.ROWID,
  risk_id: row.RISK_ID,
  register: row.REGISTER,
  title: row.TITLE,
  feature: row.FEATURE,
  severity: row.SEVERITY,
  status: row.REVIEW_STATUS,
  description: row.DESCRIPTION,
  checks: (() => { try { return JSON.parse(row.GUIDELINE_CHECKS || '[]'); } catch { return []; } })(),
  updated_at: row.SOURCE_UPDATED_AT,
});

/** GET /api/risks — filters: register, status, severity, q (matches RISK_ID or TITLE). */
async function listRisks(req, filters = {}) {
  await seedIfEmpty(req);
  const { zcql } = ds(req);
  const clauses = [];
  if (filters.register) clauses.push(`REGISTER = '${esc(filters.register)}'`);
  if (filters.status) clauses.push(`REVIEW_STATUS = '${esc(filters.status)}'`);
  if (filters.severity) clauses.push(`SEVERITY = '${esc(filters.severity)}'`);
  if (filters.q) {
    const q = esc(filters.q);
    clauses.push(`(RISK_ID LIKE '%${q}%' OR TITLE LIKE '%${q}%')`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID, RISK_ID, REGISTER, TITLE, FEATURE, SEVERITY, REVIEW_STATUS, DESCRIPTION, ` +
      `GUIDELINE_CHECKS, SOURCE_UPDATED_AT FROM ${TABLE} ${where} ORDER BY SOURCE_UPDATED_AT DESC`
    ));
  } catch (e) {
    throw friendlyTableError(e);
  }
  return { success: true, risks: rows.map(toPublic) };
}

/** GET /api/risks/:riskId */
async function getRisk(req, riskId) {
  const { zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID, RISK_ID, REGISTER, TITLE, FEATURE, SEVERITY, REVIEW_STATUS, DESCRIPTION, ` +
      `GUIDELINE_CHECKS, SOURCE_UPDATED_AT FROM ${TABLE} WHERE RISK_ID = '${esc(riskId)}'`
    ));
  } catch (e) {
    throw friendlyTableError(e);
  }
  if (!rows.length) {
    const err = new Error('No such risk');
    err.status = 404;
    throw err;
  }
  return { success: true, risk: toPublic(rows[0]) };
}

/** POST /api/risks/draft — mirrors `risk draft_risk`. Needs a server-callable LLM path first. */
async function draftRisk() {
  const err = new Error(
    'Drafting a risk needs a server-callable LLM path (compliancemanager currently shells out to ' +
    '`claude -p`), which this function does not have yet. Not implemented.'
  );
  err.status = 501;
  throw err;
}

/** POST /api/risks/compare-dpias — mirrors `risk compare_risks`. Needs the DMS Manager + LLM path. */
async function compareDpias() {
  const err = new Error(
    'Comparing against DPIAs needs the DMS Manager (Zoho Writer fetch) and the same LLM path as ' +
    'draftRisk, neither of which is wired up yet. Not implemented.'
  );
  err.status = 501;
  throw err;
}

module.exports = { listRisks, getRisk, draftRisk, compareDpias, TABLE };
