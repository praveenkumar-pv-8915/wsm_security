/**
 * Hacksaw Reviewer — the developer-submitted review of a release's new Hacksaw findings.
 *
 * The workflow (claude/hacksaw-module-design.md, "Workflow (final)"):
 *
 *   developer creates  →  draft      : picks repos, each with a base and a feature build
 *   developer replies  →  per finding: reply + proposed status; an AI verdict is generated on it
 *   developer submits  →  submitted  : only once every finding has a reply
 *   reviewer accepts / responds per finding; developer replies again; it round-trips
 *   reviewer pushes accepted statuses to Hacksaw — bulk, or selected findings on demand
 *   reviewer closes    →  closed     : only once every finding is accepted
 *
 * Roles: the raiser is the developer. Any Catalyst `admin` who is not the raiser is a reviewer.
 *
 * ── Storage (hybrid, decided 2026-10-20) ─────────────────────────────────────────────────────
 *
 *   Data Store `hacksaw_review`        the record the UI filters: status, raiser, reviewer, dates,
 *                                      and REPOS as a JSON array (nobody needs "reviews touching
 *                                      product X", so no child table).
 *   NoSQL      `hacksaw_review_item`   single-table: partition REVIEW_KEY, sort ITEM_KEY, typed by
 *                                      prefix — `F#<finding>` is the finding's state and AI verdict,
 *                                      `C#<finding>#<iso>` is one thread message. A reply is an
 *                                      insert: no read-modify-write, no race. One partition query
 *                                      loads a whole review.
 *
 * Retention is anchored on CLOSE. The NoSQL table's TTL attribute `EXPIRES_AT` is stamped when
 * the reviewer closes: comments at close + 6 months, findings at close + 2 years. Open reviews
 * carry no stamp. The Data Store row is purged by the `hacksaw_review_purge` scheduled task two
 * years after CLOSED_ON. Reopening clears the stamps.
 *
 * Both tables are console-created (neither store exposes table creation to the SDK). Until they
 * exist every call here fails with a 424 that names the table — the diagnosable-without-logs
 * pattern CLAUDE.md asks for.
 *
 * No PII is stored: RAISED_BY / REVIEWER_ID / AUTHOR_ID are Catalyst user_ids. Names and emails
 * are resolved live for display (datastore-conventions.md).
 */

const crypto = require('node:crypto');
const conn = require('./connections-service');
const { NoSQLItem, NoSQLMarshall, NoSQLUnMarshall } = require('zcatalyst-sdk-node/lib/no-sql');

const REVIEW_TABLE = 'hacksaw_review';
const ITEM_TABLE = 'hacksaw_review_item';

const REVIEW_COLUMNS = 'ROWID, CREATEDTIME, REVIEW_KEY, TITLE, STATUS, RAISED_BY, REVIEWER_ID, SUBMITTED_ON, CLOSED_ON, REPOS';

const STATUSES = ['draft', 'submitted', 'closed'];
const DEV_STATUSES = ['Open', 'False positive', 'Temporarily excluded', 'Permanently excluded'];
const REVIEW_STATES = ['pending', 'accepted', 'responded'];

const SIX_MONTHS_S = 183 * 86400;
const TWO_YEARS_S = 731 * 86400;

class ReviewError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}

/* ------------------------------------------------------------------ helpers */

const esc = (v) => String(v).replace(/'/g, "''");
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function ds(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) throw new ReviewError('Catalyst authentication required', 401);
  return app;
}

/** A store error that is really "the table is not there yet" becomes a 424 naming it. */
function storeError(e, table) {
  const msg = String((e && e.message) || e || '');
  if (e && e.status && e.status < 500) return e;
  if (/not found|does not exist|invalid table|no such table|INVALID_TABLE|TABLE_NOT_FOUND/i.test(msg)) {
    return new ReviewError(
      `The ${table} table is not available in this environment — create it in the Catalyst console ` +
      `(see claude/hacksaw-module-design.md, Storage). Store said: ${msg}`,
      424,
    );
  }
  const err = new Error(`${table}: ${msg}`);
  err.status = 500;
  return err;
}

