/**
 * Hacksaw module — read-only access to ZohoCorp's build-security scanner.
 *
 * Phase 1 (2026-10-20): Code Violation Review. See claude/hacksaw-module-design.md in the project
 * for the whole design — the three screens, the review-state table and the phase order.
 *
 * Every call goes out through `conn.callConnection(req, 'zoho-hacksaw', …)`, so there is one
 * credential, one audit point and one place the DC profile is resolved. The connection itself is
 * OAuth on the `zcc` profile (accounts.zohocorpcloud.in), connected from a refresh token because
 * the IAM-issued ZCC client's redirect URI is fixed and can never match this app's callback.
 *
 * ── Three rules this file exists to keep ─────────────────────────────────────────────────────
 *
 * 1. THE PATH AND THE ORGANISATION NEVER COME FROM THE CLIENT. Each function below builds its own
 *    path from a literal, and `organisation` is read from the connection's saved
 *    `default_organisation` — never from a request parameter. A caller who could name the org
 *    could read every org the token can see, and a caller who could name the path would turn this
 *    into an open proxy into Hacksaw (the same warning callConnection carries).
 *
 * 2. THROTTLES ARE PART OF THE CONTRACT. Hacksaw locks an endpoint for 5–10 minutes once its limit
 *    is passed, and the limits are low (20/min on products, 50/min on most report endpoints). So
 *    nothing here fans out across products or reports to build a summary, and a 429 is surfaced as
 *    itself — a reviewer who retries blindly extends their own lock-out.
 *
 * 3. NO COLLEAGUE EMAIL LEAVES THIS FILE. Hacksaw returns real addresses on AUTHOR, ASSIGNEE,
 *    UPLOADED_BY and GENERATED_BY, and ~220 of them in the filter metadata. The standing no-PII
 *    rule (claude/datastore-conventions.md) is about this app's own users; these are third
 *    parties arriving from an external system, which that rule never contemplated. The decision
 *    (2026-10-20) is: never persisted, and projected to the local part before the response is
 *    built, so `kaleeswaran.n@zohocorp.com` reaches the browser as `kaleeswaran.n`.
 */

const conn = require('./connections-service');
const { findingKey } = require('./hacksaw-review-service');

const SERVICE_KEY = 'zoho-hacksaw';

/** Scans the violations screen can ask for. `scan` is validated against this, never passed through. */
const SCANS = ['CODE_VIOLATIONS', 'MISCONFIGURATIONS', 'HARDCODED_SECRETS', 'RUNTIME_CODE_VIOLATIONS'];

/** CODE_VIOLATIONS is per-language and Hacksaw rejects it without one — ZHE164 FILE_TYPE_MANDATORY. */
const FILE_TYPES = ['java', 'js', 'python', 'clang'];

/** Filter keys we forward. AUTHOR/ASSIGNEE are deliberately absent — see rule 3. */
const FILTER_KEYS = ['FILE_TYPE', 'TYPE', 'STATUS', 'PRIORITY', 'RULE', 'TAG', 'TRACKING_STATUS', 'CONTEXT'];

const PAGE_LIMITS = [50, 100, 200];

/** Hacksaw said no, and the reason matters to the caller. */
class HacksawError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** A lock-out, not a failure — saying so is what stops a reviewer from extending it. */
class RateLimited extends HacksawError {
  constructor(endpoint) {
    super(`Hacksaw rate limit hit on ${endpoint}. That endpoint locks for 5–10 minutes — wait before retrying.`, 429);
  }
}

/**
 * Identity as shown on screen. Decided 2026-10-20 (Pk): full address, as the v7 design renders
 * it — displayed live, never persisted. Earlier this trimmed to the local part; the name is kept
 * so the one place the rule lives stays obvious.
 */
const localPart = (v) => String(v || '').trim();

/**
 * The Hacksaw organisation for this connection. Saved as `default_organisation` in EXTRA_CONFIG
 * when the connection is made; there is no request parameter for it, by design (rule 1).
 */
