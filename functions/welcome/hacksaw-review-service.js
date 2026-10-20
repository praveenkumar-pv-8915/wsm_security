/**
 * Hacksaw review state — the team's own verdicts on Hacksaw findings, and the review records
 * that group them.
 *
 * Hacksaw's write scopes are deliberately not granted (see connections-registry.js), so nothing
 * here changes anything in Hacksaw. A decision recorded here is the team's position on a finding;
 * whether Hacksaw itself agrees is reported as the `sync` state (below), which is what the v7
 * design's SYNCED / SYNC · PENDING chip means in an app that can only read.
 *
 * ── Storage: tool_config, no bespoke table ───────────────────────────────────────────────────
 *
 * Following vm-dependency-notifier-design.md's precedent, this reuses the generic `tool_config`
 * store rather than adding tables — which also avoids the console-only table creation that
 * datastore-conventions.md documents as unscriptable.
 *
 *   TOOL_KEY 'hacksaw_decisions'  — one row per finding. CONFIG_KEY is the stable finding key.
 *   TOOL_KEY 'hacksaw_reviews'    — one row per review record (product + WIP build + base build).
 *
 * One row per finding, not one row holding a map: per-row writes cannot clobber each other when
 * two reviewers work the same report, and the 10,000-char CONFIG_VALUE cap then applies per
 * finding instead of to the whole report.
 *
 * ── The stable finding key ───────────────────────────────────────────────────────────────────
 *
 * VIOLATION_AUTO_ID is per report: the same defect in tomorrow's build has a new id, so keying
 * decisions on it would throw the team's triage away on every build. The key is instead a hash of
 * product + rule + file + normalised snippet, deliberately EXCLUDING the line number, which
 * shifts when unrelated code moves. The cost is explicit: two identical findings in one file
 * share one decision. Components key on their purl, which is already version-scoped.
 */

const crypto = require('node:crypto');
const { setConfig, readConfig, listConfig } = require('./tool-config-service');

const DECISIONS = 'hacksaw_decisions';
const REVIEWS = 'hacksaw_reviews';

/** What a reviewer can say about a finding. Mirrors Hacksaw's own vocabulary where it overlaps. */
const DECISIONS_ALLOWED = ['Open', 'False positive', 'Permanently excluded', 'Temporarily excluded', 'Needs fix'];

/** A review record's lifecycle, from the v7 design: pending → approved | changes. */
const REVIEW_STATUSES = ['pending', 'approved', 'changes'];

class ReviewError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);

/** Whitespace-normalised so reformatting alone does not orphan a decision. */
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * The stable identity of a finding, independent of which report it was seen in.
 * `kind` is 'violation' or 'component'.
 */
function findingKey({ kind, product, rule, file, snippet, identifier }) {
  if (kind === 'component') return `c:${sha(`${product}|${norm(identifier)}`)}`;
  return `v:${sha(`${product}|${norm(rule)}|${norm(file)}|${norm(snippet)}`)}`;
}

/**
 * Does the team's decision match what Hacksaw currently records?
 *
 * `synced` means Hacksaw already reflects the verdict, so there is nothing to do. `pending` means
 * someone still has to make the change in Hacksaw itself — this app cannot, for want of write
 * scopes. That is the honest reading of the design's sync chip here.
 */
function syncState(decision, hacksawStatus) {
  if (!decision) return 'none';
  const hs = String(hacksawStatus || '').toUpperCase().replace(/\s+/g, '_');
  const mine = String(decision).toUpperCase().replace(/\s+/g, '_');
  if (mine === 'NEEDS_FIX') return hs === 'OPEN' ? 'synced' : 'pending';
  return hs === mine ? 'synced' : 'pending';
}

/* ------------------------------------------------------------------ decisions */

/** Every decision this team has recorded, keyed by finding key. */
async function listDecisions(req) {
  return { success: true, decisions: await listConfig(req, DECISIONS) };
}

/**
 * Record one verdict. The caller sends the finding's identity, never a key it invented, so the
 * key is always computed the same way here.
 */
async function setDecision(req, data = {}) {
  const { kind, product, rule, file, snippet, identifier, decision, note, report_label: label } = data;
  if (!product) throw new ReviewError("'product' is required");
  if (!DECISIONS_ALLOWED.includes(decision)) {
    throw new ReviewError(`'decision' must be one of ${DECISIONS_ALLOWED.join(', ')}`);
  }
  const key = findingKey({ kind, product, rule, file, snippet, identifier });
  const prior = await readConfig(req, DECISIONS, key);
  const value = {
    kind: kind === 'component' ? 'component' : 'violation',
    product,
    rule: rule || null,
    file: file || null,
    identifier: identifier || null,
    decision,
    note: typeof note === 'string' ? note.slice(0, 2000) : (prior?.note || null),
    // Catalyst user_id, never an email — datastore-conventions.md's no-PII identity rule.
    reviewer_id: String(req.userId),
    decided_on: new Date().toISOString().slice(0, 10),
    first_seen_label: prior?.first_seen_label || label || null,
    last_seen_label: label || prior?.last_seen_label || null,
  };
  await setConfig(req, DECISIONS, key, value);
  return { success: true, key, decision: value };
}

