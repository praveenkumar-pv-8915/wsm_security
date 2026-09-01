/**
 * Risk Register — the first slice of compliancemanager (risk_manager) ported into the Welcome app.
 *
 * Table: `compliance_risks` — created manually via Serverless -> DataStore -> Create Table (see
 * datastore-conventions.md for the column definitions). Catalyst DataStore tables aren't defined
 * in code, so this is a manual step, same as `connection_credentials` was.
 *
 * Data source: the real Zoho Creator "Compliance Management" app (owner `zohointranet`, app
 * `risk-assessment`), fetched LIVE through this app's own Connections framework
 * (connections-service.js's callConnection, using the shared/personal `zoho-creator` connection
 * configured on the Connections tab) — no local file, no demo data. This mirrors compliancemanager's
 * own `risk fetch_risks` (risk_manager/fetch_risks.py), which hits the exact same owner/app/report
 * names but authenticates via macOS Keychain scripts outside Catalyst; here it goes through the
 * connection this app already manages.
 *
 * `syncFromCreator()` pulls all four registers (ISMS/PIMS/QMS/BCMS), filters to this team
 * ("Log360 and EventLog Analyzer" — the one team this app's data belongs to, same filter
 * compliancemanager's `list_team_records` applies), and fully replaces `compliance_risks`'s
 * contents with what Creator returns right now. It runs once automatically the first time the
 * table is empty, and again any time the "Sync from Creator" action is used — this is a pull
 * snapshot, not a push/live-tailing sync, so re-run it to pick up changes made in Creator since.
 *
 * Known gaps in what a live Creator pull can populate:
 *   - OWNER_ID is always blank. Creator's Risk_Owner field is a name/email, and this app's
 *     no-PII-identity convention means email/name is never stored as identity — only a Catalyst
 *     user_id, which nothing maps these owners to yet.
 *   - REVIEW_STATUS is always 'ok' out of syncFromCreator; reviewGuidelines() (POST
 *     /api/risks/review) is what can set it to 'review'. 'dpia' is still not written anywhere —
 *     compareDpias() below reports coverage gaps in its response rather than writing them back
 *     onto rows, so nothing currently sets REVIEW_STATUS='dpia'. A follow-up could have
 *     compareDpias tag the matched RISK_IDs of 'missing' rows with REVIEW_STATUS='dpia' if the
 *     Risk Register screen should surface that inline.
 *
 * `draftRisk` mirrors `risk draft_risk`, which needs a server-callable LLM path (compliancemanager
 * shells out to `claude -p`) — this app now has one, chatCompletion() in connections-service.js,
 * but draftRisk isn't wired to it yet, so it stays a clear 501 rather than faked.
 *
 * `compareDpias` mirrors `risk compare_risks` (risk_manager/compare_risks.py) and IS implemented —
 * see the "compare vs. DPIA" section below — using the zoho-creator (documents + registers),
 * zoho-writer (document export) and zoho-platformai (comparison judgement) connections this app
 * already has, same as compliancemanager's DMS Manager + LLM path but through this app's own
 * Connections framework instead of macOS Keychain scripts / `claude -p`.
 */

const fs = require('fs');
const path = require('path');
const { callConnection, chatCompletion, AiUnavailable } = require('./connections-service');
const { extractRiskRows } = require('./dpia-parser');
const toolConfig = require('./tool-config-service');
const { checkRegistryRisk, summarizeChecks, IMPLEMENTED_RULES, PENDING_LLM_RULES } = require('./risk-review');

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

/**
 * A 424 (Failed Dependency), not 503 — deliberately under 500. The app's global error handler in
 * index.js shows a generic "Internal error" for any status >= 500 (right call for genuine
 * unexpected failures, wrong one here: this message is the whole point, it names exactly what's
 * missing and how to fix it, and there's nothing sensitive in it).
 */
class MissingTable extends Error {
  constructor(message) {
    super(message);
    this.status = 424;
  }
}

/** No active/working Zoho Creator connection — also deliberately under 500 (see MissingTable). */
class MissingConnection extends Error {
  constructor(message) {
    super(message);
    this.status = 424;
  }
}

// Columns added 2026-09-01 (row-level detail, see datastore-conventions.md's compliance_risks
// worked example) that every listRisks/getRisk SELECT now names — until these exist in the live
// table, ZCQL rejects the query and friendlyTableError below turns that into an actionable 424
// instead of a masked "Internal error".
const NEW_DETAIL_COLUMNS = [
  'ISSUE', 'THREAT', 'VULNERABILITY', 'CONTROL', 'RISK_TREATMENT',
  'INHERENT_SCORE', 'INHERENT_RATING', 'REVISED_SCORE', 'REVISED_RATING',
  'LIKELIHOOD', 'IMPACT', 'ASSET_VALUE', 'RACI_ID',
];

/**
 * Turn a DataStore "no such table" / "no such column" error into an actionable message instead of
 * a raw masked 500. Catalyst's exact wording for either case isn't documented, so this matches
 * broadly on "table"/"column" + a not-found-shaped word rather than one exact string.
 */