async function organisationFor(req) {
  const { credential } = await conn.resolveCredential(req, SERVICE_KEY);
  const org = (conn.parseExtraConfig(credential.EXTRA_CONFIG) || {}).default_organisation;
  if (!org) {
    throw new HacksawError(
      'This Hacksaw connection has no default organisation. Set it on the connection in Settings → Connections.',
      424,
    );
  }
  return org;
}

/**
 * One GET against Hacksaw. `path` is always a literal from a caller below, never client input.
 *
 * Hacksaw answers 200 with an error envelope as readily as it answers a 4xx, so both shapes are
 * normalised here — ERROR_MESSAGE/DESCRIPTION/ERROR_CODE is its failure shape (ZHE164, ZHE01, …).
 */
async function hsGet(req, path, params) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== '') query.set(k, String(v));
  }
  const resp = await conn.callConnection(req, SERVICE_KEY, `${path}?${query.toString()}`);
  const text = await resp.text();

  if (resp.status === 429) throw new RateLimited(path);

  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  // 424 rather than 502 for an upstream problem, deliberately: index.js's error handler replaces
  // the message of any 5xx with "Internal error", and function logs are console-only — so a 5xx
  // here would leave a reviewer, and whoever they ask, with nothing to go on. 424 keeps Hacksaw's
  // own words (ZHE164, ZHE01 …) in the response, which is the whole diagnosis.
  if (json === null) {
    throw new HacksawError(`Hacksaw returned a non-JSON response (HTTP ${resp.status}) from ${path}`, 424);
  }
  if (!resp.ok || json.ERROR_MESSAGE) {
    const code = json.ERROR_CODE ? ` [${json.ERROR_CODE}]` : '';
    const why = json.DESCRIPTION || json.ERROR_MESSAGE || `HTTP ${resp.status}`;
    throw new HacksawError(`Hacksaw: ${why}${code}`, resp.status >= 500 || resp.status === 200 ? 424 : resp.status);
  }
  return json;
}

const pageOf = (v, d = 1) => Math.max(1, parseInt(v, 10) || d);
const limitOf = (v) => (PAGE_LIMITS.includes(Number(v)) ? Number(v) : PAGE_LIMITS[0]);

/* ------------------------------------------------------------------ products */

/**
 * Products in the org. `ownership=OWNER` is the default because the 28 products this team owns are
 * the ones worth reviewing — the org has 3,717 in total, which is not a list anyone scrolls.
 * Throttled at 20/min with a 10-minute lock, so this is a prime candidate for the phase-3 cache.
 */
async function listProducts(req, { ownership } = {}) {
  const organisation = await organisationFor(req);
  const own = ownership === 'MEMBER' ? 'MEMBER' : 'OWNER';
  // Ownership rides inside `filters`, not as its own parameter — a bare `ownership=` is rejected
  // with `ZSE011 An invalid parameter "Ownership" was found`, which reads like a value problem.
  const json = await hsGet(req, '/api/products', {
    action: 'fetchproducts', organisation, filters: JSON.stringify({ ownership: [own] }),
  });
  const block = (json.DATA || [])[0] || {};
  return {
    success: true,
    organisation,
    ownership: own,
    total: block.TOTAL_COUNT || 0,
    products: (block.VALUES || []).map(p => ({
      name: p.NAME,
      id: p.PRODUCT_AUTO_ID,
      type: p.PRODUCT_TYPE,
      report_count: p.REPORT_COUNT,
      has_group: p.IS_PRODUCT_GROUP_EXISTS,
    })),
  };
}

/* ------------------------------------------------------------------ reports */

/**
 * Reports for one product, newest first as Hacksaw returns them.
 *
 * `is_deployed` is the field that matters and the reason this screen does not simply take the
 * newest: on 20 Oct 2026 the newest report for Logs360cloud was an unreleased pre-release build,
 * while the deployed one was four days older. A review tool defaults to what is actually live.
 */