/** Same verdict across several findings — the design's bulk action on selected rows. */
async function setDecisionsBulk(req, data = {}) {
  const items = Array.isArray(data.findings) ? data.findings : [];
  if (!items.length) throw new ReviewError("'findings' must be a non-empty array");
  if (items.length > 100) throw new ReviewError('At most 100 findings at a time');
  const out = [];
  for (const f of items) {
    // Sequential on purpose: tool_config writes are read-modify-write per row, and a burst of
    // parallel writes to the same table is how rows get lost.
    out.push(await setDecision(req, { ...f, decision: data.decision, note: data.note }));
  }
  return { success: true, updated: out.length, keys: out.map(o => o.key) };
}

/**
 * Catalyst user_id → display name, read live and never stored.
 *
 * A review records who raised it and who reviewed it as `user_id`, per the no-PII identity rule
 * (datastore-conventions.md) — so the screen has an id and needs a name. The Follow-ups build
 * shipped exactly this bug once already: "a stored ZUID that no screen could resolve to a name"
 * (CLAUDE.md). Resolution is against Catalyst's own user list, not Cliq, because these are
 * Catalyst ids; a failure degrades to the id rather than failing the list.
 */
async function nameMap(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) return {};
  try {
    const users = await app.userManagement().getAllUsers();
    const out = {};
    for (const u of users || []) {
      const id = String(u.user_id || u.zuid || '');
      if (!id) continue;
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
        || String(u.email_id || '').split('@')[0];
      if (name) out[id] = name;
    }
    return out;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ review records */

/**
 * A review record: one product's WIP build weighed against a base build, with a status and an
 * assigned reviewer. This is the unit the v7 "Hacksaw Reviewer" screen lists.
 */
async function listReviews(req) {
  const [all, names] = await Promise.all([listConfig(req, REVIEWS), nameMap(req)]);
  const reviews = Object.entries(all)
    .map(([id, r]) => ({
      id,
      ...r,
      // Names are attached per response, never written to the store.
      raised_by_name: names[String(r.raised_by)] || null,
      reviewer_name: r.reviewer_id ? (names[String(r.reviewer_id)] || null) : null,
    }))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return {
    success: true,
    reviews,
    pending: reviews.filter(r => (r.status || 'pending') === 'pending').length,
  };
}

async function createReview(req, data = {}) {
  const { product, label, base_label: baseLabel, title } = data;
  if (!product || !label) throw new ReviewError("'product' and 'label' are required");
  const id = `HSR-${Date.now().toString(36).toUpperCase()}`;
  const value = {
    product,
    label,
    base_label: baseLabel || null,
    title: title || `${product} · ${label}`,
    status: 'pending',
    raised_by: String(req.userId),
    reviewer_id: null,
    created_at: new Date().toISOString(),
    decided_at: null,
    note: null,
  };
  await setConfig(req, REVIEWS, id, value);
  return { success: true, id, review: { id, ...value } };
}

/** Approve, request changes, reopen, or claim a review. */
async function updateReview(req, id, data = {}) {
  if (!id) throw new ReviewError("'id' is required");
  const prior = await readConfig(req, REVIEWS, id);
  if (!prior) throw new ReviewError('No such review', 404);

  const next = { ...prior };
  if (data.status !== undefined) {
    if (!REVIEW_STATUSES.includes(data.status)) {
      throw new ReviewError(`'status' must be one of ${REVIEW_STATUSES.join(', ')}`);
    }
    next.status = data.status;
    next.decided_at = data.status === 'pending' ? null : new Date().toISOString();
    // Deciding a review claims it: the person who approved it is the reviewer of record.
    if (data.status !== 'pending') next.reviewer_id = String(req.userId);
  }
  if (data.claim === true) next.reviewer_id = String(req.userId);
  if (typeof data.note === 'string') next.note = data.note.slice(0, 2000);

  await setConfig(req, REVIEWS, id, next);
  return { success: true, id, review: { id, ...next } };
}

module.exports = {
  DECISIONS_ALLOWED, REVIEW_STATUSES, ReviewError,
  findingKey, syncState,
  listDecisions, setDecision, setDecisionsBulk,
  listReviews, createReview, updateReview,
};