function unwrap(rows) {
  return (rows || []).map(r => r[REVIEW_TABLE] || r);
}

/** Same key the Hacksaw service stamps on every finding — a decision follows the defect, not the report. */
function findingKey({ kind, product, rule, file, snippet, identifier }) {
  if (kind === 'component') return `c:${sha(`${product}|${norm(identifier)}`)}`;
  return `v:${sha(`${product}|${norm(rule)}|${norm(file)}|${norm(snippet)}`)}`;
}

const F = (k) => `F#${k}`;
const C = (k, iso) => `C#${k}#${iso}`;

/** An item from NoSQL's typed JSON into plain values. */
function plain(item) {
  const out = {};
  for (const [k, v] of Object.entries(item || {})) {
    try { out[k] = NoSQLUnMarshall.makeNative(v); } catch { out[k] = v; }
  }
  return out;
}

function itemsTable(req) {
  return ds(req).nosql().table(ITEM_TABLE);
}

async function queryItems(req, reviewKey, prefix) {
  const t = itemsTable(req);
  const key_condition = {
    group_operator: 'AND',
    group: [
      { attribute: 'REVIEW_KEY', operator: 'equals', value: NoSQLMarshall.makeString(reviewKey) },
      ...(prefix ? [{ attribute: 'ITEM_KEY', operator: 'begins_with', value: NoSQLMarshall.makeString(prefix) }] : []),
    ],
  };
  const all = [];
  let start_key;
  try {
    // 100 items a page, manual continuation — a review with 24 findings and a live discussion
    // crosses it, so paging is not optional.
    for (let guard = 0; guard < 50; guard++) {
      const resp = await t.queryTable({ key_condition, forward_scan: true, limit: 100, ...(start_key ? { start_key } : {}) });
      const data = resp && (resp.toJSON ? resp.toJSON() : resp);
      for (const d of (data.get || [])) all.push(plain(d.item));
      start_key = data.start_key;
      if (!start_key || Object.keys(start_key).length === 0) break;
    }
  } catch (e) {
    throw storeError(e, ITEM_TABLE);
  }
  return all;
}

async function putItem(req, values) {
  const item = new NoSQLItem();
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') item.addNumber(k, v);
    else if (typeof v === 'boolean') item.addBoolean(k, v);
    else item.addString(k, String(v));
  }
  try {
    await itemsTable(req).insertItems({ item });
  } catch (e) {
    throw storeError(e, ITEM_TABLE);
  }
}

async function patchItem(req, reviewKey, itemKey, values) {
  const update_attributes = Object.entries(values).map(([k, v]) => ({
    operation_type: v === null ? 'DELETE' : 'PUT',
    attribute_path: [k],
    ...(v === null ? {} : { update_value: typeof v === 'number' ? NoSQLMarshall.makeNumber(v) : NoSQLMarshall.makeString(String(v)) }),
  }));
  try {
    await itemsTable(req).updateItems({
      keys: { REVIEW_KEY: NoSQLMarshall.makeString(reviewKey), ITEM_KEY: NoSQLMarshall.makeString(itemKey) },
      update_attributes,
    });
  } catch (e) {
    throw storeError(e, ITEM_TABLE);
  }
}

/* ------------------------------------------------------------------ review rows (Data Store) */

function rowToReview(r) {
  let repos = [];
  try { repos = JSON.parse(r.REPOS || '[]'); } catch { repos = []; }
  return {
    key: r.REVIEW_KEY,
    rowid: String(r.ROWID),
    title: r.TITLE,
    status: r.STATUS || 'draft',
    raised_by: r.RAISED_BY,
    reviewer_id: r.REVIEWER_ID || null,
    created_at: r.CREATEDTIME || null,
    submitted_on: r.SUBMITTED_ON || null,
    closed_on: r.CLOSED_ON || null,
    repos,
  };
}