async function listReports(req, { product, page, limit } = {}) {
  if (!product) throw new HacksawError("'product' is required", 400);
  const organisation = await organisationFor(req);
  const json = await hsGet(req, '/api/build', {
    action: 'fetchreports',
    organisation,
    productname: product,
    pageno: pageOf(page),
    pagelimit: limitOf(limit),
  });
  const content = json.CONTENT || {};
  return {
    success: true,
    organisation,
    product,
    total: content.TOTAL_REPORT_COUNT || 0,
    reports: (content.REPORT_DETAILS || []).map(r => ({
      label: r.REPORT_LABEL,
      id: r.REPORT_ID,
      status: r.STATUS,
      violation_count: r.VIOLATION_COUNT,
      is_deployed: r.IS_DEPLOYED,
      is_blocked: r.IS_BLOCKED,
      is_important: r.IS_IMPORTANT,
      is_patch: r.IS_PATCH,
      asset_type: r.ASSET_TYPE,
      uploaded_at: r.UPLOADED_AT,
      uploaded_by: localPart(r.UPLOADED_BY),
      tags: r.REPORT_TAGS || [],
    })),
  };
}

/* ------------------------------------------------------------------ report statistics */

/** One scan's SUMMARY[] of {TYPE, COUNT} → a flat object, with the types we show always present. */
const summaryOf = (rows) => {
  const out = { ERROR: 0, WARNING: 0, INFO: 0, OPEN: 0, TOTAL: 0, BLOCKING: 0 };
  for (const r of rows || []) if (r && r.TYPE in out) out[r.TYPE] = r.COUNT || 0;
  return out;
};

const scanOf = (s) => ({
  name: s.SCAN_NAME,
  display: s.DISPLAY_NAME,
  status: s.STATUS,
  blocking_status: s.BLOCKING_STATUS || null,
  is_blocking_scan: s.IS_BLOCKING_SCAN === 'YES',
  // NOT_YET_GENERATED is why a report's overall status can be INDETERMINATE: the header has to
  // say "not yet run" rather than let an unrun blocking scan read as a pass.
  ran: s.STATUS === 'SUCCESS',
  summary: s.STATUS === 'SUCCESS' ? summaryOf(s.SUMMARY) : null,
  duration_ms: s.DURATION || null,
  subscans: (s.SUBSCANS || []).map(scanOf),
});

/** The screen header: per-scan counts, blocking state, and the deep link out to Hacksaw. */
async function getReportStats(req, { product, label } = {}) {
  if (!product || !label) throw new HacksawError("'product' and 'label' are required", 400);
  const organisation = await organisationFor(req);
  const json = await hsGet(req, '/api/reports', {
    action: 'fetchstatistics', organisation, productname: product, reportlabel: label,
  });
  const r = (json.DATA || [])[0];
  if (!r) throw new HacksawError('No statistics for that report', 404);
  return {
    success: true,
    organisation,
    product,
    report: {
      label: r.REPORT_LABEL,
      reference_id: r.REFERENCE_ID,
      base_report_id: r.BASE_REPORT_ID,
      generation_status: r.REPORT_GENERATION_STATUS,
      blocking_status: r.REPORT_BLOCKING_STATUS,
      blocking_violations: r.BLOCKING_VIOLATIONS_COUNT || 0,
      notes: r.NOTES || null,
      started_at: r.START_TIME,
      ended_at: r.END_TIME,
      duration_ms: r.DURATION || null,
      generated_by: localPart(r.GENERATED_BY),
      // Every screen offers this: the app is read-only against Hacksaw, so acting on a finding
      // means going there.
      report_link: r.REPORT_LINK || null,
      build_url: r.BUILD_URL || null,
      scans: (r.SCANS || []).map(scanOf),
    },
  };
}

/* ------------------------------------------------------------------ violations */

/** Narrow a caller's filter object to the keys we forward, dropping anything unexpected. */
function cleanFilters(raw) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const key of FILTER_KEYS) {
    const v = src[key];
    if (!Array.isArray(v) || !v.length) continue;
    const vals = v.map(x => String(x).trim()).filter(Boolean).slice(0, 50);
    if (vals.length) out[key] = vals;
  }
  return out;
}

