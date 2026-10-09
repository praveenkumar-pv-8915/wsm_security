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
 * and draftRisk (2026-09-01) is wired up to it: it drafts one candidate entry grounded in the
 * current compliance_risks snapshot and risk-guidelines.md's G1-G13, and self-checks the result
 * with risk-review.js's scripted rules. It never writes anything — a human still enters it into
 * Creator by hand.
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
// Which Creator teams' risks (and, via listDocuments below, DMS documents) to pull into this app
// — configurable from the UI (Risk Register's "Teams synced" panel), backed by the shared
// tool_config table (not a bespoke one — any future feature needing a small UI-editable setting
// reuses the same table via toolConfig.get/setConfig). TOOL_KEY is 'Compliance_manager', not
// 'risk_register', because both Risk Register and DMS Manager (listDocuments) read/write the same
// team_names list — there is only one team filter for the whole compliance app, not one per
// feature (2026-09-01 decision).
const CONFIG_TOOL_KEY = 'Compliance_manager';
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
// Same concept after treatment (normalize.py's _REVISED_IMPACT_FIELD) — read live by previewRisk.
const REVISED_IMPACT_FIELD = {
  isms: 'Total_Revised_Impact_Score_Max_of_C_I_A',
  pims: 'Privacy_Revised_Impact_Score',
  qms: 'QMS_Revised_Impact_Score',
  bcms: 'BCMS_Revised_Impact_Score',
};
// The standard each register is kept against — the detail pane's "Standards & regulation".
const REGISTER_STANDARD = {
  isms: 'ISO 27001 - ISMS',
  pims: 'ISO 27701 - PIMS',
  qms: 'ISO 9001 - QMS',
  bcms: 'ISO 22301 - BCMS',
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
 * and render directly as table columns — no live call needed for those anymore. This endpoint
 * carries what the detail pane shows beyond those columns (see liveDetailFromRecord below) plus
 * the reviewer/approver/owner emails, which ARE real PII and deliberately never touch DataStore —
 * see datastore-conventions.md's No-PII decision.
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
  const lastApproval = lastReviewEntry(record.Risk_Approved_Stats);

  return {
    success: true,
    preview: {
      risk_id: riskId,
      last_reviewed_on: lastReview.on,
      last_reviewed_by: lastReview.by,
      ...liveDetailFromRecord(record, register),
      approved_on: lastApproval.on,
      approved_by: lastApproval.by,
    },
  };
}

/**
 * The rest of the "WSM Security v5" detail pane, read live from the same Creator record previewRisk
 * already fetches (2026-10-09). None of this is persisted: the owner/reviewer/approver emails are
 * PII the No-PII decision keeps out of DataStore, and the remainder (scores, controls, context)
 * rides along on the one call that is being made anyway rather than widening compliance_risks.
 *
 * Field names are the Creator link-names seen in the four register reports (see compliancemanager's
 * risk_manager/normalize.py). Per-register differences: only ISMS carries the C/I/A split; only
 * QMS/PIMS/BCMS carry the asset and interested-party lookups; only BCMS carries Need/Expectation.
 */
function liveDetailFromRecord(record, register) {
  const str = v => String(v ?? '').trim();
  const int = v => {
    const n = parseInt(str(v), 10);
    return Number.isNaN(n) ? null : n;
  };
  const list = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : (str(v) ? [str(v)] : []));
  // Lookup fields come back as [{ ID, zc_display_value, <field>… }] — the display value is the
  // human label Creator itself shows ("IA_CI1 - Customer Information").
  const lookups = (v, ...keys) => (Array.isArray(v) ? v : []).map(item => {
    if (!item || typeof item !== 'object') return str(item);
    if (item.zc_display_value) return str(item.zc_display_value);
    return keys.map(k => str(item[k])).filter(Boolean).join(' - ');
  }).filter(Boolean);
  // "A.8.8 Management of technical vulnerabilities" -> { id: 'A.8.8', title: 'Management of…' }
  const splitControl = text => {
    const m = /^(\S+)\s+(.*)$/.exec(text);
    return m ? { id: m[1], title: m[2] } : { id: text, title: '' };
  };

  const cia = ['Confidentiality', 'Integrity', 'Availability'];
  const ciaScores = cia.map(n => int(record[`Score_for_impact_on_${n}`]));
  const revisedCiaScores = cia.map(n => int(record[`Revised_Impact_Score_on_${n}`]));
  const ownerList = Array.isArray(record.Risk_Owners)
    ? record.Risk_Owners.map(o => str(o && (o.Employee_Email || o.zc_display_value))).filter(Boolean)
    : [];
  const owner = str(record.Risk_Owner) || ownerList.join(', ');

  return {
    source: str(record.Source_of_Identification_of_Risk),
    issue_type: str(record.External_Internal_Issue),
    standards: REGISTER_STANDARD[register] || '',
    owner,
    likelihood: int(record.Likelihood),
    revised_likelihood: int(record.Likelihood1),
    impact: int(record[IMPACT_FIELD[register] || '']),
    revised_impact: int(record[REVISED_IMPACT_FIELD[register] || '']),
    cia: ciaScores.every(v => v === null) ? null : ciaScores,
    revised_cia: revisedCiaScores.every(v => v === null) ? null : revisedCiaScores,
    iso_controls: list(record.ISO_Control).map(splitControl),
    ccm_controls: (Array.isArray(record.CCM_Controls) ? record.CCM_Controls : [])
      .map(c => ({ id: str(c && c.CCM_Control_ID), title: str(c && c.CCM_Control_Title) }))
      .filter(c => c.id),
    asset: lookups(record.Asset_Identification_Number, 'AssetID', 'Information_security_Asset'),
    parties: lookups(record.Associated_Interested_parties, 'ID1', 'Interested_Parties'),
    need: list(record.Need),
    expectation: list(record.Expectation),
    remarks: str(record.Remarks),
  };
}