async function fetchReviewRow(req, reviewKey) {
  try {
    const rows = unwrap(await ds(req).zcql().executeZCQLQuery(
      `SELECT ${REVIEW_COLUMNS} FROM ${REVIEW_TABLE} WHERE REVIEW_KEY = '${esc(reviewKey)}'`,
    ));
    if (!rows.length) throw new ReviewError('No such review', 404);
    return rows[0];
  } catch (e) {
    throw storeError(e, REVIEW_TABLE);
  }
}

async function updateReviewRow(req, rowid, patch) {
  try {
    await ds(req).datastore().table(REVIEW_TABLE).updateRow({ ROWID: String(rowid), ...patch });
  } catch (e) {
    throw storeError(e, REVIEW_TABLE);
  }
}

/* ------------------------------------------------------------------ roles */

function roleFor(req, review) {
  const me = String(req.userId);
  const isRaiser = String(review.raised_by) === me;
  const isAdmin = String(req.caller?.role || '').toLowerCase() === 'admin';
  return {
    is_developer: isRaiser,
    // The raiser never reviews their own submission, whatever their role.
    is_reviewer: isAdmin && !isRaiser,
  };
}

function requireDeveloper(req, review) {
  if (!roleFor(req, review).is_developer) throw new ReviewError('Only the developer who raised this review can do that', 403);
}
function requireReviewer(req, review) {
  if (!roleFor(req, review).is_reviewer) throw new ReviewError('Only an admin other than the raiser can review this', 403);
}

/** Catalyst user_id → { name, email }, read live and never stored. */
async function peopleMap(req) {
  try {
    const users = await ds(req).userManagement().getAllUsers();
    const out = {};
    for (const u of users || []) {
      const id = String(u.user_id || u.zuid || '');
      if (!id) continue;
      out[id] = {
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || String(u.email_id || '').split('@')[0],
        email: String(u.email_id || ''),
      };
    }
    return out;
  } catch { return {}; }
}

/* ------------------------------------------------------------------ list / get */

async function listReviews(req) {
  let rows;
  try {
    rows = unwrap(await ds(req).zcql().executeZCQLQuery(
      `SELECT ${REVIEW_COLUMNS} FROM ${REVIEW_TABLE} ORDER BY CREATEDTIME DESC LIMIT 200`,
    ));
  } catch (e) {
    throw storeError(e, REVIEW_TABLE);
  }
  const people = await peopleMap(req);
  const reviews = rows.map(rowToReview).map(r => ({
    ...r,
    raised_by_person: people[String(r.raised_by)] || null,
    reviewer_person: r.reviewer_id ? (people[String(r.reviewer_id)] || null) : null,
    role: roleFor(req, r),
  }));
  return {
    success: true,
    reviews,
    pending: reviews.filter(r => r.status === 'submitted').length,
    is_admin: String(req.caller?.role || '').toLowerCase() === 'admin',
  };
}