/**
 * Violations for one scan of one report.
 *
 * `file_type` is mandatory for CODE_VIOLATIONS — without it Hacksaw answers
 * `ZHE164 FILE_TYPE_MANDATORY`, so the screen's language selector is an API requirement rather
 * than a convenience. It travels inside `filters`, not as its own parameter.
 */
async function listViolations(req, { product, label, scan, file_type: fileType, filters, page, limit } = {}) {
  if (!product || !label) throw new HacksawError("'product' and 'label' are required", 400);
  if (!SCANS.includes(scan)) throw new HacksawError(`'scan' must be one of ${SCANS.join(', ')}`, 400);

  const applied = cleanFilters(filters);
  if (scan === 'CODE_VIOLATIONS') {
    const ft = String(fileType || '').toLowerCase();
    if (!FILE_TYPES.includes(ft)) {
      throw new HacksawError(
        `'file_type' is required for CODE_VIOLATIONS and must be one of ${FILE_TYPES.join(', ')}`, 400,
      );
    }
    applied.FILE_TYPE = [ft];
  }

  const organisation = await organisationFor(req);
  const json = await hsGet(req, '/api/reports', {
    action: 'fetchviolations',
    organisation,
    productname: product,
    reportlabel: label,
    scan,
    pageno: pageOf(page),
    pagelimit: limitOf(limit),
    responsetype: 'JSON',
    ...(Object.keys(applied).length ? { filters: JSON.stringify(applied) } : {}),
  });

  const block = (json.DATA || [])[0] || {};
  return {
    success: true,
    organisation,
    product,
    label,
    scan,
    filters: applied,
    page: pageOf(page),
    limit: limitOf(limit),
    total: block.TOTAL_COUNT || 0,
    violations: (block.VALUES || []).map(v => ({
      // Stable across builds, unlike VIOLATION_AUTO_ID — this is what a decision is filed under.
      key: findingKey({ kind: 'violation', product, rule: v.RULE_NAME, file: v.FILE_NAME, snippet: v.SNIPPET }),
      id: v.VIOLATION_AUTO_ID,
      type_specific_id: v.TYPE_SPECIFIC_VIOLATION_AUTO_ID,
      rule: v.RULE_NAME,
      priority: v.PRIORITY,
      type: v.TYPE,
      status: v.STATUS,
      is_blocked: v.IS_BLOCKED === 'YES' || v.IS_BLOCKED === true,
      file_name: v.FILE_NAME,
      file_id: v.FILE_AUTO_ID,
      file_type: v.FILE_TYPE,
      line_no: v.LINE_NO,
      snippet: v.SNIPPET,
      context: v.CONTEXT,
      author: localPart(v.AUTHOR),
      assignee: localPart(v.ASSIGNEE),
      owasp_id: v.OWASP_ID || null,
      sans_id: v.SANS_ID || null,
      standards: v.ASSOCIATED_SECURITY_STANDARD_RULES || [],
      is_tracked: v.IS_TRACKED === 'YES' || v.IS_TRACKED === true,
      tags: v.TAGS || [],
      link: v.VIOLATION_LINK || null,
      // The design's "R.T.E 1/3": remaining temporary exclusions over the limit.
      temporary_exclusions_left: v.REMAINING_TEMPORARY_EXCLUSION_COUNT,
      temporary_exclusions_limit: v.MAXIMUM_TEMPORARY_EXCLUSION_LIMIT,
    })),
  };
}

/**
 * The filter vocabulary for one scan, so the screen's chips come from Hacksaw rather than a
 * hardcoded list that drifts.
 *
 * Hacksaw's own response is ~56 KB, most of it AUTHOR and ASSIGNEE — about 220 colleague email
 * addresses each. Those two keys are dropped here rather than projected: a 220-entry dropdown is
 * not a usable control anyway, and shipping the list would put an org address book in the browser
 * for no gain (rule 3). Filtering by author becomes a server-side typeahead when someone needs it.
 */