function friendlyTableError(e) {
  const msg = String(e && e.message || '');
  if (/column/i.test(msg) && /(not exist|invalid|not found|unknown)/i.test(msg)) {
    return new MissingTable(
      `The "${TABLE}" DataStore table is missing one or more columns this query needs — add ` +
      `${NEW_DETAIL_COLUMNS.join(', ')} (see datastore-conventions.md's compliance_risks worked ` +
      `example for types), then retry. Original error: ${msg}`
    );
  }
  if (/table/i.test(msg) && /(not exist|invalid|not found)/i.test(msg)) {
    return new MissingTable(
      `The "${TABLE}" DataStore table doesn't exist yet — create it first (see the schema in ` +
      'functions/welcome/risk-service.js).'
    );
  }
  return e;
}

const CREATOR_OWNER = 'zohointranet';
const CREATOR_APP = 'risk-assessment';
// Which Creator teams' risks to pull into this app — configurable from the UI (Risk Register's
// "Teams synced" panel), backed by the shared tool_config table (not a bespoke one — any future
// feature needing a small UI-editable setting reuses the same table via toolConfig.get/setConfig).
const CONFIG_TOOL_KEY = 'risk_register';
const CONFIG_TEAM_NAMES_KEY = 'team_names';
const DEFAULT_TEAM_NAMES = ['Log360 and EventLog Analyzer'];

/** GET /api/team-filters — the configured list (self-seeds the default the first time it's read). */
async function listTeamFilters(req) {
  const teams = await toolConfig.getConfig(req, CONFIG_TOOL_KEY, CONFIG_TEAM_NAMES_KEY, DEFAULT_TEAM_NAMES);
  return { success: true, teams: teams.map(name => ({ team_name: name })) };
}

/** POST /api/team-filters — body: { team_name }. Must match Creator's Team_Name exactly. */
async function addTeamFilter(req, teamName) {
  const name = String(teamName || '').trim();
  if (!name) {
    const err = new Error('team_name is required');
    err.status = 400;
    throw err;
  }
  if (name.length > 100) {
    const err = new Error('team_name must be 100 characters or fewer');
    err.status = 400;
    throw err;
  }
  const current = await toolConfig.getConfig(req, CONFIG_TOOL_KEY, CONFIG_TEAM_NAMES_KEY, DEFAULT_TEAM_NAMES);
  if (current.includes(name)) {
    const err = new Error(`"${name}" is already in the list`);
    err.status = 409;
    throw err;
  }
  const next = [...current, name];
  await toolConfig.setConfig(req, CONFIG_TOOL_KEY, CONFIG_TEAM_NAMES_KEY, next);
  return { success: true, team_name: name };
}

/** DELETE /api/team-filters/:teamName (URL-encoded team name, not a row id — see tool-config-service.js) */
async function removeTeamFilter(req, teamName) {
  const current = await toolConfig.getConfig(req, CONFIG_TOOL_KEY, CONFIG_TEAM_NAMES_KEY, DEFAULT_TEAM_NAMES);
  const next = current.filter(name => name !== teamName);
  await toolConfig.setConfig(req, CONFIG_TOOL_KEY, CONFIG_TEAM_NAMES_KEY, next);
  return { success: true };
}

/** Internal — the current team list as plain strings, for fetchRegister/syncFromCreator. */
async function getTeamNames(req) {
  return toolConfig.getConfig(req, CONFIG_TOOL_KEY, CONFIG_TEAM_NAMES_KEY, DEFAULT_TEAM_NAMES);
}

// register -> Creator report link name (functions/welcome's own connection, same names
// compliancemanager's conf/config.yaml uses against the same Creator app).
const REGISTER_REPORTS = {
  isms: 'All_Risk_Assessments',
  pims: 'ISO_27701_PIMS_Report',
  qms: 'QMS_Report',
  bcms: 'BCMS_Risk_Report',
};

const SEVERITY_MAP = { 'Very High': 'critical', High: 'high', Medium: 'medium', Low: 'low', 'Very Low': 'low' };
// Per-register impact-score field name — see normalize.py in the source compliancemanager tool
// (risk_manager/normalize.py's _IMPACT_FIELD): the four register apps each expose the same
// "impact score" concept under a different Creator field name.
const IMPACT_FIELD = {
  isms: 'Total_Impact_Score_Max_of_C_I_A',
  pims: 'Privacy_Impact_Score',
  qms: 'QMS_Impact_Score',
  bcms: 'BCMS_Impact_Score',
};
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                 Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

/** Creator's Modified_Time looks like "03-Aug-2026 11:19:34" -> 'YYYY-MM-DD' (day-precision convention). */
function parseModifiedDate(raw) {
  const m = /^(\d{2})-(\w{3})-(\d{4})/.exec(String(raw || ''));
  const mm = m && MONTHS[m[2]];
  return mm ? `${m[3]}-${mm}-${m[1]}` : '';
}