/** The review with its finding items and threads, grouped per finding. */
async function getReview(req, reviewKey) {
  const row = await fetchReviewRow(req, reviewKey);
  const review = rowToReview(row);
  const [items, people] = await Promise.all([queryItems(req, reviewKey), peopleMap(req)]);

  const findings = {};
  const threads = {};
  for (const it of items) {
    const key = String(it.ITEM_KEY || '');
    if (key.startsWith('F#')) {
      findings[key.slice(2)] = {
        finding_key: key.slice(2),
        product: it.PRODUCT || null,
        scan: it.SCAN || null,
        dev_status: it.DEV_STATUS || null,
        review_state: it.REVIEW_STATE || 'pending',
        accepted_by: it.ACCEPTED_BY || null,
        accepted_on: it.ACCEPTED_ON || null,
        ai: it.AI_VERDICT ? {
          verdict: it.AI_VERDICT,
          confidence: typeof it.AI_CONFIDENCE === 'number' ? it.AI_CONFIDENCE : null,
          rationale: it.AI_RATIONALE || null,
          model: it.AI_MODEL || null,
          at: it.AI_AT || null,
        } : null,
        synced_at: it.SYNCED_AT || null,
        updated_at: it.UPDATED_AT || null,
      };
    } else if (key.startsWith('C#')) {
      const fk = it.FINDING_KEY || key.slice(2).split('#')[0];
      (threads[fk] = threads[fk] || []).push({
        id: key,
        finding_key: fk,
        kind: it.KIND,
        body: it.BODY,
        author_id: it.AUTHOR_ID,
        author: people[String(it.AUTHOR_ID)] || null,
        parent_id: it.PARENT_ID || null,
        at: it.AT || key.split('#').slice(2).join('#'),
      });
    }
  }
  for (const fk of Object.keys(threads)) threads[fk].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  return {
    success: true,
    review: {
      ...review,
      raised_by_person: people[String(review.raised_by)] || null,
      reviewer_person: review.reviewer_id ? (people[String(review.reviewer_id)] || null) : null,
      role: roleFor(req, review),
    },
    findings,
    threads,
  };
}

/* ------------------------------------------------------------------ developer: create / reply / submit */

async function createReview(req, data = {}) {
  const repos = Array.isArray(data.repos) ? data.repos : [];
  if (!repos.length) throw new ReviewError("'repos' must list at least one { product, base_label, feature_label }");
  for (const r of repos) {
    if (!r || !r.product || !r.feature_label) throw new ReviewError('Every repo needs a product and a feature build');
  }
  const cleaned = repos.map(r => ({
    product: String(r.product),
    base_label: r.base_label ? String(r.base_label) : null,
    feature_label: String(r.feature_label),
  }));
  const key = `HSR-${Date.now().toString(36).toUpperCase()}`;
  const title = String(data.title || cleaned.map(r => r.product).join(', ')).slice(0, 200);
  try {
    await ds(req).datastore().table(REVIEW_TABLE).insertRow({
      REVIEW_KEY: key,
      TITLE: title,
      STATUS: 'draft',
      RAISED_BY: String(req.userId),
      REVIEWER_ID: '',
      SUBMITTED_ON: '',
      CLOSED_ON: '',
      REPOS: JSON.stringify(cleaned),
    });
  } catch (e) {
    throw storeError(e, REVIEW_TABLE);
  }
  return { success: true, key, review: { key, title, status: 'draft', repos: cleaned } };
}

/**
 * The developer's reply to one finding, with the status they propose. Stored as a `C#` message
 * and reflected on the `F#` item; then the AI verdict is generated on it.
 *
 * The finding's identity arrives as its parts, never as a key the client made up.
 */