/**
 * POST /api/risks/draft — mirrors `risk draft_risk` (compliancemanager shells out to `claude -p`;
 * here it goes through chatCompletion()/zoho-platformai, the same LLM path compareDpias() uses).
 * Drafts ONE candidate risk register entry, grounded in the current compliance_risks snapshot (so
 * the model sees existing risks and doesn't restate one) and in risk-guidelines.md's identification/
 * scoring/language rules (G1-G13). Read-only: nothing is written to Creator or compliance_risks —
 * the response is a suggestion for a human reviewer to enter into Creator themselves, same as the
 * frontend's "Nothing is written to Creator" copy already promises.
 */

/** ISMS rating bands from G9 (1-12 Low, 13-24 Medium, 25-36 High; 0 counts as Low). */
const scoreBand = (score) => (score <= 12 ? 'Low' : score <= 24 ? 'Medium' : 'High');

/** Mirrors compareOneDpia's/ask-service's inlined-prompt style — no separate .md file read at
 *  runtime. The user's own free-text statement is the actual source of the risk — this is a
 *  structuring/completion task, not a pick-anything-new task: the model must build a complete
 *  entry FROM that statement (never invent an unrelated risk), while consulting the existing
 *  register only for style/dedupe context. */
function buildDraftPrompt(userStatement, registry, teamNames) {
  const sample = registry.slice(0, 40).map(r =>
    `- ${r.risk_id} [${String(r.register || '').toUpperCase()}] ${r.statement || '(no statement)'}` +
    (r.feature ? ` (feature: ${r.feature})` : '')
  );
  const shape = {
    register: 'isms', team_name: teamNames[0] || '', feature: '...',
    threat: '...', vulnerability: '...', issue: '',
    title: '... (the risk statement itself, stating the consequence/harm)',
    likelihood: 2, impact: 2, asset_value: 3,
    treatment: 'Risk Modification', control: '...',
    rationale: 'one sentence on why this risk is worth registering now',
  };
  return [
    'The compliance team has described a risk in their own words below. Turn that description into',
    'ONE complete, guideline-compliant candidate risk register entry for a human reviewer to check',
    'before anything is entered into the real register. Every field must be grounded in what they',
    "described — do not invent a different or unrelated risk. Follow these rules from this app's",
    'risk guidelines (risk-guidelines.md):',
    '',
    '- G1: name a Threat and a Vulnerability (and an Issue where applicable), each derived from the',
    "team's description — a specific, brief phrase, not boilerplate and not a restatement of one of",
    '  the other fields.',
    '- G2: the risk statement (title) must state the consequence/harm — loss of confidentiality,',
    '  integrity or availability, or harm to the organization / data subjects — implied or stated by',
    '  the description.',
    '- G4: exactly one risk per entry — if the description bundles more than one distinct risk, pick',
    '  the primary one it is really about.',
    '- G5: no mitigation/control text inside the risk statement itself — that belongs only in the',
    '  control field.',
    '- G6: populate threat, the risk statement, likelihood, impact, a treatment option, and — when',
    '  treatment is "Risk Modification" — a non-empty control description.',
    '- G7 (ISMS only): Likelihood and Impact are each 0-3; Asset Value is 1-4 (infrastructure = 4,',
    '  everything else = 3). Rate these based on how severe/likely the description makes the risk',
    '  sound; if the description gives no signal, use reasonable middle-of-scale defaults.',
    '- G8: inherent score = Likelihood x Impact x Asset Value for ISMS, or Likelihood x Impact for',
    '  the other registers — you do not need to compute this yourself, just supply the ratings.',
    '- G10: treatment is exactly one of "Risk Modification", "Risk Sharing", "Risk Avoidance",',
    '  "Risk Retention".',
    '- G11-G13: correct grammar and spelling, plain and precise wording (no vague quantifiers or',
    '  unexplained abbreviations), written in third person, present/future tense — even if the',
    "  team's own description was informal.",
    '',
    'Infer whichever register (isms/pims/qms/bcms), team and feature the description best fits.',
    '',
    `Configured team(s): ${teamNames.join(', ') || '(none configured)'}`,
    '',
    "The team's risk description:",
    `"""${userStatement}"""`,
    '',
    'Risks already on file (context only — for style and to avoid an exact duplicate; the',
    "description above is still the source of truth for what this entry is about):",
    sample.length ? sample.join('\n') : '(the register is currently empty)',
    '',
    'Respond with JSON only — no prose, no markdown code fence — in exactly this shape:',
    JSON.stringify(shape),
  ].join('\n');
}

/** Strip an optional ```json fence and parse — same convention as compareDpias' parseComparisonJson. */
function parseDraftJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

const VALID_REGISTERS = new Set(['isms', 'pims', 'qms', 'bcms']);