/** One raw Creator record (from any of the 4 registers) -> a compliance_risks row. */
function mapRegisterRecord(record, register) {
  const threat = String(record.Threat || '').trim();
  const issue = String(record.Issue_Please_fill_where_applicable || '').trim();
  const vulnerability = String(record.Vulnerability || issue || '').trim();
  const statement = String(record.Risk || '').trim();
  const title = (statement || threat || '(untitled risk)').slice(0, 250);
  const controlDesc = String(record.Description_of_the_Control || '').trim();
  const treatment = String(record.Risk_Treatment_Options || '').trim();
  // RACI mapping: ISMS exposes the lookup as a flat "RACI_Activity.RACI_ID" string; PIMS/BCMS as a
  // RACI_Activity object; QMS has no RACI field — see normalize.py's normalize_register_record.
  const raciRaw = record.RACI_Activity;
  let raciId = String(record['RACI_Activity.RACI_ID'] || '').trim();
  if (!raciId && raciRaw && typeof raciRaw === 'object') raciId = String(raciRaw.RACI_ID || '').trim();
  const toIntOrNull = (v) => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isNaN(n) ? null : n;
  };
  const likelihood = toIntOrNull(record.Likelihood);
  const impact = toIntOrNull(record[IMPACT_FIELD[register] || '']);
  const assetValue = toIntOrNull(record.Asset_Value);
  const descParts = [];
  if (threat) descParts.push(`Threat: ${threat}`);
  if (vulnerability) descParts.push(`Vulnerability: ${vulnerability}`);
  if (controlDesc) descParts.push(`Control: ${controlDesc}`);
  return {
    RISK_ID: String(record.Risk_ID || '').trim(),
    REGISTER: register,
    TEAM_NAME: String(record.Team_Name || '').trim(),
    TITLE: title,
    FEATURE: String(record.Feature || '').trim().slice(0, 150),
    SEVERITY: SEVERITY_MAP[String(record.Risk_Rating || '').trim()] || 'medium',
    REVIEW_STATUS: 'ok', // no live guideline-review source yet — see header
    OWNER_ID: '',
    DESCRIPTION: descParts.join(' | ') || title,
    GUIDELINE_CHECKS: JSON.stringify([]),
    SOURCE_UPDATED_AT: parseModifiedDate(record.Modified_Time),
    // Row-level detail columns (2026-09-01) — shown as real table columns on the Risk Register
    // screen instead of a per-row live Creator call. None of these are PII (that carve-out is
    // specifically the reviewer's email in "last reviewed by", still fetched live-only by
    // previewRisk() below and never cached) — see datastore-conventions.md.
    ISSUE: issue.slice(0, 2000),
    THREAT: threat.slice(0, 2000),
    VULNERABILITY: vulnerability.slice(0, 2000),
    CONTROL: controlDesc.slice(0, 2000),
    RISK_TREATMENT: treatment.slice(0, 2000),
    INHERENT_SCORE: String(record.Inherent_Risk_Score ?? '').trim().slice(0, 20),
    INHERENT_RATING: String(record.Risk_Rating || '').trim().slice(0, 30),
    REVISED_SCORE: String(record.Revised_Risk_Score ?? '').trim().slice(0, 20),
    REVISED_RATING: String(record.Revised_Risk_Rating || '').trim().slice(0, 30),
    // Guideline-review inputs (2026-09-01, see risk-review.js) — the ISMS scoring inputs
    // (Likelihood/Impact/Asset Value are 0-4-ish small ints, never PII) and the RACI mapping used
    // by rules G7/G8/G9/G19.
    LIKELIHOOD: likelihood,
    IMPACT: impact,
    ASSET_VALUE: assetValue,
    RACI_ID: raciId.slice(0, 50),
  };
}

/** Live-fetch one register's report from Zoho Creator through this app's own connection. */
async function fetchRegister(req, register, reportLink, teamNames) {
  const criteria = `(${teamNames.map(t => `Team_Name.contains("${t}")`).join(' || ')})`;
  const path = `/creator/v2.1/data/${CREATOR_OWNER}/${CREATOR_APP}/report/${reportLink}` +
    `?max_records=1000&criteria=${encodeURIComponent(criteria)}`;

  let resp;
  try {
    resp = await callConnection(req, 'zoho-creator', path);
  } catch (e) {
    throw new MissingConnection(
      `Couldn't reach Zoho Creator for the "${register}" register: ${e.message}. Configure the ` +
      'Zoho Creator connection on the Connections tab first.'
    );
  }
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const detail = json && (json.message || json.code) ? ` — ${json.message || json.code}` : '';
    throw new MissingConnection(
      `Zoho Creator returned HTTP ${resp.status}${detail} fetching "${reportLink}". Check that the ` +
      'Zoho Creator connection is active with report.READ scope (Connections tab).'
    );
  }
  const records = Array.isArray(json && json.data) ? json.data : [];
  const teamSet = new Set(teamNames);
  return records
    .filter(r => teamSet.has(String(r.Team_Name || '')))
    .map(r => mapRegisterRecord(r, register));
}