async function reply(req, reviewKey, data = {}) {
  const row = await fetchReviewRow(req, reviewKey);
  const review = rowToReview(row);
  if (review.status === 'closed') throw new ReviewError('This review is closed', 409);

  const role = roleFor(req, review);
  const kind = role.is_developer ? 'reply' : role.is_reviewer ? 'response' : null;
  if (!kind) throw new ReviewError('You are neither the developer nor a reviewer on this review', 403);

  const body = String(data.body || '').trim();
  if (!body) throw new ReviewError("'body' is required");
  const fk = data.finding_key || findingKey(data.finding || {});
  if (!fk || fk.length < 5) throw new ReviewError('A finding identity is required');

  const iso = nowIso();
  await putItem(req, {
    REVIEW_KEY: reviewKey, ITEM_KEY: C(fk, iso), FINDING_KEY: fk,
    KIND: kind, BODY: body.slice(0, 20000), AUTHOR_ID: String(req.userId),
    PARENT_ID: data.parent_id || null, AT: iso,
  });

  const patch = { REVIEW_KEY: reviewKey, ITEM_KEY: F(fk), UPDATED_AT: iso };
  if (kind === 'reply') {
    if (data.dev_status !== undefined) {
      if (!DEV_STATUSES.includes(data.dev_status)) throw new ReviewError(`'dev_status' must be one of ${DEV_STATUSES.join(', ')}`);
      patch.DEV_STATUS = data.dev_status;
    }
    // A fresh developer reply reopens the question for the reviewer.
    patch.REVIEW_STATE = 'pending';
    if (data.finding) {
      patch.PRODUCT = data.finding.product || null;
      patch.SCAN = data.finding.scan || null;
      // What a later push to Hacksaw needs: the id in THIS build, the build, Hacksaw's scan name.
      patch.VIOLATION_ID = data.finding.violation_id ? String(data.finding.violation_id) : null;
      patch.REPORT_LABEL = data.finding.report_label || null;
      patch.HS_SCAN = data.finding.hs_scan || null;
      patch.KIND = data.finding.kind || 'violation';
    }
  } else {
    patch.REVIEW_STATE = 'responded';
  }
  await upsertFinding(req, reviewKey, fk, patch);

  let ai = null;
  if (kind === 'reply' && data.finding) {
    // Generated on every developer reply, automatically — the design's verdict is on the reply.
    ai = await aiVerdict(req, reviewKey, fk, data.finding, body, patch.DEV_STATUS || null);
  }
  return { success: true, finding_key: fk, kind, ai };
}

/** Insert-or-update for an F# item: try the update, fall back to insert when it does not exist. */
async function upsertFinding(req, reviewKey, fk, values) {
  const { REVIEW_KEY, ITEM_KEY, ...rest } = values;
  try {
    await itemsTable(req).updateItems({
      keys: { REVIEW_KEY: NoSQLMarshall.makeString(reviewKey), ITEM_KEY: NoSQLMarshall.makeString(F(fk)) },
      condition: { function: { function_name: 'attribute_exists', args: [{ attribute_path: ['ITEM_KEY'] }] } },
      update_attributes: Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => ({
        operation_type: v === null ? 'DELETE' : 'PUT', attribute_path: [k],
        ...(v === null ? {} : { update_value: typeof v === 'number' ? NoSQLMarshall.makeNumber(v) : NoSQLMarshall.makeString(String(v)) }),
      })),
    });
  } catch (e) {
    const msg = String(e && e.message || '');
    if (/not found|does not exist|invalid table|TABLE_NOT_FOUND/i.test(msg)) throw storeError(e, ITEM_TABLE);
    // Condition failed → the item does not exist yet → insert it.
    await putItem(req, { REVIEW_KEY: reviewKey, ITEM_KEY: F(fk), REVIEW_STATE: 'pending', ...rest });
  }
}

/**
 * The AI verdict on a developer's reply, through the existing PlatformAI connection. Asks for
 * strict JSON so the verdict is a value, not prose to parse. A failure is recorded as a verdict
 * of "Unavailable" rather than thrown — the reply must land even when the model does not.
 */