async function listViolationFilters(req, { product, label, scan, file_type: fileType } = {}) {
  if (!product || !label) throw new HacksawError("'product' and 'label' are required", 400);
  if (!SCANS.includes(scan)) throw new HacksawError(`'scan' must be one of ${SCANS.join(', ')}`, 400);

  const ft = String(fileType || '').toLowerCase();
  if (scan === 'CODE_VIOLATIONS' && !FILE_TYPES.includes(ft)) {
    throw new HacksawError(`'file_type' is required for CODE_VIOLATIONS`, 400);
  }

  const organisation = await organisationFor(req);
  const json = await hsGet(req, '/api/reports', {
    action: 'fetchfilters',
    organisation,
    productname: product,
    reportlabel: label,
    scan,
    ...(FILE_TYPES.includes(ft) ? { filetype: ft } : {}),
  });

  const out = {};
  for (const entry of json.DATA || []) {
    if (!entry || !FILTER_KEYS.includes(entry.KEY)) continue;
    const values = (entry.VALUE || [])
      // CONTEXT and COMPONENT come back as objects; everything we forward is a plain string.
      .filter(v => typeof v === 'string')
      .slice(0, 200);
    if (values.length) out[entry.KEY] = values;
  }
  return { success: true, product, label, scan, file_type: ft || null, filters: out };
}


/* ------------------------------------------------------------------ vulnerable components (SCA) */

/** The purl that identifies a component — the stable review key (see the design doc). */
function mainIdentifier(c) {
  const purls = c.IDENTIFIERS?.PURL_IDENTIFIERS || [];
  const cpes = c.IDENTIFIERS?.CPE_IDENTIFIERS || [];
  const main = purls.find(p => p.IS_MAIN_IDENTIFIER === 'YES') || purls[0] || cpes[0];
  return main?.VALUE || `${c.NAME}@${c.VERSION}`;
}

/**
 * SCA components with at least one known vulnerability, for one report.
 *
 * Small by nature — 7 for the sample report against 1,283 misconfigurations — so this endpoint
 * does not page; Hacksaw returns the set in one CONTENT array.
 *
 * `UPCOMING_BLOCKING_TIME` is the field this screen exists for: it says when an open component
 * starts failing builds, which is the one thing a team wants sorted and dated. Components that
 * already block (`IS_BLOCKED`) come first, then those with a deadline soonest-first, then the
 * rest by vulnerability count — Hacksaw's own order is by neither.
 *
 * The identifier list is NOT trimmed here: an uber jar legitimately carries 26 purls for what is
 * bundled inside it, and that list is the evidence for why the component is flagged. The UI
 * collapses it; the API keeps it.
 */
async function listComponents(req, { product, label } = {}) {
  if (!product || !label) throw new HacksawError("'product' and 'label' are required", 400);
  const organisation = await organisationFor(req);
  const json = await hsGet(req, '/api/vulnerablecomponentsreport', {
    action: 'fetchvulnerablecomponents',
    organisation,
    productname: product,
    reportlabel: label,
    // Documented as required; an empty object is Hacksaw's accepted "no filter".
    filter: '{}',
  });

  const rows = (json.CONTENT || []).map(c => ({
    key: findingKey({ kind: 'component', product, identifier: mainIdentifier(c) }),
    id: c.COMPONENT_AUTO_ID,
    name: c.NAME,
    version: c.VERSION,
    identifier: mainIdentifier(c),
    identifiers: [
      ...(c.IDENTIFIERS?.PURL_IDENTIFIERS || []).map(p => p.VALUE),
      ...(c.IDENTIFIERS?.CPE_IDENTIFIERS || []).map(p => p.VALUE),
    ],
    path: c.PATH,
    context: c.CONTEXT,
    type: c.COMPONENT_TYPE,
    origin: c.COMPONENT_ORIGIN,
    ownership: c.OWNERSHIP,
    confidence: c.COMPONENT_IDENTIFICATION_CONFIDENCE,
    vulnerability_count: c.VULNERABILITY_COUNT || 0,
    is_blocked: c.IS_BLOCKED === true,
    status: c.STATUS,
    blocking_at: c.UPCOMING_BLOCKING_TIME || null,
    reachable: c.HAS_REACHABLE_VULNERABILITIES,
    reachability: c.HIGHEST_VULNERABILITY_REACHABILITY_LEVEL,
    age: c.COMPONENT_AGE || null,
    released_on: c.RELEASED_DATE || null,
    eol: c.EOL_STATUS,
    packaging: c.PACKAGING_TYPE || [],
    bundled_from: (c.BUNDLED_FROM || []).map(b => ({ name: b.NAME, version: b.VERSION })),
    assignee: localPart(c.ASSIGNEE),
    temporary_exclusions_left: c.REMAINING_TEMPORARY_EXCLUSION_COUNT,
  }));

  // Blocking first, then by deadline, then by how much is wrong with it.
  const when = (r) => (r.blocking_at ? Date.parse(r.blocking_at.replace(' ', 'T')) || Infinity : Infinity);
  rows.sort((a, b) => (
    (b.is_blocked - a.is_blocked)
    || (when(a) - when(b))
    || (b.vulnerability_count - a.vulnerability_count)
  ));

  return {
    success: true,
    organisation,
    product,
    label,
    total: rows.length,
    blocking: rows.filter(r => r.is_blocked).length,
    components: rows,
  };
}