/** Pull all 4 registers live and fully replace compliance_risks with what Creator has right now. */
async function syncFromCreator(req) {
  const { table, zcql } = ds(req);
  const teamNames = await getTeamNames(req);
  if (!teamNames.length) {
    const err = new Error('No teams are configured to sync — add at least one on the "Teams synced" panel.');
    err.status = 400;
    throw err;
  }
  const byRegister = {};
  const rows = [];
  for (const [register, reportLink] of Object.entries(REGISTER_REPORTS)) {
    // eslint-disable-next-line no-await-in-loop
    const mapped = await fetchRegister(req, register, reportLink, teamNames);
    byRegister[register] = mapped.length;
    rows.push(...mapped);
  }

  // RISK_ID is Mandatory + Unique in the table, but Creator itself does not guarantee that
  // uniquely-keyed reports never repeat a row (seen in practice: the same Risk_ID coming back
  // more than once, most likely a related/subform artifact on the Creator side). Rather than
  // trust the source, de-dupe defensively here — first occurrence wins — so a repeat in Creator's
  // response can never turn into a 409 DUPLICATE_VALUE that aborts the sync partway through.
  const seen = new Set();
  const deduped = [];
  let skippedNoId = 0;
  let skippedDuplicate = 0;
  for (const row of rows) {
    if (!row.RISK_ID) { skippedNoId += 1; continue; }
    if (seen.has(row.RISK_ID)) { skippedDuplicate += 1; continue; }
    seen.add(row.RISK_ID);
    deduped.push(row);
  }

  let existing;
  try {
    existing = unwrap(await zcql.executeZCQLQuery(`SELECT ROWID FROM ${TABLE}`));
  } catch (e) {
    throw friendlyTableError(e);
  }
  for (const row of existing) {
    // eslint-disable-next-line no-await-in-loop
    await table.deleteRow(row.ROWID);
  }
  for (const row of deduped) {
    // eslint-disable-next-line no-await-in-loop
    await table.insertRow(row);
  }

  return {
    success: true,
    synced: deduped.length,
    by_register: byRegister,
    skipped_no_id: skippedNoId,
    skipped_duplicate: skippedDuplicate,
  };
}

/** Auto-sync once, only the first time the table is empty — a manual "Sync from Creator" action
 *  (POST /api/risks/sync) is how a refresh happens after that. */
async function ensureSynced(req) {
  const { zcql } = ds(req);
  let existing;
  try {
    existing = unwrap(await zcql.executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`));
  } catch (e) {
    throw friendlyTableError(e);
  }
  if (existing.length) return;
  await syncFromCreator(req);
}

/** GUIDELINE_CHECKS holds either the old plain [[code,'pass'|'fail'], ...] shape (rows reviewed
 *  before finding detail was added) or the newer { results, findings } shape — normalize both to
 *  the same { results, findings } object so callers never have to care which one a row has. */
function parseGuidelineChecks(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return { results: [], findings: [] };
  }
  if (Array.isArray(parsed)) return { results: parsed, findings: [] };
  return { results: parsed.results || [], findings: parsed.findings || [] };
}

const toPublic = row => ({
  id: row.ROWID,
  risk_id: row.RISK_ID,
  register: row.REGISTER,
  team_name: row.TEAM_NAME,
  title: row.TITLE,
  feature: row.FEATURE,
  severity: row.SEVERITY,
  status: row.REVIEW_STATUS,
  description: row.DESCRIPTION,
  checks: parseGuidelineChecks(row.GUIDELINE_CHECKS).results,
  guideline_findings: parseGuidelineChecks(row.GUIDELINE_CHECKS).findings,
  updated_at: row.SOURCE_UPDATED_AT,
  issue: row.ISSUE,
  threat: row.THREAT,
  vulnerability: row.VULNERABILITY,
  control: row.CONTROL,
  risk_treatment: row.RISK_TREATMENT,
  inherent_score: row.INHERENT_SCORE,
  inherent_rating: row.INHERENT_RATING,
  revised_score: row.REVISED_SCORE,
  revised_rating: row.REVISED_RATING,
  likelihood: row.LIKELIHOOD,
  impact: row.IMPACT,
  asset_value: row.ASSET_VALUE,
  raci_id: row.RACI_ID,
});

/** GET /api/risks — filters: register, status, severity, q (matches RISK_ID or TITLE). */
async function listRisks(req, filters = {}) {
  await ensureSynced(req);
  const { zcql } = ds(req);
  const clauses = [];
  if (filters.register) clauses.push(`REGISTER = '${esc(filters.register)}'`);
  if (filters.status) clauses.push(`REVIEW_STATUS = '${esc(filters.status)}'`);
  if (filters.severity) clauses.push(`SEVERITY = '${esc(filters.severity)}'`);
  if (filters.team) clauses.push(`TEAM_NAME = '${esc(filters.team)}'`);
  if (filters.q) {
    const q = esc(filters.q);
    clauses.push(`(RISK_ID LIKE '%${q}%' OR TITLE LIKE '%${q}%')`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID, RISK_ID, REGISTER, TEAM_NAME, TITLE, FEATURE, SEVERITY, REVIEW_STATUS, ` +
      `DESCRIPTION, GUIDELINE_CHECKS, SOURCE_UPDATED_AT, ISSUE, THREAT, VULNERABILITY, ` +
      `CONTROL, RISK_TREATMENT, INHERENT_SCORE, INHERENT_RATING, REVISED_SCORE, REVISED_RATING, ` +
      `LIKELIHOOD, IMPACT, ASSET_VALUE, RACI_ID FROM ${TABLE} ${where} ` +
      `ORDER BY SOURCE_UPDATED_AT DESC`
    ));
  } catch (e) {
    throw friendlyTableError(e);
  }

  // Paginated in-memory, not via ZCQL LIMIT/OFFSET — the filtered result set here is small enough
  // (this app's own risk data, not an open-ended table) that fetching it whole and slicing is
  // simpler than juggling a separate COUNT query, and it's what makes `total` below correct.
  const total = rows.length;
  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 20, 1), 200);
  const page = Math.max(parseInt(filters.page, 10) || 1, 1);
  const start = (page - 1) * limit;
  const pageRows = rows.slice(start, start + limit);

  return { success: true, risks: pageRows.map(toPublic), total, page, limit };
}