async function aiVerdict(req, reviewKey, fk, finding, replyBody, devStatus) {
  const prompt = [
    'You are a security reviewer checking a developer\'s justification for a static-analysis finding.',
    'Decide whether the finding is a real issue. Answer ONLY with JSON of the form',
    '{"verdict":"True positive"|"Likely false positive"|"Needs human review","confidence":0-100,"rationale":"one or two sentences"}.',
    '',
    `Rule: ${finding.rule || finding.identifier || '(component)'}`,
    `Scan: ${finding.scan || ''}`,
    `File: ${finding.file || ''}${finding.line ? `:${finding.line}` : ''}`,
    finding.snippet ? `Code: ${String(finding.snippet).slice(0, 1200)}` : '',
    finding.hacksaw_reason ? `Developer's earlier exclusion reason in Hacksaw: ${finding.hacksaw_reason}` : '',
    `Developer proposes status: ${devStatus || '(none)'}`,
    `Developer's reply: ${replyBody.slice(0, 3000)}`,
  ].filter(Boolean).join('\n');

  let verdict = 'Unavailable', confidence = null, rationale = null, model = null;
  try {
    const r = await conn.chatCompletion(req, { prompt, timeoutMs: 45000 });
    model = r.model || 'platformai';
    const m = String(r.text || '').match(/\{[\s\S]*\}/);
    const j = m ? JSON.parse(m[0]) : null;
    if (j && j.verdict) {
      verdict = String(j.verdict).slice(0, 60);
      confidence = Number.isFinite(Number(j.confidence)) ? Math.max(0, Math.min(100, Number(j.confidence))) : null;
      rationale = j.rationale ? String(j.rationale).slice(0, 4000) : null;
    } else {
      rationale = String(r.text || '').slice(0, 4000) || null;
    }
  } catch (e) {
    rationale = `AI verdict unavailable: ${String(e && e.message || e).slice(0, 300)}`;
  }
  await patchItem(req, reviewKey, F(fk), {
    AI_VERDICT: verdict, AI_CONFIDENCE: confidence, AI_RATIONALE: rationale, AI_MODEL: model, AI_AT: nowIso(),
  });
  return { verdict, confidence, rationale, model };
}

/** Developer submits: every finding the client lists must have a reply. */
async function submitReview(req, reviewKey, data = {}) {
  const row = await fetchReviewRow(req, reviewKey);
  const review = rowToReview(row);
  requireDeveloper(req, review);
  if (review.status !== 'draft') throw new ReviewError(`Review is ${review.status}, not draft`, 409);

  const expected = Array.isArray(data.finding_keys) ? data.finding_keys.map(String) : [];
  const items = await queryItems(req, reviewKey, 'C#');
  const replied = new Set(items.filter(i => i.KIND === 'reply').map(i => String(i.FINDING_KEY)));
  const missing = expected.filter(k => !replied.has(k));
  if (missing.length) {
    throw new ReviewError(`${missing.length} finding${missing.length === 1 ? '' : 's'} still ${missing.length === 1 ? 'has' : 'have'} no reply`, 409);
  }
  await updateReviewRow(req, review.rowid, { STATUS: 'submitted', SUBMITTED_ON: today() });
  return { success: true, key: reviewKey, status: 'submitted' };
}

/* ------------------------------------------------------------------ reviewer: accept / claim / close */

async function accept(req, reviewKey, data = {}) {
  const review = rowToReview(await fetchReviewRow(req, reviewKey));
  requireReviewer(req, review);
  if (review.status !== 'submitted') throw new ReviewError(`Review is ${review.status}, not submitted`, 409);
  const keys = Array.isArray(data.finding_keys) ? data.finding_keys.map(String) : [];
  if (!keys.length) throw new ReviewError("'finding_keys' is required");
  for (const fk of keys) {
    await upsertFinding(req, reviewKey, fk, {
      REVIEW_STATE: 'accepted', ACCEPTED_BY: String(req.userId), ACCEPTED_ON: today(), UPDATED_AT: nowIso(),
    });
  }
  // The first reviewer to act claims the review.
  if (!review.reviewer_id) await updateReviewRow(req, review.rowid, { REVIEWER_ID: String(req.userId) });
  return { success: true, accepted: keys.length };
}

async function claim(req, reviewKey) {
  const review = rowToReview(await fetchReviewRow(req, reviewKey));
  requireReviewer(req, review);
  await updateReviewRow(req, review.rowid, { REVIEWER_ID: String(req.userId) });
  return { success: true, reviewer_id: String(req.userId) };
}

/**
 * Close: every finding the client lists must be accepted. Stamps EXPIRES_AT on every item — this
 * is the single place retention starts, and it starts from the close date as decided.
 */