/** The CVEs behind one component. `component_id` is an id this app handed out, not a free path. */
async function listComponentVulnerabilities(req, { product, label, component_id: componentId, component_type: componentType } = {}) {
  if (!product || !label) throw new HacksawError("'product' and 'label' are required", 400);
  if (!/^\d+$/.test(String(componentId || ''))) throw new HacksawError("'component_id' must be numeric", 400);

  const organisation = await organisationFor(req);
  const json = await hsGet(req, '/api/vulnerablecomponentsreport', {
    action: 'fetchcomponentvulnerabilities',
    organisation,
    productname: product,
    reportlabel: label,
    componentautoid: componentId,
    ...(componentType ? { componenttype: componentType } : {}),
  });

  const raw = Array.isArray(json.CONTENT) ? json.CONTENT : (json.DATA || []);
  // Severity first, then EPSS: a 9.8 nobody is exploiting still outranks a 5.0 that is, for
  // triage order, but the actively-exploited flag is what a reviewer actually acts on — so both
  // travel and the UI shows the flag, rather than collapsing them into one number here.
  const rows = raw.map(v => ({
    id: v.VULNERABILITY_ID,
    auto_id: v.VULNERABILITY_AUTO_ID,
    severity: typeof v.SEVERITY_SCORE === 'number' ? v.SEVERITY_SCORE : null,
    exploitability: typeof v.EXPLOITABILITY_SCORE === 'number' ? v.EXPLOITABILITY_SCORE : null,
    actively_exploited: v.IS_ACTIVELY_EXPLOITED === true || v.IS_ACTIVELY_EXPLOITED === 'YES',
    reachable: v.IS_REACHABLE === true || v.IS_REACHABLE === 'YES',
    reachability: v.REACHABILITY_TYPE || null,
    status: v.VULNERABILITY_STATUS || null,
    cwe: v.CWE || null,
    description: v.DESCRIPTION || null,
    link: v.LINK || null,
    source: v.SOURCE || null,
    published_at: v.PUBLISHED_TIME || null,
    affects: v.AFFECTED_IDENTIFIER || null,
  })).sort((a, b) => (
    (b.actively_exploited - a.actively_exploited)
    || ((b.severity ?? -1) - (a.severity ?? -1))
  ));
  return { success: true, product, label, component_id: componentId, total: rows.length, vulnerabilities: rows };
}


/* ------------------------------------------------------------------ diff reports (WIP vs base) */

/** What a diff asks about: findings NEW in the WIP build, still RECURRING, or FIXED since base. */
const DIFF_CATEGORIES = ['NEW', 'RECURRING', 'FIXED'];