/** GET /api/risks/:riskId */
async function getRisk(req, riskId) {
  const { zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ROWID, RISK_ID, REGISTER, TEAM_NAME, TITLE, FEATURE, SEVERITY, REVIEW_STATUS, ` +
      `DESCRIPTION, GUIDELINE_CHECKS, SOURCE_UPDATED_AT, ISSUE, THREAT, VULNERABILITY, ` +
      `CONTROL, RISK_TREATMENT, INHERENT_SCORE, INHERENT_RATING, REVISED_SCORE, REVISED_RATING, ` +
      `LIKELIHOOD, IMPACT, ASSET_VALUE, RACI_ID FROM ${TABLE} WHERE RISK_ID = '${esc(riskId)}'`
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

/** Creator's "DD-Mon-YYYY HH:MM:SS : email" review-history string -> its most recent entry. */
function lastReviewEntry(raw) {
  const lines = String(raw || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { on: '', by: '' };
  const last = lines[lines.length - 1];
  const idx = last.lastIndexOf(':');
  if (idx === -1) return { on: '', by: '' };
  return {
    on: parseModifiedDate(last.slice(0, idx).trim()),
    by: last.slice(idx + 1).trim(),
  };
}

/**
 * GET /api/risks/:riskId/preview — a fresh, single-record, LIVE Creator call for the row-expand
 * "Last reviewed" detail. As of 2026-09-01, Issue/Threat/Vulnerability/Control/Risk Treatment/
 * scores are real compliance_risks columns (populated by syncFromCreator, see mapRegisterRecord)
 * and render directly as table columns — no live call needed for those anymore. This endpoint now
 * exists for exactly one field: the reviewer's email in "last reviewed by", which IS real PII and
 * still deliberately never touches DataStore — see datastore-conventions.md's No-PII decision.
 */
async function previewRisk(req, riskId) {
  const { zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT RISK_ID, REGISTER FROM ${TABLE} WHERE RISK_ID = '${esc(riskId)}'`
    ));
  } catch (e) {
    throw friendlyTableError(e);
  }
  if (!rows.length) {
    const err = new Error('No such risk');
    err.status = 404;
    throw err;
  }
  const register = rows[0].REGISTER;
  const reportLink = REGISTER_REPORTS[register];
  if (!reportLink) throw new Error(`Unknown register '${register}' for risk '${riskId}'`);

  const criteria = `Risk_ID == "${riskId.replace(/"/g, '\\"')}"`;
  // Creator's v2.1 API only accepts max_records of 200/500/1000 (an earlier max_records=1 got a
  // 400 "Please enter a valid input for 'max_records' key"); 200 is the smallest legal value, and
  // criteria already scopes this to (at most) one Risk_ID so it's still effectively a single fetch.
  const path = `/creator/v2.1/data/${CREATOR_OWNER}/${CREATOR_APP}/report/${reportLink}` +
    `?max_records=200&criteria=${encodeURIComponent(criteria)}`;

  let resp;
  try {
    resp = await callConnection(req, 'zoho-creator', path);
  } catch (e) {
    throw new MissingConnection(
      `Couldn't reach Zoho Creator for "${riskId}": ${e.message}. Configure the Zoho Creator ` +
      'connection on the Connections tab first.'
    );
  }
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const detail = json && (json.message || json.code) ? ` — ${json.message || json.code}` : '';
    throw new MissingConnection(`Zoho Creator returned HTTP ${resp.status}${detail} for "${riskId}".`);
  }
  const record = Array.isArray(json && json.data) ? json.data[0] : null;
  if (!record) {
    const err = new Error(`"${riskId}" was not found in Creator right now (it may have been removed).`);
    err.status = 404;
    throw err;
  }

  const lastReview = lastReviewEntry(record.Risk_Review_Stats);

  return {
    success: true,
    preview: {
      risk_id: riskId,
      last_reviewed_on: lastReview.on,
      last_reviewed_by: lastReview.by,
    },
  };
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

/* ------------------------------------------------------------------ compare vs. DPIA */

// DPIA documents live in the same Creator app/connection as the risk registers, in the
// "Create_Template_Document_Report" report (compliancemanager's dms_manager hits the exact same
// report — see conf/config.yaml's sources.connections.reports.documents /
// dpia_template_contains). No new connection or DataStore table needed — this reuses the existing
// zoho-creator (documents + registers), zoho-writer (document export) and zoho-platformai
// (comparison judgement) connections already wired up for this app.
const DMS_REPORT = 'Create_Template_Document_Report';
const DPIA_TEMPLATE_CONTAINS = 'data protection impact assessment';