async function closeReview(req, reviewKey, data = {}) {
  const row = await fetchReviewRow(req, reviewKey);
  const review = rowToReview(row);
  requireReviewer(req, review);
  if (review.status !== 'submitted') throw new ReviewError(`Review is ${review.status}, not submitted`, 409);

  const expected = Array.isArray(data.finding_keys) ? data.finding_keys.map(String) : [];
  const items = await queryItems(req, reviewKey);
  const accepted = new Set(items.filter(i => String(i.ITEM_KEY).startsWith('F#') && i.REVIEW_STATE === 'accepted')
    .map(i => String(i.ITEM_KEY).slice(2)));
  const open = expected.filter(k => !accepted.has(k));
  if (open.length) throw new ReviewError(`${open.length} finding${open.length === 1 ? ' is' : 's are'} not yet accepted`, 409);

  const closeS = Math.floor(Date.now() / 1000);
  for (const it of items) {
    const k = String(it.ITEM_KEY);
    const ttl = k.startsWith('C#') ? closeS + SIX_MONTHS_S : closeS + TWO_YEARS_S;
    await patchItem(req, reviewKey, k, { EXPIRES_AT: ttl });
  }
  await updateReviewRow(req, review.rowid, {
    STATUS: 'closed', CLOSED_ON: today(), REVIEWER_ID: review.reviewer_id || String(req.userId),
  });
  return { success: true, key: reviewKey, status: 'closed', items_stamped: items.length };
}

async function reopenReview(req, reviewKey) {
  const review = rowToReview(await fetchReviewRow(req, reviewKey));
  requireReviewer(req, review);
  if (review.status !== 'closed') throw new ReviewError('Only a closed review can be reopened', 409);
  const items = await queryItems(req, reviewKey);
  for (const it of items) await patchItem(req, reviewKey, String(it.ITEM_KEY), { EXPIRES_AT: null });
  await updateReviewRow(req, review.rowid, { STATUS: 'submitted', CLOSED_ON: '' });
  return { success: true, key: reviewKey, status: 'submitted' };
}

/* ------------------------------------------------------------------ push to Hacksaw */

/**
 * Write accepted statuses back to Hacksaw. Needs `Hacksaw.REPORT.UPDATE` on the connection, which
 * the current token does not carry — until it does this answers 424 and changes nothing. The
 * endpoint itself is taken from the Hacksaw docs mirror and recorded in hacksaw-service.js when
 * verified; it is deliberately not guessed here.
 */