/**
 * Statistics for one build compared against a base build.
 *
 * This is the endpoint the v7 design is built on — "scan findings new in WIP vs base". It was
 * listed as unverified in the design doc (the docs disagree on its action parameter); verified
 * working 2026-10-20 against Logs360cloud, pre-release-13.3 vs the Oct 16 deployed build.
 *
 * A scan can FAIL here for a reason that is not a failure of this build: `ZHE403
 * SCAN_RESULT_NOT_AVAILABLE_IN_COMPARED_REPORT` means the BASE never ran that scan, so there is
 * nothing to compare. That is surfaced as its own state — treating it as "no new findings" would
 * be a lie by omission on a security screen.
 */
async function getDiffStats(req, { product, label, base_label: baseLabel, diff_type: diffType } = {}) {
  if (!product || !label || !baseLabel) {
    throw new HacksawError("'product', 'label' and 'base_label' are required", 400);
  }
  const type = DIFF_CATEGORIES.includes(diffType) ? diffType : 'NEW';
  const organisation = await organisationFor(req);
  const json = await hsGet(req, '/api/diffreports', {
    action: 'fetchdiffstatistics',
    organisation,
    productname: product,
    reportlabel: label,
    basereportlabel: baseLabel,
    difftype: type,
  });
  const r = (json.DATA || [])[0];
  if (!r) throw new HacksawError('No diff statistics for that pair', 404);

  const scanOfDiff = (sc) => ({
    name: sc.SCAN_NAME,
    display: sc.DISPLAY_NAME,
    status: sc.STATUS,
    ran: sc.STATUS === 'SUCCESS',
    // The base lacking the scan is a different thing from the scan failing.
    uncomparable: sc.FAILURE_DETAILS?.ERROR_CODE === 'ZHE403',
    note: sc.NOTES || sc.FAILURE_DETAILS?.REASON || null,
    blocking_status: sc.BLOCKING_STATUS || null,
    summary: sc.STATUS === 'SUCCESS' ? summaryOf(sc.SUMMARY) : null,
    subscans: (sc.SUBSCANS || []).map(scanOfDiff),
  });

  return {
    success: true,
    organisation,
    product,
    diff: {
      label: r.REPORT_LABEL,
      base_label: r.BASE_REPORT_LABEL,
      diff_type: type,
      generation_status: r.DIFF_REPORT_GENERATION_STATUS,
      blocking_status: r.DIFF_REPORT_BLOCKING_STATUS,
      blocking_violations: r.BLOCKING_VIOLATIONS_COUNT || 0,
      notes: r.NOTES || null,
      report_link: r.REPORT_LINK || null,
      scans: (r.SCANS || []).map(scanOfDiff),
    },
  };
}

/**
 * The findings themselves for a diff. `DIFF_CATEGORY` is required by Hacksaw, so it is always
 * sent. The response shape differs from fetchviolations — `VIOLATIONS` / `TOTAL_VIOLATIONS_COUNT`
 * at the top level rather than a DATA[0].VALUES block — and hardcoded-secret rows carry `SECRET`
 * and `ENTROPY`, which the non-diff endpoint does not return.
 */