/** One raw Creator document record -> { document_id, name, template, writer_doc_id }. */
function mapDocRecord(record) {
  const link = record.Document_Link;
  const url = String((link && typeof link === 'object' ? link.url : link) || '').trim();
  return {
    document_id: String(record.Document_ID || '').trim(),
    name: String(record.Document_Name || '').trim(),
    template: String(record.Choose_Template || '').trim(),
    writer_doc_id: url ? url.replace(/\/+$/, '').split('/').pop() : '',
  };
}

/** Live-fetch the DMS "documents" report from the same Creator app/connection the registers use,
 *  filtered to the configured team(s) — same pattern as fetchRegister above. */
async function fetchDmsDocuments(req, teamNames) {
  const criteria = `(${teamNames.map(t => `Team_Name.contains("${t}")`).join(' || ')})`;
  const path = `/creator/v2.1/data/${CREATOR_OWNER}/${CREATOR_APP}/report/${DMS_REPORT}` +
    `?max_records=1000&criteria=${encodeURIComponent(criteria)}`;
  let resp;
  try {
    resp = await callConnection(req, 'zoho-creator', path);
  } catch (e) {
    throw new MissingConnection(
      `Couldn't reach Zoho Creator for the document list: ${e.message}. Configure the Zoho Creator ` +
      'connection on the Connections tab first.'
    );
  }
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const detail = json && (json.message || json.code) ? ` — ${json.message || json.code}` : '';
    throw new MissingConnection(
      `Zoho Creator returned HTTP ${resp.status}${detail} fetching "${DMS_REPORT}". Check that the ` +
      'Zoho Creator connection is active with report.READ scope (Connections tab).'
    );
  }
  const records = Array.isArray(json && json.data) ? json.data : [];
  const teamSet = new Set(teamNames);
  return records
    .filter(r => teamSet.has(String(r.Team_Name || '')))
    .map(mapDocRecord);
}

/** Download one Writer document as HTML, straight through the zoho-writer connection (bypassing
 *  the generic probe operation registered for it, which only fetches metadata — see
 *  connections-registry.js's FETCH_OPERATIONS['zoho-writer'] vs. the real export endpoint below). */
async function fetchWriterHtml(req, writerDocId) {
  const path = `/writer/api/v1/download/${encodeURIComponent(writerDocId)}?format=html`;
  let resp;
  try {
    resp = await callConnection(req, 'zoho-writer', path);
  } catch (e) {
    throw new MissingConnection(
      `Couldn't reach Zoho Writer for document ${writerDocId}: ${e.message}. Configure the Zoho ` +
      'Writer connection on the Connections tab first.'
    );
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `Zoho Writer returned HTTP ${resp.status} for document ${writerDocId}` +
      (body ? ` — ${body.slice(0, 200)}` : '')
    );
  }
  return resp.text();
}

/** compliance_risks, compacted to just what the coverage prompt needs to judge a match — mirrors
 *  compliancemanager's review/coverage.py `_compact_registry`. */