async function draftRisk(req, body = {}) {
  const statement = String(body.statement || '').trim();
  if (!statement) {
    const err = new Error('statement is required — describe the risk in your own words first.');
    err.status = 400;
    throw err;
  }
  if (statement.length > 4000) {
    const err = new Error('statement must be 4000 characters or fewer.');
    err.status = 400;
    throw err;
  }

  const teamNames = await getTeamNames(req);
  const registry = await loadRegistrySnapshot(req);

  let text;
  try {
    ({ text } = await chatCompletion(req, {
      prompt: buildDraftPrompt(statement, registry, teamNames),
      timeoutMs: 60_000,
    }));
  } catch (e) {
    if (e instanceof AiUnavailable) {
      const err = new Error(
        `AI is not available: ${e.message}. Configure the Zoho PlatformAI connection on the ` +
        'Connections tab first.'
      );
      err.status = 424;
      throw err;
    }
    throw e;
  }

  let parsed;
  try {
    parsed = parseDraftJson(text);
  } catch (e) {
    const err = new Error(`AI returned unparseable output: ${e.message}`);
    err.status = 502;
    throw err;
  }

  const register = VALID_REGISTERS.has(String(parsed.register || '').toLowerCase())
    ? String(parsed.register).toLowerCase() : 'isms';
  const isIsms = register === 'isms';
  const toNumOrNull = (v) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : null);
  const likelihood = toNumOrNull(parsed.likelihood);
  const impact = toNumOrNull(parsed.impact);
  const assetValue = toNumOrNull(parsed.asset_value);

  // Recompute the inherent score/rating ourselves (G8/G9) rather than trust the model's arithmetic.
  const inherentScore = likelihood !== null && impact !== null
    ? (isIsms ? likelihood * impact * (assetValue !== null ? assetValue : 1) : likelihood * impact)
    : null;
  const inherentRating = inherentScore !== null ? scoreBand(inherentScore) : '';

  const draft = {
    register,
    team_name: String(parsed.team_name || teamNames[0] || '').slice(0, 100),
    feature: String(parsed.feature || '').slice(0, 150),
    title: String(parsed.title || '').slice(0, 250),
    threat: String(parsed.threat || '').slice(0, 2000),
    vulnerability: String(parsed.vulnerability || '').slice(0, 2000),
    issue: String(parsed.issue || '').slice(0, 2000),
    likelihood, impact, asset_value: assetValue,
    inherent_score: inherentScore,
    inherent_rating: inherentRating,
    treatment: String(parsed.treatment || '').trim(),
    control: String(parsed.control || '').slice(0, 2000),
    rationale: String(parsed.rationale || '').slice(0, 500),
  };

  // Self-check the draft against the same scripted guideline rules reviewGuidelines() applies to
  // real rows (risk-review.js), so a reviewer sees upfront whether this candidate would pass.
  const canonical = {
    risk_id: '(draft — not yet registered)', register: draft.register, threat: draft.threat,
    statement: draft.title, likelihood: draft.likelihood, impact: draft.impact,
    asset_value: draft.asset_value, inherent_score: draft.inherent_score,
    inherent_rating: draft.inherent_rating, residual_score: null, residual_rating: '',
    treatment: draft.treatment, control_description: draft.control, raci_id: '',
  };
  const findings = checkRegistryRisk(canonical);
  const checks = summarizeChecks(canonical, findings);

  return {
    success: true,
    draft,
    checks,
    findings,
    note: 'Candidate draft only — nothing has been written to Creator or compliance_risks. Review ' +
      'it, then enter it into Creator by hand if it should be added to the register.',
  };
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

/** One raw Creator document record -> table-ready fields — mirrors compliancemanager's
 *  dms_manager._normalize_doc (document_id/name/template/team/added/writer_doc_id), so
 *  listDocuments below (DMS Manager) reads the same shape the CLI's `dms list_docs` prints.
 *
 *  Deliberately NO submitted_by: Creator's `Submitted_By` is a person's email — third-party PII
 *  this app never caches (see datastore-conventions.md's "No-PII identity decision", extended
 *  2026-08-31 to block caching third-party PII, not just this app's own users). Unlike
 *  compliance_risks's "last reviewed by" (live-fetch-only on a single row expand), there is no
 *  per-row detail call here to fetch it live either — the whole point of this table is a bulk
 *  persisted snapshot, so Submitted_By is dropped at the source instead of cached or re-fetched. */
/** Which Zoho app a Creator Document_Link opens in, from its host (writer.zoho.in, sheet.zoho.in…). */
function zohoAppFromUrl(url) {
  const m = /^https?:\/\/([a-z0-9-]+)\./i.exec(String(url || ''));
  const host = m ? m[1].toLowerCase() : '';
  return { writer: 'Writer', sheet: 'Sheet', show: 'Show', workdrive: 'WorkDrive', docs: 'Docs' }[host] || 'Zoho';
}