async function listDiffViolations(req, {
  product, label, base_label: baseLabel, scan, diff_category: diffCategory,
  file_type: fileType, filters, page, limit,
} = {}) {
  if (!product || !label || !baseLabel) {
    throw new HacksawError("'product', 'label' and 'base_label' are required", 400);
  }
  if (!SCANS.includes(scan) && scan !== 'VULNERABLE_COMPONENTS') {
    throw new HacksawError("'scan' is not one this diff supports", 400);
  }
  const category = DIFF_CATEGORIES.includes(diffCategory) ? diffCategory : 'NEW';

  const applied = { ...cleanFilters(filters), DIFF_CATEGORY: [category] };
  if (scan === 'CODE_VIOLATIONS') {
    const ft = String(fileType || '').toLowerCase();
    if (!FILE_TYPES.includes(ft)) {
      throw new HacksawError("'file_type' is required for CODE_VIOLATIONS", 400);
    }
    applied.FILE_TYPE = [ft];
  }

  const organisation = await organisationFor(req);
  const json = await hsGet(req, '/api/diffreports', {
    action: 'fetchreport',
    organisation,
    productname: product,
    reportlabel: label,
    basereportlabel: baseLabel,
    scan,
    pageno: pageOf(page),
    pagelimit: limitOf(limit),
    filter: JSON.stringify(applied),
  });

  const rows = json.VIOLATIONS || [];
  return {
    success: true,
    product,
    label,
    base_label: baseLabel,
    scan,
    diff_category: category,
    page: pageOf(page),
    limit: limitOf(limit),
    total: json.TOTAL_VIOLATIONS_COUNT || 0,
    violations: rows.map(v => ({
      key: findingKey({ kind: 'violation', product, rule: v.RULE_NAME, file: v.FILE_NAME, snippet: v.SNIPPET }),
      id: v.VIOLATION_AUTO_ID,
      type_specific_id: v.TYPE_SPECIFIC_VIOLATION_AUTO_ID,
      rule: v.RULE_NAME,
      priority: v.PRIORITY,
      type: v.TYPE,
      status: v.STATUS,
      is_blocked: v.IS_BLOCKED === 'YES' || v.IS_BLOCKED === true,
      file_name: v.FILE_NAME,
      file_type: v.FILE_TYPE,
      line_no: v.LINE_NO,
      snippet: v.SNIPPET,
      context: v.CONTEXT,
      author: localPart(v.AUTHOR),
      assignee: localPart(v.ASSIGNEE),
      standards: v.ASSOCIATED_SECURITY_STANDARD_RULES || [],
      link: v.VIOLATION_LINK || null,
      tags: v.TAGS || [],
      // Hardcoded-secrets only: the matched secret and its Shannon entropy.
      secret: v.SECRET || null,
      entropy: typeof v.ENTROPY === 'number' ? v.ENTROPY : null,
      temporary_exclusions_left: v.REMAINING_TEMPORARY_EXCLUSION_COUNT,
      temporary_exclusions_limit: v.MAXIMUM_TEMPORARY_EXCLUSION_LIMIT,
    })),
  };
}

/* ------------------------------------------------------------------ activity history */

/**
 * What has happened to one finding in Hacksaw — status changes with the developer's REASON,
 * assignments, tags. This is the developer's half of the review conversation, read live; the
 * Reviewer shows it beside the finding so the reviewer sees what was already said in Hacksaw.
 *
 * 25/min with a 10-minute lock — the tightest throttle in the module — so it is fetched on expand
 * for one finding, never for a list.
 */
async function listActivities(req, { product, violation_id: violationId, scan } = {}) {
  if (!product) throw new HacksawError("'product' is required", 400);
  if (!/^\d+$/.test(String(violationId || ''))) throw new HacksawError("'violation_id' must be numeric", 400);
  if (!SCANS.includes(scan) && scan !== 'VULNERABLE_COMPONENTS') throw new HacksawError("'scan' is not valid", 400);
  const organisation = await organisationFor(req);
  const json = await hsGet(req, '/api/violations', {
    action: 'fetchactivities', organisation, productname: product, violationautoid: violationId, scan,
  });
  const block = (json.DATA || [])[0] || {};
  return {
    success: true,
    summary: block.SUMMARY || {},
    activities: (block.DETAILS || []).map(a => ({
      id: a.ACTIVITY_AUTO_ID,
      type: a.ACTIVITY_TYPE,
      at: a.DATE,
      by: a.USER_DETAILS ? { name: a.USER_DETAILS.USER_NAME, email: a.USER_DETAILS.EMAILID } : null,
      from_status: a.FROM_STATUS || null,
      to_status: a.TO_STATUS || null,
      reason: a.REASON || null,
      action: a.ACTION || null,
      tags: a.TAGS || null,
    })),
  };
}

module.exports = {
  SCANS, FILE_TYPES, PAGE_LIMITS, listActivities,
  HacksawError, RateLimited,
  listProducts, listReports, getReportStats, listViolations, listViolationFilters,
  listComponents, listComponentVulnerabilities,
  DIFF_CATEGORIES, getDiffStats, listDiffViolations,
};