async function loadRegistrySnapshot(req) {
  const { zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT RISK_ID, REGISTER, FEATURE, THREAT, VULNERABILITY, TITLE FROM ${TABLE}`
    ));
  } catch (e) {
    throw friendlyTableError(e);
  }
  return rows.map(r => ({
    risk_id: r.RISK_ID, register: r.REGISTER, feature: r.FEATURE,
    threat: r.THREAT, vulnerability: r.VULNERABILITY, statement: r.TITLE,
  }));
}

/** Mirrors compliancemanager's prompts/compare_dpia_registry.md, inlined the way ask-service.js
 *  inlines its own grounding prompt rather than reading a separate markdown file at runtime. */
function buildComparePrompt(dpia, registry) {
  const input = { dpia: { dpia_id: dpia.dpia_id, title: dpia.title, risks: dpia.risks }, registry };
  return [
    "Decide, for EACH risk row in one DPIA document's RISK AND CONTROL table, whether the risk " +
      'registers already cover it (guideline G14).',
    '',
    'How to judge coverage:',
    '- A register entry covers a DPIA risk when they describe the same threat scenario and ' +
      'consequence, even with different wording (e.g. "SSRF via user-supplied URL" matches a ' +
      'register entry about unintended internal requests from user-supplied details).',
    '- Match on meaning, not string overlap. The DPIA risk\'s feature context vs. a register ' +
      "entry's `feature` is a strong signal, but a general register entry can also cover a " +
      'feature-specific DPIA risk.',
    '- If several register entries each cover part of the DPIA risk, list them all and use ' +
      'confidence "medium".',
    '- verdict is "missing" ONLY when no register entry plausibly covers the DPIA risk. Purely ' +
      'informational rows (e.g. "No new threats") are "n/a".',
    '',
    'Input (JSON):',
    JSON.stringify(input),
    '',
    'Respond with JSON only — no prose, no markdown code fence — in this exact shape:',
    '{"dpia_id": "...", "results": [{"sno": "1", "dpia_risk_summary": "8-15 word summary of the ' +
      'DPIA risk row", "verdict": "covered" | "missing" | "n/a", "matched_risk_ids": ["..."], ' +
      '"confidence": "high" | "medium" | "low", "rationale": "one sentence: why it is covered by ' +
      'those IDs / why nothing covers it"}]}',
    'Every input row must appear in `results` exactly once, in order.',
  ].join('\n');
}

/** Strip an optional ```json fence and parse. */
function parseComparisonJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

async function compareOneDpia(req, dpia, registry) {
  const { text } = await chatCompletion(req, { prompt: buildComparePrompt(dpia, registry), timeoutMs: 90_000 });
  let parsed;
  try {
    parsed = parseComparisonJson(text);
  } catch (e) {
    throw new Error(`AI returned unparseable output: ${e.message}`);
  }
  return { dpia_id: dpia.dpia_id, dpia_title: dpia.title, results: Array.isArray(parsed.results) ? parsed.results : [] };
}

/**
 * POST /api/risks/compare-dpias — mirrors `risk compare_risks` (risk_manager/compare_risks.py):
 * pulls the DPIA documents (Creator, same team filter as the registers), fetches each one's Writer
 * export, extracts its RISK AND CONTROL table, and asks the LLM which rows aren't covered by any
 * compliance_risks entry (guideline G14). Uses the connections this app already has configured —
 * zoho-creator, zoho-writer, zoho-platformai — no new connection or table required.
 */
async function compareDpias(req) {
  const teamNames = await getTeamNames(req);
  if (!teamNames.length) {
    const err = new Error('No teams are configured — add at least one on the "Teams synced" panel.');
    err.status = 400;
    throw err;
  }

  const docs = await fetchDmsDocuments(req, teamNames);
  const dpiaDocs = docs.filter(d => d.template.toLowerCase().includes(DPIA_TEMPLATE_CONTAINS));
  if (!dpiaDocs.length) {
    const err = new Error(
      `No DPIA documents found for the configured team(s) — looked in "${DMS_REPORT}" for records ` +
      "whose template contains \"Data Protection Impact Assessment\"."
    );
    err.status = 424;
    throw err;
  }

  const dpias = [];
  for (const d of dpiaDocs) {
    const entry = { dpia_id: d.document_id, title: d.name, risks: [], fetch_error: null };
    if (!d.writer_doc_id) {
      entry.fetch_error = 'No Writer document link on this record.';
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop
        entry.risks = extractRiskRows(await fetchWriterHtml(req, d.writer_doc_id));
      } catch (e) {
        entry.fetch_error = String(e.message || e).slice(0, 200);
      }
    }
    dpias.push(entry);
  }

  const withRisks = dpias.filter(d => d.risks.length);
  const fetchErrors = dpias.filter(d => d.fetch_error).map(d => ({ dpia_id: d.dpia_id, error: d.fetch_error }));

  if (!withRisks.length) {
    return {
      success: true,
      dpias_found: dpiaDocs.length,
      dpias_compared: 0,
      rows_total: 0,
      rows_missing: 0,
      rows_covered: 0,
      fetch_errors: fetchErrors,
      comparisons: [],
      message: 'Found DPIA document(s) but none had a parseable RISK AND CONTROL table (or all ' +
        'say "No new threats").',
    };
  }

  const registry = await loadRegistrySnapshot(req);
  if (!registry.length) {
    const err = new Error(
      'The risk registers are empty — run "Sync from Creator" on the Risk Register tab first.'
    );
    err.status = 400;
    throw err;
  }

  const comparisons = [];
  for (const d of withRisks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      comparisons.push(await compareOneDpia(req, d, registry));
    } catch (e) {
      if (e instanceof AiUnavailable) {
        const err = new Error(
          `AI is not available: ${e.message}. Configure the Zoho PlatformAI connection on the ` +
          'Connections tab first.'
        );
        err.status = 424;
        throw err;
      }
      comparisons.push({ dpia_id: d.dpia_id, dpia_title: d.title, error: String(e.message || e).slice(0, 300), results: [] });
    }
  }

  const rows = comparisons.flatMap(c => c.results || []);
  return {
    success: true,
    dpias_found: dpiaDocs.length,
    dpias_compared: comparisons.length,
    rows_total: rows.length,
    rows_missing: rows.filter(r => r.verdict === 'missing').length,
    rows_covered: rows.filter(r => r.verdict === 'covered').length,
    fetch_errors: fetchErrors,
    errors: comparisons.filter(c => c.error).map(c => c.dpia_id),
    comparisons,
  };
}

/** DataStore row -> the canonical shape risk-review.js's checkRegistryRisk() expects. */
function toCanonical(row) {
  return {
    risk_id: row.RISK_ID,
    register: row.REGISTER,
    threat: row.THREAT,
    statement: row.TITLE,
    likelihood: row.LIKELIHOOD,
    impact: row.IMPACT,
    asset_value: row.ASSET_VALUE,
    inherent_score: row.INHERENT_SCORE === '' || row.INHERENT_SCORE == null ? null : Number(row.INHERENT_SCORE),
    inherent_rating: row.INHERENT_RATING,
    residual_score: row.REVISED_SCORE === '' || row.REVISED_SCORE == null ? null : Number(row.REVISED_SCORE),
    residual_rating: row.REVISED_RATING,
    treatment: row.RISK_TREATMENT,
    control_description: row.CONTROL,
    raci_id: row.RACI_ID,
  };
}