function mapDocRecord(record) {
  const link = record.Document_Link;
  const url = String((link && typeof link === 'object' ? link.url : link) || '').trim();
  return {
    document_id: String(record.Document_ID || '').trim(),
    name: String(record.Document_Name || '').trim(),
    template: String(record.Choose_Template || '').trim(),
    team: String(record.Team_Name || '').trim(),
    writer_doc_id: url ? url.replace(/\/+$/, '').split('/').pop() : '',
    // Live-only fields (2026-10-09, "WSM Security v5" DMS Manager): the open-in link, the app it
    // opens in and the day the record was added. Served straight from Creator by listDocuments —
    // never persisted to dms_documents, which keeps that table's schema untouched.
    url,
    app: url ? zohoAppFromUrl(url) : '',
    added_on: parseModifiedDate(record.Record_Added_Date),
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
 * "Compare vs. DPIA" runs as an async job rather than one long HTTP request: with several DPIA
 * documents each needing a Writer fetch + an LLM comparison call, this can run well past what's
 * comfortable to hold a single request open for. POST /api/risks/compare-dpias creates a job row
 * in `dpia_comparison_jobs` (manual DataStore table, same as compliance_risks — see the schema
 * note above submitCompareDpiasJob below) and kicks off the actual work as a DETACHED promise —
 * the HTTP response returns immediately with a job_id. GET /api/risks/compare-dpias/:jobId is how
 * the UI polls status ('running' with total/completed/current) and picks up the result once
 * STATUS flips to 'done' (or the error once it flips to 'failed').
 *
 * The detached job keeps running in this same function's container after the response is sent —
 * req.catalystAdmin is a token-bearing SDK client, not tied to the HTTP socket, so it stays usable
 * for the DataStore/Creator/Writer/PlatformAI calls the job makes afterward. This relies on
 * Catalyst's Advanced I/O execution model (a persistent Express process, not a per-request
 * freeze) — it hasn't been load-tested against Catalyst scaling an idle container down mid-job. If
 * a job is ever seen stuck in 'running' with COMPLETED not advancing, that assumption is the first
 * thing to check.
 *
 * Table (create manually, same as compliance_risks — see datastore-conventions.md's template):
 *   dpia_comparison_jobs
 *     STATUS         Var Char 20   Mandatory   'running' | 'done' | 'failed'
 *     OWNER_ID       Var Char 50               user_id who started the run — informational only
 *     TOTAL          Int                       units of work queued for this run
 *     COMPLETED      Int           default 0   units of work finished so far
 *     CURRENT_LABEL  Var Char 255              e.g. "Comparing DID_M_LC_70 — <doc name>"
 *     RESULT         Text                      JSON result, set once STATUS='done'
 *     ERROR          Text                      message, set once STATUS='failed'
 *     CREATED_AT     Var Char 20               String(Date.now()), this app's epoch-ms convention
 *     FINISHED_AT    Var Char 20               set once the job leaves 'running'
 *   The job id the API hands out is just this table's own ROWID.
 */
const JOBS_TABLE = 'dpia_comparison_jobs';

function jobs(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) throw new Error('Catalyst authentication required');
  return { table: app.datastore().table(JOBS_TABLE), zcql: app.zcql() };
}

function friendlyJobsTableError(e) {
  const msg = String(e && e.message || '');
  if (/table/i.test(msg) && /(not exist|invalid|not found)/i.test(msg)) {
    return new MissingTable(
      `The "${JOBS_TABLE}" DataStore table doesn't exist yet — create it first (see the schema in ` +
      'functions/welcome/risk-service.js, just above submitCompareDpiasJob).'
    );
  }
  return e;
}

/** POST /api/risks/compare-dpias — validates up front (team filter, DPIA docs found, registers
 *  non-empty — all fast Creator/DataStore reads), then creates the job row and detaches the real
 *  work. Returns fast; the caller polls getCompareDpiasJob for progress. */
async function submitCompareDpiasJob(req) {
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

  const registry = await loadRegistrySnapshot(req);
  if (!registry.length) {
    const err = new Error(
      'The risk registers are empty — run "Sync from Creator" on the Risk Register tab first.'
    );
    err.status = 400;
    throw err;
  }

  const { table } = jobs(req);
  let inserted;
  try {
    inserted = await table.insertRow({
      STATUS: 'running',
      OWNER_ID: String(req.userId || ''),
      TOTAL: dpiaDocs.length,
      COMPLETED: 0,
      CURRENT_LABEL: '',
      RESULT: '',
      ERROR: '',
      CREATED_AT: String(Date.now()),
      FINISHED_AT: '',
    });
  } catch (e) {
    throw friendlyJobsTableError(e);
  }
  const jobId = String(inserted.ROWID);

  // Detached — deliberately not awaited, see the comment above.
  runCompareDpiasJob(req, jobId, dpiaDocs, registry).catch(e => {
    console.error(`compare-dpias job ${jobId} crashed:`, e);
    table.updateRow({
      ROWID: jobId,
      STATUS: 'failed',
      ERROR: String((e && e.message) || e).slice(0, 2000),
      FINISHED_AT: String(Date.now()),
    }).catch(e2 => console.error(`compare-dpias job ${jobId}: failed to record crash:`, e2.message));
  });

  return { success: true, job_id: jobId, total: dpiaDocs.length };
}

/** The detached worker: fetch+parse every DPIA, then compare each one with risks against the
 *  registry, writing progress to the job row after each step and the final result at the end. */
async function runCompareDpiasJob(req, jobId, dpiaDocs, registry) {
  const { table } = jobs(req);
  const touch = fields => table.updateRow({ ROWID: jobId, ...fields })
    .catch(e => console.error(`compare-dpias job ${jobId}: progress update failed:`, e.message));

  const dpias = [];
  let completed = 0;
  for (const d of dpiaDocs) {
    // eslint-disable-next-line no-await-in-loop
    await touch({ CURRENT_LABEL: `Fetching ${d.document_id} — ${d.name}`.slice(0, 255) });
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
    completed += 1;
    // eslint-disable-next-line no-await-in-loop
    await touch({ COMPLETED: completed });
  }

  const withRisks = dpias.filter(d => d.risks.length);
  const fetchErrors = dpias.filter(d => d.fetch_error).map(d => ({ dpia_id: d.dpia_id, error: d.fetch_error }));

  if (!withRisks.length) {
    const result = {
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
    await table.updateRow({
      ROWID: jobId, STATUS: 'done', RESULT: JSON.stringify(result), FINISHED_AT: String(Date.now()),
      CURRENT_LABEL: '',
    });
    return;
  }

  // Comparison rows join the same progress bar as the fetch rows, so it counts up to a total
  // fixed at the start rather than jumping backwards once fetching finishes.
  await touch({ TOTAL: dpiaDocs.length + withRisks.length });

  const comparisons = [];
  for (const d of withRisks) {
    // eslint-disable-next-line no-await-in-loop
    await touch({ CURRENT_LABEL: `Comparing ${d.dpia_id} — ${d.title}`.slice(0, 255) });
    try {
      // eslint-disable-next-line no-await-in-loop
      comparisons.push(await compareOneDpia(req, d, registry));
    } catch (e) {
      if (e instanceof AiUnavailable) {
        await table.updateRow({
          ROWID: jobId,
          STATUS: 'failed',
          ERROR: `AI is not available: ${e.message}. Configure the Zoho PlatformAI connection on ` +
            'the Connections tab first.',
          FINISHED_AT: String(Date.now()),
        });
        return;
      }
      comparisons.push({ dpia_id: d.dpia_id, dpia_title: d.title, error: String(e.message || e).slice(0, 300), results: [] });
    }
    completed += 1;
    // eslint-disable-next-line no-await-in-loop
    await touch({ COMPLETED: completed });
  }

  const rows = comparisons.flatMap(c => c.results || []);
  const result = {
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
  await table.updateRow({
    ROWID: jobId, STATUS: 'done', RESULT: JSON.stringify(result), FINISHED_AT: String(Date.now()),
    CURRENT_LABEL: '',
  });
}

/** GET /api/risks/compare-dpias/:jobId — the UI's poll endpoint. */
async function getCompareDpiasJob(req, jobId) {
  if (!/^\d+$/.test(String(jobId))) {
    const err = new Error('Invalid job id');
    err.status = 400;
    throw err;
  }
  const { zcql } = jobs(req);
  let rows;
  try {
    rows = unwrap(await zcql.executeZCQLQuery(
      'SELECT ROWID, STATUS, TOTAL, COMPLETED, CURRENT_LABEL, RESULT, ERROR, CREATED_AT, FINISHED_AT ' +
      `FROM ${JOBS_TABLE} WHERE ROWID = ${jobId}`
    ));
  } catch (e) {
    throw friendlyJobsTableError(e);
  }
  if (!rows.length) {
    const err = new Error(`No such comparison job "${jobId}".`);
    err.status = 404;
    throw err;
  }
  const row = rows[0];
  const base = {
    success: true,
    job_id: String(row.ROWID),
    status: row.STATUS,
    total: Number(row.TOTAL || 0),
    completed: Number(row.COMPLETED || 0),
    current: row.CURRENT_LABEL || '',
  };
  if (row.STATUS === 'done') {
    let result = null;
    try { result = JSON.parse(row.RESULT || 'null'); } catch { /* leave null, RESULT was empty/corrupt */ }
    return { ...base, result };
  }
  if (row.STATUS === 'failed') {
    return { ...base, error: row.ERROR || 'Comparison failed.' };
  }
  return base;
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
  'LIKELIHOOD, IMPACT, ASSET_VALUE, RACI_ID, REVIEW_STATUS, GUIDELINE_CHECKS';

// ZCQL caps a single SELECT at 300 rows, so the bulk review paginates instead of assuming one
// query returns the whole register (211 risks today — one more sync away from silently reviewing
// only the first 300). `LIMIT offset, count` is the documented ZCQL form; if a backend ever
// rejects it we fall back to the plain unpaged query rather than failing the whole run.
const REVIEW_PAGE = 200;
// Catalyst's bulk row API takes up to 200 rows per call. Reviewing 200+ risks with one updateRow
// each is what made "Review guidelines" time out (Advanced I/O caps a request well below the time
// 200 sequential writes take) — batching is the fix, together with skipping unchanged rows.
const UPDATE_CHUNK = 100;

async function fetchAllReviewRows(zcql) {
  const all = [];
  for (let offset = 0; ; offset += REVIEW_PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const page = unwrap(await zcql.executeZCQLQuery(
      `SELECT ${REVIEW_SELECT_COLUMNS} FROM ${TABLE} ORDER BY ROWID LIMIT ${offset}, ${REVIEW_PAGE}`
    ));
    all.push(...page);
    if (page.length < REVIEW_PAGE) return all;
  }
}

/** Scripted checks for one already-fetched row, with no write — the shared core of the bulk and
 *  single-risk review paths. Returns the row patch too, so the caller decides how to write it. */
function computeReview(row) {
  const risk = toCanonical(row);
  const findings = checkRegistryRisk(risk);
  const checks = summarizeChecks(risk, findings);
  const status = findings.length ? 'review' : 'ok';
  // GUIDELINE_CHECKS carries both the pass/fail summary (checks) and the actual finding detail
  // (problem/suggestion text) behind each failed rule, so the UI can show *why* G6 failed instead
  // of just the pill. Stored as one object so no new DataStore column is needed; toPublic() stays
  // backward-compatible with rows written before this shape existed (plain [[code,result]]).
  const serialized = JSON.stringify({ results: checks, findings });
  const changed = row.REVIEW_STATUS !== status || (row.GUIDELINE_CHECKS || '') !== serialized;
  return {
    status,
    checks,
    findings,
    changed,
    patch: { ROWID: String(row.ROWID), REVIEW_STATUS: status, GUIDELINE_CHECKS: serialized },
  };
}

/** Run the scripted checks on one already-fetched row and write the result. Used by the
 *  single-risk endpoint; the bulk run batches its writes instead (see reviewGuidelines). */
async function reviewRow(table, row) {
  const { status, checks, findings, changed, patch } = computeReview(row);
  if (changed) await table.updateRow(patch);
  return { status, checks, findings };
}

async function reviewGuidelines(req) {
  const { table, zcql } = ds(req);
  let rows;
  try {
    rows = await fetchAllReviewRows(zcql);
  } catch (e) {
    try {
      rows = unwrap(await zcql.executeZCQLQuery(`SELECT ${REVIEW_SELECT_COLUMNS} FROM ${TABLE}`));
    } catch (e2) {
      throw friendlyTableError(e2);
    }
  }

  let ok = 0;
  let needsReview = 0;
  const patches = [];
  for (const row of rows) {
    const { status, changed, patch } = computeReview(row);
    if (status === 'ok') ok += 1; else needsReview += 1;
    if (changed) patches.push(patch);
  }

  for (let i = 0; i < patches.length; i += UPDATE_CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    await table.updateRows(patches.slice(i, i + UPDATE_CHUNK));
  }

  return {
    success: true,
    reviewed: rows.length,
    ok,
    needs_review: needsReview,
    updated: patches.length,
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

/* ------------------------------------------------------------------ DMS Manager (persisted) */

// dms_documents — persisted snapshot of the DMS "documents" report, same pull-and-replace pattern
// as compliance_risks above (see ds()/ensureSynced()/syncFromCreator() there). Table: manual
// console create, see datastore-conventions.md's dms_documents worked example — Var Char
// DOCUMENT_ID [Mandatory+Unique], NAME, TEMPLATE, TEAM_NAME, WRITER_DOC_ID. No SUBMITTED_BY column
// — Creator's Submitted_By is a person's email, third-party PII this app never persists (see
// mapDocRecord's comment and datastore-conventions.md's No-PII identity decision). No ADDED_DATE
// either (dropped 2026-09-01, per explicit request) — display-only metadata nothing reads, not
// worth a column.
const DMS_TABLE = 'dms_documents';

function dmsDs(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) throw new Error('Catalyst authentication required');
  return { table: app.datastore().table(DMS_TABLE), zcql: app.zcql() };
}

// The module-level `unwrap` above is bound to compliance_risks' own TABLE constant — reusing it
// here silently mis-shaped every dms_documents row (ZCQL nests each row under the table name, e.g.
// { dms_documents: {...} }, and unwrap's `r[TABLE] || r` fallback returned that whole wrapper
// instead of the inner row whenever TABLE !== 'dms_documents'). A dedicated unwrap avoids that.
const unwrapDms = rows => (rows || []).map(r => r[DMS_TABLE] || r);

/**
 * Any DataStore/ZCQL failure against dms_documents becomes an actionable, non-5xx error instead of
 * a masked "Internal error" (index.js's global handler masks any unhandled >=500 — see
 * datastore-conventions.md's "Debugging the fail-closed auth gates" section for why that matters).
 * The specific "table doesn't exist" case gets a message naming the exact columns to create;
 * anything else still gets the real underlying message surfaced at 424 rather than swallowed.
 */
function friendlyDmsTableError(e) {
  const msg = String(e && e.message || '');
  if (/table/i.test(msg) && /(not exist|invalid|not found)/i.test(msg)) {
    return new MissingTable(
      `The "${DMS_TABLE}" DataStore table doesn't exist yet — create it first (Var Char DOCUMENT_ID ` +
      '[Mandatory+Unique], Var Char NAME, Var Char TEMPLATE, Var Char TEAM_NAME, Var Char WRITER_DOC_ID ' +
      '— no SUBMITTED_BY [PII] or ADDED_DATE [unused]). See datastore-conventions.md.'
    );
  }
  if (e instanceof MissingTable || e instanceof MissingConnection || e.status) return e;
  return new MissingTable(`Unexpected "${DMS_TABLE}" DataStore error: ${msg || e}`);
}

const dmsToPublic = row => ({
  document_id: row.DOCUMENT_ID,
  name: row.NAME,
  template: row.TEMPLATE,
  team: row.TEAM_NAME,
  writer_doc_id: row.WRITER_DOC_ID,
});

/**
 * POST /api/dms/documents/sync — full replace of dms_documents from the live Zoho Creator
 * connection, same team filter as Risk Register. Mirrors syncFromCreator above.
 */
async function syncDmsDocuments(req) {
  const { table, zcql } = dmsDs(req);
  const teamNames = await getTeamNames(req);
  if (!teamNames.length) {
    const err = new Error('No teams are configured to sync — add at least one on the "Teams synced" panel.');
    err.status = 400;
    throw err;
  }
  const docs = await fetchDmsDocuments(req, teamNames);

  // DOCUMENT_ID is Mandatory + Unique — de-dupe defensively, same rationale as syncFromCreator's
  // RISK_ID de-dupe (Creator does not guarantee a uniquely-keyed report never repeats a row).
  const seen = new Set();
  const deduped = [];
  for (const doc of docs) {
    if (!doc.document_id || seen.has(doc.document_id)) continue;
    seen.add(doc.document_id);
    deduped.push(doc);
  }

  let existing;
  try {
    existing = unwrapDms(await zcql.executeZCQLQuery(`SELECT ROWID FROM ${DMS_TABLE}`));
  } catch (e) {
    throw friendlyDmsTableError(e);
  }
  for (const row of existing) {
    // eslint-disable-next-line no-await-in-loop
    await table.deleteRow(row.ROWID);
  }
  for (const doc of deduped) {
    // eslint-disable-next-line no-await-in-loop
    await table.insertRow({
      DOCUMENT_ID: doc.document_id,
      NAME: doc.name,
      TEMPLATE: doc.template,
      TEAM_NAME: doc.team,
      WRITER_DOC_ID: doc.writer_doc_id,
    });
  }
  return { success: true, count: deduped.length };
}

/** Auto-sync once, only the first time dms_documents is empty — mirrors ensureSynced above. A
 *  manual "Sync from Creator" action (POST /api/dms/documents/sync) is how a refresh happens
 *  after that. */
async function ensureDmsSynced(req) {
  const { zcql } = dmsDs(req);
  let existing;
  try {
    existing = unwrapDms(await zcql.executeZCQLQuery(`SELECT ROWID FROM ${DMS_TABLE} LIMIT 1`));
  } catch (e) {
    throw friendlyDmsTableError(e);
  }
  if (existing.length) return;
  await syncDmsDocuments(req);
}

/**
 * GET /api/dms/documents — DMS Manager: mirrors compliancemanager's `dms list_docs`.
 *
 * Live from Zoho Creator on every load (2026-10-09, "WSM Security v5" DMS Manager). The screen
 * needs each document's open-in link and added date, neither of which the persisted dms_documents
 * snapshot carries, and the decision was to read them from Creator rather than widen that table.
 * Same team_names config as Risk Register (CONFIG_TOOL_KEY = 'Compliance_manager' above) — one
 * team filter for the whole app.
 *
 * dms_documents itself is still kept (auto-synced once when empty, POST /api/dms/documents/sync
 * after that) because getDocumentWorkflow below resolves WRITER_DOC_ID from it.
 */
async function listDocuments(req) {
  const teamNames = await getTeamNames(req);
  if (!teamNames.length) {
    const err = new Error('No teams are configured — add at least one under Settings › Compliance.');
    err.status = 400;
    throw err;
  }
  // Best effort: the snapshot only backs the per-document workflow lookup, so a DataStore problem
  // there must not take the live list down with it.
  try { await ensureDmsSynced(req); } catch (e) { /* surfaced by the workflow endpoint instead */ }
  const docs = await fetchDmsDocuments(req, teamNames);
  const seen = new Set();
  const documents = [];
  for (const doc of docs) {
    if (!doc.document_id || seen.has(doc.document_id)) continue;
    seen.add(doc.document_id);
    documents.push(doc);
  }
  return { success: true, documents };
}

/* ------------------------------------------------------------------ DMS Manager: workflow status */

// Live status check against Zoho WorkDrive's Workflow API — per document, on demand (row-expand),
// never persisted and never baked into the bulk dms_documents sync. Two reasons: (1) this app's
// zoho-workdrive connection already has the WorkDrive.workflows.READ / WorkDrive.workflowinstances.READ
// scopes granted (no new consent needed), verified against compliancemanager's own equivalent
// check (see the DMS workflow status note this was ported from); (2) a document's Writer doc id
// (WRITER_DOC_ID, already on the dms_documents row) doubles as its WorkDrive resource id, so no
// extra lookup step exists either — GET /workdrive/api/v1/files/<writer_doc_id>/workflowinstances
// is the whole call.
//
// Requirements covered here (2026-09-01 DMS Manager workflow requirements):
//   1. Fetch last-reviewed / last-approved dates — done, from completed workflow instances.
//   2. Flag a review workflow that has been open too long — done (WORKFLOW_OPEN_TOO_LONG_DAYS).
//   3. Flag a last-approved date more than 3 months old — done (APPROVAL_STALE_DAYS = 90).
//   4. Flag the doc's revision history vs. the workflow's last-approved date not syncing — NOT
//      implemented. This needs a verified Zoho Writer revision-history endpoint (this app's
//      zoho-writer connection only has ZohoWriter.documentEditor.ALL, and no revision-history call
//      has been confirmed against it yet) — flag_history_mismatch is always `null` (unknown),
//      never a silent "false"/"no mismatch", until that's built. Follow-up work, not guessed at.

const WORKFLOW_INSTANCE_STATUS = { IN_PROGRESS: 1, COMPLETED: 2, CANCELLED: 4 };

// "Open for long time" (requirement 2) has no fixed business rule from Creator/WorkDrive to read
// off, so this is a reasonable default, not a spec — adjust here if the team wants a different
// cutoff. "More than 3 months" (requirement 3) IS an explicit rule, so that one is exact.
const WORKFLOW_OPEN_TOO_LONG_DAYS = 14;
const APPROVAL_STALE_DAYS = 90;
const DAY_MS = 86_400_000;

/** Live-fetch one document's workflow instances from WorkDrive. Returns [] — not an error — when
 *  there's no writer_doc_id, the zoho-workdrive connection isn't configured, or WorkDrive simply
 *  has no workflow history for this file; most DMS documents never had a workflow attached, and
 *  that's a normal state to show plainly, not a fault to surface as an error banner. */
async function fetchWorkflowInstances(req, writerDocId) {
  if (!writerDocId) return [];
  let resp;
  try {
    resp = await callConnection(
      req, 'zoho-workdrive', `/workdrive/api/v1/files/${encodeURIComponent(writerDocId)}/workflowinstances`
    );
  } catch {
    return [];
  }
  if (!resp.ok) return [];
  const json = await resp.json().catch(() => null);
  return Array.isArray(json && json.data) ? json.data : [];
}

/**
 * Reduce one document's raw WorkDrive workflow instances into what DMS Manager needs. Field names
 * (attributes.instance_status / current_state_info / created_time / modified_time) follow the
 * standard WorkDrive Workflow API v1 shape — if a real response differs, this is the one place to
 * adjust, once inspected against a live connection.
 */
function summarizeWorkflow(instances) {
  const attrs = (i) => i.attributes || i;
  const timeOf = (i) => Number(attrs(i).modified_time || attrs(i).created_time || 0) || null;
  const stateName = (i) => String(attrs(i).current_state_info?.name || attrs(i).workflow_name || '');
  const byNewest = (a, b) => (timeOf(b) || 0) - (timeOf(a) || 0);

  const inProgress = instances.filter((i) => Number(attrs(i).instance_status) === WORKFLOW_INSTANCE_STATUS.IN_PROGRESS);
  const completed = instances.filter((i) => Number(attrs(i).instance_status) === WORKFLOW_INSTANCE_STATUS.COMPLETED);

  const current = [...inProgress].sort(byNewest)[0];
  const currentState = current ? stateName(current).trim() : '';
  const pendingSince = current ? timeOf(current) : null;
  const pendingDays = pendingSince ? (Date.now() - pendingSince) / DAY_MS : null;

  // One workflow instance per run, not separate review/approval resources — distinguish which by
  // matching the state/workflow name, same as compliancemanager's own DMS workflow check does.
  const reviewed = completed.filter((i) => /review/i.test(stateName(i))).sort(byNewest)[0];
  const approved = completed.filter((i) => /approv/i.test(stateName(i))).sort(byNewest)[0];

  const lastReviewedAt = reviewed ? timeOf(reviewed) : null;
  const lastApprovedAt = approved ? timeOf(approved) : null;
  const approvalAgeDays = lastApprovedAt ? (Date.now() - lastApprovedAt) / DAY_MS : null;

  return {
    current_state: currentState || null,
    pending_since: pendingSince,
    pending_days: pendingDays,
    last_reviewed_at: lastReviewedAt,
    last_approved_at: lastApprovedAt,
    flag_open_too_long: pendingDays !== null && pendingDays > WORKFLOW_OPEN_TOO_LONG_DAYS,
    flag_never_approved: lastApprovedAt === null,
    flag_stale_approval: approvalAgeDays !== null && approvalAgeDays > APPROVAL_STALE_DAYS,
    // requirement 4 — see the file-header note above; always unknown, not a guessed false.
    flag_history_mismatch: null,
  };
}

/**
 * GET /api/dms/documents/:documentId/workflow — one document's live WorkDrive workflow status
 * (requirements 1-3). Reads the document's WRITER_DOC_ID from the persisted dms_documents row
 * (no live Creator call needed for that part), then calls WorkDrive live — nothing here is cached.
 */
async function getDocumentWorkflow(req, documentId) {
  const { zcql } = dmsDs(req);
  let rows;
  try {
    rows = unwrapDms(await zcql.executeZCQLQuery(
      `SELECT NAME, WRITER_DOC_ID FROM ${DMS_TABLE} WHERE DOCUMENT_ID = '${esc(documentId)}'`
    ));
  } catch (e) {
    throw friendlyDmsTableError(e);
  }
  if (!rows.length) {
    const err = new Error(`Document '${documentId}' not found — refresh or sync the document list first.`);
    err.status = 404;
    throw err;
  }
  const { NAME: name, WRITER_DOC_ID: writerDocId } = rows[0];
  if (!writerDocId) {
    return {
      success: true, document_id: documentId, name, workflow: null,
      note: 'No Writer document link on this record — nothing to check in WorkDrive.',
    };
  }
  const instances = await fetchWorkflowInstances(req, writerDocId);
  if (!instances.length) {
    return {
      success: true, document_id: documentId, name, workflow: null,
      note: 'No workflow history found in WorkDrive for this document.',
    };
  }
  return { success: true, document_id: documentId, name, workflow: summarizeWorkflow(instances) };
}

module.exports = {
  listRisks, getRisk, previewRisk, draftRisk, submitCompareDpiasJob, getCompareDpiasJob, syncFromCreator, TABLE,
  listTeamFilters, addTeamFilter, removeTeamFilter, reviewGuidelines, reviewOneRisk,
  getGuidelines, listDocuments, syncDmsDocuments, DMS_TABLE, getDocumentWorkflow,
};