async function pushToHacksaw(req, reviewKey, data = {}) {
  const review = rowToReview(await fetchReviewRow(req, reviewKey));
  requireReviewer(req, review);
  const keys = Array.isArray(data.finding_keys) ? data.finding_keys.map(String) : [];
  if (!keys.length) throw new ReviewError("'finding_keys' is required");

  const hacksaw = require('./hacksaw-service');
  const items = await queryItems(req, reviewKey);
  const fItems = Object.fromEntries(items.filter(i => String(i.ITEM_KEY).startsWith('F#')).map(i => [String(i.ITEM_KEY).slice(2), i]));
  const replies = items.filter(i => String(i.ITEM_KEY).startsWith('C#') && i.KIND === 'reply');
  const latestReply = (fk) => replies.filter(c => String(c.FINDING_KEY) === fk).sort((x, y) => String(y.AT).localeCompare(String(x.AT)))[0];

  // Batch by what Hacksaw's call is scoped to: one product + build + scan + target status per call,
  // ≤200 ids, 10 calls a minute. Grouping is what keeps a 24-finding push to a handful of requests.
  const groups = new Map();
  const results = [];
  for (const fk of keys) {
    const f = fItems[fk];
    if (!f) { results.push({ finding_key: fk, skipped: 'not in this review' }); continue; }
    if (f.REVIEW_STATE !== 'accepted') { results.push({ finding_key: fk, skipped: 'not accepted' }); continue; }
    if (!f.VIOLATION_ID || !f.REPORT_LABEL || !f.HS_SCAN) { results.push({ finding_key: fk, skipped: 'missing Hacksaw identity on the item' }); continue; }
    const status = String(f.DEV_STATUS || 'Open').toUpperCase().replace(/\s+/g, '_');
    const g = `${f.PRODUCT}|${f.REPORT_LABEL}|${f.HS_SCAN}|${status}|${f.KIND || 'violation'}`;
    if (!groups.has(g)) groups.set(g, { product: f.PRODUCT, report_label: f.REPORT_LABEL, scan: f.HS_SCAN, status, kind: f.KIND || 'violation', members: [] });
    groups.get(g).members.push({ fk, id: String(f.VIOLATION_ID), reason: latestReply(fk)?.BODY || '' });
  }

  for (const g of groups.values()) {
    // Hacksaw takes one reason per call; the developer's replies are the reason, joined when they differ.
    const reasons = [...new Set(g.members.map(m => m.reason).filter(Boolean))];
    const reason = (reasons.join(' | ') || `Accepted in WSM Security review ${reviewKey}`).slice(0, 2000);
    try {
      const r = await hacksaw.updateViolationStatus(req, {
        product: g.product, report_label: g.report_label, scan: g.scan, kind: g.kind,
        violation_ids: g.members.map(m => m.id), to_status: g.status, reason,
      });
      const okIds = new Set(r.details.filter(d => d.ok).map(d => d.id));
      for (const m of g.members) {
        const d = r.details.find(x => x.id === m.id);
        if (okIds.has(m.id)) {
          await patchItem(req, reviewKey, F(m.fk), { SYNCED_AT: nowIso() });
          results.push({ finding_key: m.fk, pushed: true });
        } else {
          results.push({ finding_key: m.fk, error: d?.reason || 'Hacksaw reported no result for this id' });
        }
      }
    } catch (e) {
      for (const m of g.members) results.push({ finding_key: m.fk, error: String(e && e.message || e) });
    }
  }
  return { success: true, pushed: results.filter(r => r.pushed).length, results };
}

/* ------------------------------------------------------------------ retention sweep */

/** Daily: delete review rows closed more than two years ago, and any NoSQL stragglers. */
async function purge(ctx, { dryRun = false } = {}) {
  const cutoff = new Date(Date.now() - TWO_YEARS_S * 1000).toISOString().slice(0, 10);
  let rows;
  try {
    rows = unwrap(await ds(ctx).zcql().executeZCQLQuery(
      `SELECT ROWID, REVIEW_KEY, CLOSED_ON FROM ${REVIEW_TABLE} WHERE STATUS = 'closed' AND CLOSED_ON != '' AND CLOSED_ON < '${cutoff}' LIMIT 100`,
    ));
  } catch (e) {
    throw storeError(e, REVIEW_TABLE);
  }
  if (dryRun) return { success: true, dry_run: true, would_purge: rows.map(r => r.REVIEW_KEY), cutoff };
  let purged = 0;
  for (const r of rows) {
    const items = await queryItems(ctx, r.REVIEW_KEY);
    for (const it of items) {
      try {
        await itemsTable(ctx).deleteItems({ keys: { REVIEW_KEY: NoSQLMarshall.makeString(r.REVIEW_KEY), ITEM_KEY: NoSQLMarshall.makeString(String(it.ITEM_KEY)) } });
      } catch { /* TTL has usually taken these already */ }
    }
    await ds(ctx).datastore().table(REVIEW_TABLE).deleteRow(String(r.ROWID));
    purged++;
  }
  return { success: true, purged, cutoff };
}

module.exports = {
  STATUSES, DEV_STATUSES, REVIEW_STATES, ReviewError, findingKey,
  listReviews, getReview, createReview, reply, submitReview,
  accept, claim, closeReview, reopenReview, pushToHacksaw, purge,
};