/**
 * POST /api/risks/review — runs risk-review.js's scripted guideline checks (G6-G10, G19; see
 * risk-guidelines.md) against every risk currently in compliance_risks and writes the result to
 * REVIEW_STATUS/GUIDELINE_CHECKS. Unlike draftRisk/compareDpias this is fully implemented — it
 * needs no LLM — but it only covers the rules that CAN be scripted; see `pending_llm_rules` in the
 * response for the rest (G1-G5/G11-G13/G15-G18), which still need the same server-callable LLM
 * path those two stubs are waiting on.
 */
const REVIEW_SELECT_COLUMNS =
  'ROWID, RISK_ID, REGISTER, TITLE, THREAT, RISK_TREATMENT, CONTROL, ' +
  'INHERENT_SCORE, INHERENT_RATING, REVISED_SCORE, REVISED_RATING, ' +
  'LIKELIHOOD, IMPACT, ASSET_VALUE, RACI_ID, REVIEW_STATUS';

/** Run the scripted checks on one already-fetched row and write the result. Shared by the bulk
 *  and single-risk review endpoints so they can never drift out of sync with each other. */
async function reviewRow(table, row) {
  const risk = toCanonical(row);
  const findings = checkRegistryRisk(risk);
  const checks = summarizeChecks(risk, findings);
  const status = findings.length ? 'review' : 'ok';
  // GUIDELINE_CHECKS carries both the pass/fail summary (checks) and the actual finding detail
  // (problem/suggestion text) behind each failed rule, so the UI can show *why* G6 failed instead
  // of just the pill. Stored as one object so no new DataStore column is needed; toPublic() below
  // stays backward-compatible with rows written before this shape existed (plain [[code,result]]).
  await table.updateRow({
    ROWID: String(row.ROWID),
    REVIEW_STATUS: status,
    GUIDELINE_CHECKS: JSON.stringify({ results: checks, findings }),
  });
  return { status, checks, findings };
}

async function reviewGuidelines(req) {
  const { table, zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(`SELECT ${REVIEW_SELECT_COLUMNS} FROM ${TABLE}`));
  } catch (e) {
    throw friendlyTableError(e);
  }

  let ok = 0;
  let needsReview = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const { status } = await reviewRow(table, row);
    if (status === 'ok') ok += 1; else needsReview += 1;
  }

  return {
    success: true,
    reviewed: rows.length,
    ok,
    needs_review: needsReview,
    rules_implemented: IMPLEMENTED_RULES,
    pending_llm_rules: PENDING_LLM_RULES,
  };
}

/**
 * POST /api/risks/:riskId/review — the same scripted checks as reviewGuidelines, for exactly one
 * risk (the Risk Register table's per-row "rerun" icon in the Status column). Kept as its own
 * endpoint rather than a client-side filter of the bulk one so a single rerun stays a single ZCQL
 * lookup + one updateRow, not a full-table pass.
 */
async function reviewOneRisk(req, riskId) {
  const { table, zcql } = ds(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${REVIEW_SELECT_COLUMNS} FROM ${TABLE} WHERE RISK_ID = '${esc(riskId)}'`
    ));
  } catch (e) {
    throw friendlyTableError(e);
  }
  if (!rows.length) {
    const err = new Error('No such risk');
    err.status = 404;
    throw err;
  }
  const { status, checks, findings } = await reviewRow(table, rows[0]);
  return {
    success: true,
    risk_id: riskId,
    status,
    checks,
    findings,
    rules_implemented: IMPLEMENTED_RULES,
    pending_llm_rules: PENDING_LLM_RULES,
  };
}

/**
 * GET /api/risks/guidelines — the full RISK_GUIDELINES.md text (risk-guidelines.md, this folder)
 * for the Risk Register's "View guidelines" panel, so reviewers can read the rules this app
 * enforces (and the ones it doesn't yet — see IMPLEMENTED_RULES/PENDING_LLM_RULES) without leaving
 * the app. Read from disk on every call rather than cached in memory — it's a small file and this
 * keeps a redeploy of risk-guidelines.md picked up immediately.
 */
async function getGuidelines() {
  let text;
  try {
    text = fs.readFileSync(path.join(__dirname, 'risk-guidelines.md'), 'utf8');
  } catch (e) {
    const err = new Error('Guideline text is unavailable right now.');
    err.status = 500;
    throw err;
  }
  return {
    success: true,
    guidelines: text,
    rules_implemented: IMPLEMENTED_RULES,
    pending_llm_rules: PENDING_LLM_RULES,
  };
}

module.exports = {
  listRisks, getRisk, previewRisk, draftRisk, compareDpias, syncFromCreator, TABLE,
  listTeamFilters, addTeamFilter, removeTeamFilter, reviewGuidelines, reviewOneRisk,
  getGuidelines,
};
