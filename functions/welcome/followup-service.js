/**
 * follow_ups — the Follow-ups module's store and CRUD.
 *
 * A row is one thing someone is chasing: a task, where its evidence lives, when it is due, who is
 * responsible, and who gets pinged on Cliq about it. The reminder *sending* lives next door in
 * `followup-notify-service.js`; this file is only records.
 *
 * ── Why a table and not `tool_config` ────────────────────────────────────────────────────────
 *
 * The VM notifier's design doc says a list of things should reuse `tool_config` rather than grow a
 * bespoke table, and that holds for *configuration*. These rows are not configuration: they are
 * records people file, re-status, attach evidence to and query by date (`WHERE ETA <= …` for the
 * daily sweep). A JSON blob per row cannot be queried that way, so the sweep would have to read and
 * parse every row on every tick. The ETA/STATUS query is what earns this table.
 *
 * ── Identity, per the 2026-08-27 no-PII rule ─────────────────────────────────────────────────
 *
 * `OWNER_ID` is the Catalyst `user_id` of whoever filed the row — never an email. `DRI` and the
 * notify targets are deliberately NOT user_ids: a Cliq handle is not a Catalyst user_id and no
 * mapping between them exists, so they are stored exactly as typed and used only as an address.
 * An email typed as a notify target is an *address for Cliq*, the same way a channel name is; it is
 * never read back as identity, joined on, or used for authorisation.
 *
 * ── Visibility ───────────────────────────────────────────────────────────────────────────────
 *
 * Team-wide, like the VM watch list: everyone sees and edits the same board. Deleting is the one
 * thing restricted — to the row's owner or an admin — because a delete takes the evidence with it.
 */

'use strict';

const TABLE = 'follow_ups';
const LOG_TABLE = 'follow_up_reminders';

const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];

/** Statuses the scheduled sweep stops chasing. */
const CLOSED = new Set(['done', 'cancelled']);

/**
 * What a notify target can be. Both are pickable from a live list and nothing else is accepted —
 * see `parseTargets`.
 *
 *   channel  a Cliq channel's `unique_name`
 *   user     a Cliq **ZUID** — an opaque numeric id, not personal data. Posting goes straight to
 *            `/api/v2/buddies/{ZUID}/message`, so no email exists in this path at all. It was
 *            briefly a Catalyst `user_id` with an email resolved per send; that directory listed
 *            only the five people who had signed into the app, so it was replaced on 2026-10-20.
 */
const TARGET_TYPES = ['channel', 'user'];

const EXPECTED_COLUMNS =
  'TASK [Var Char 255, Mandatory], REF_URL [Text], ETA [Var Char 10], DRI [Var Char 120], ' +
  'NOTIFY_TARGETS [Text], STATUS [Var Char 20, Mandatory], EVIDENCE [Text], ' +
  'REMIND_BEFORE_DAYS, OVERDUE_EVERY_DAYS, IS_ACTIVE, OWNER_ID, LAST_REMINDED_AT, LAST_REMINDER_ERROR';

const COLUMNS =
  'ROWID, TASK, REF_URL, ETA, DRI, NOTIFY_TARGETS, STATUS, EVIDENCE, REMIND_BEFORE_DAYS, ' +
  'OVERDUE_EVERY_DAYS, IS_ACTIVE, OWNER_ID, LAST_REMINDED_AT, LAST_REMINDER_ERROR, ' +
  'CREATEDTIME, MODIFIEDTIME';

const LOG_COLUMNS =
  'ROWID, FOLLOW_UP_ID, SENT_AT, TRIGGER_TYPE, TARGETS, DELIVERY_STATUS, DELIVERY_ERROR, ACTOR_ID';

/**
 * Column ceilings, matched to the schema.
 *
 * **Catalyst's `Var Char` maxes out at 255** — the console refuses anything larger. So the three
 * fields that wanted more are `Text` columns instead (REF_URL, TARGETS, and the two already-Text
 * blobs), and TASK is capped at 255 rather than made Text, because `Text` cannot be Mandatory and
 * "a follow-up must say what it is" is worth more than a longer title.
 */
const LIMITS = {
  TASK: 255,            // Var Char 255, Mandatory
  REF_URL: 2000,        // Text — a Projects/Writer URL can run well past 255
  DRI: 120,             // Var Char 120
  EVIDENCE: 9000,       // Text, under the 10,000 cap with headroom for JSON escaping
  NOTIFY_TARGETS: 9000, // Text
  DELIVERY_ERROR: 255,  // Var Char 255
  TARGETS: 2000,        // Text — 25 targets will not fit in 255
};

/* ------------------------------------------------------------------ plumbing */

function ds(req) {
  const app = req.catalystAdmin || req.catalystApp;
  if (!app) throw new Error('Catalyst authentication required');
  return { table: app.datastore().table(TABLE), log: app.datastore().table(LOG_TABLE), zcql: app.zcql() };
}

const unwrap = rows => (rows || []).map(r => r[TABLE] || r[LOG_TABLE] || r);

function esc(value) {
  return String(value === undefined || value === null ? '' : value).replace(/'/g, "''");
}

class BadRequest extends Error {
  constructor(message) { super(message); this.status = 400; }
}
class NotFound extends Error {
  constructor(message) { super(message || 'Not found'); this.status = 404; }
}
class Denied extends Error {
  constructor(message) { super(message); this.status = 403; }
}

/**
 * Same 424-with-the-column-list contract as tool-config-service and vm-notifications-service: a
 * fixed query over a fixed schema can only fail because the table isn't there, so say which table
 * and which columns instead of letting index.js mask it as "Internal error".
 */
function storeError(e) {
  if (e && e.status && e.status < 500) return e;
  const err = new Error(
    `DataStore rejected a "${TABLE}" operation — check the table exists with the expected columns ` +
    `(${EXPECTED_COLUMNS}), alongside "${LOG_TABLE}" (${LOG_COLUMNS}). ` +
    `Original error: ${String((e && e.message) || e || 'unknown error')}`
  );
  err.status = 424;
  return err;
}

async function guard(fn) {
  try { return await fn(); } catch (e) { throw storeError(e); }
}

/* ------------------------------------------------------------------ validation */

const clip = (value, limit) => String(value == null ? '' : value).slice(0, limit);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function nonEmpty(value, field, limit) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw new BadRequest(`${field} is required`);
  if (s.length > limit) throw new BadRequest(`${field} is too long (max ${limit} characters)`);
  return s;
}

function oneOf(value, allowed, field) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  const match = allowed.find(a => a === s);
  if (!match) throw new BadRequest(`${field} must be one of: ${allowed.join(', ')}`);
  return match;
}

/** Day precision, stored as 'YYYY-MM-DD' text — the app-wide date convention. */
function isoDate(value, field) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequest(`${field} must be YYYY-MM-DD`);
  if (Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new BadRequest(`${field} is not a real date`);
  return s;
}

/**
 * Only http(s). A `javascript:` or `data:` link would be rendered as an anchor in the table and in
 * the Cliq card, so the scheme is checked here rather than trusted to the browser.
 */
function httpUrl(value, field) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (s.length > LIMITS.REF_URL) throw new BadRequest(`${field} is too long (max ${LIMITS.REF_URL} characters)`);
  let parsed;
  try { parsed = new URL(s); } catch { throw new BadRequest(`${field} must be a full URL, starting http:// or https://`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequest(`${field} must be an http or https link`);
  }
  return s;
}

function wholeNumber(value, field, max) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return 0;
  if (!/^\d{1,3}$/.test(s)) throw new BadRequest(`${field} must be a whole number of days`);
  const n = Number(s);
  if (n > max) throw new BadRequest(`${field} must be ${max} or fewer days`);
  return n;
}

/**
 * Parse the notify field into targets.
 *
 * Accepts the two shapes the form can produce, and nothing else:
 *
 *   { type: 'channel', value: 'wsm-security' }     a picked channel
 *   { type: 'user',    value: '4071000000019021' } a picked person (Catalyst user_id)
 *
 * and their text spellings, `#wsm-security` and `user:4071000000019021`, so a hand-written API call
 * stays possible for scripting.
 *
 * ── What is deliberately NOT accepted ───────────────────────────────────────────────────────
 *
 * **A raw email.** The earlier design had a `buddy` target holding a typed address; a stored email
 * is stored PII however it is labelled, and the Catalyst directory can supply it at send time
 * instead (2026-10-13 decision). A typed email is rejected with a message pointing at the picker
 * rather than silently coerced, because silently storing it is exactly the thing being avoided.
 *
 * **A bot.** Cliq has no bot-listing endpoint within the scopes this app holds, so a bot target
 * could not be offered from a list — and the form is picker-only, so it is not offered at all.
 *
 * Existence is NOT checked here — that is `directory.validateTargets`, which needs the network.
 * This function is pure, so it stays cheap and testable.
 */
function parseTargets(raw) {
  if (raw === undefined || raw === null) return [];
  const entries = Array.isArray(raw) ? raw : String(raw).split(/[\n,;]+/);

  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    let type = '';
    let value = '';

    if (entry && typeof entry === 'object') {
      type = oneOf(entry.type, TARGET_TYPES, 'notify target type');
      value = String(entry.value || '').trim();
    } else {
      const sRaw = String(entry || '').trim();
      if (!sRaw) continue;
      if (/^user:/i.test(sRaw)) { type = 'user'; value = sRaw.slice(5).trim(); }
      else if (sRaw.startsWith('#')) { type = 'channel'; value = sRaw.slice(1).trim(); }
      else if (sRaw.includes('@')) {
        throw new BadRequest(
          `Notify by picking the person, not by typing "${sRaw}" — email addresses are never stored. ` +
          'Their Cliq address is looked up when the reminder is sent.'
        );
      } else { type = 'channel'; value = sRaw.trim(); }
    }

    if (!value) continue;
    if (value.length > 120) throw new BadRequest(`Notify target "${value.slice(0, 40)}…" is too long`);

    // The value goes into a URL path segment, so a slash or whitespace means it was mistyped. A
    // colon is rejected too: without it, a dropped target type like `bot:vm-watcher` would fall
    // through the bare-word branch and be stored as a CHANNEL literally named "bot:vm-watcher",
    // which saves cleanly and then fails at send time. Fail at parse instead.
    if (/[\s/\\?#:]/.test(value)) {
      throw new BadRequest(`"${value}" is not a valid Cliq channel name or user id`);
    }
    if (type === 'user' && !/^\d+$/.test(value)) {
      throw new BadRequest(`"${value}" is not a Cliq user id — pick the person from the list`);
    }

    const key = `${type}::${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, value });
    if (out.length > 25) throw new BadRequest('A follow-up can notify at most 25 targets');
  }
  return out;
}

function readTargets(stored) {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ shaping */

function toDto(row) {
  return {
    id: String(row.ROWID),
    task: row.TASK || '',
    ref_url: row.REF_URL || '',
    eta: row.ETA || '',
    dri: row.DRI || '',
    notify_targets: readTargets(row.NOTIFY_TARGETS),
    status: row.STATUS || 'open',
    evidence: row.EVIDENCE || '',
    remind_before_days: Number(row.REMIND_BEFORE_DAYS || 0),
    overdue_every_days: Number(row.OVERDUE_EVERY_DAYS || 0),
    is_active: row.IS_ACTIVE !== 'false',
    owner_id: row.OWNER_ID || '',
    last_reminded_at: row.LAST_REMINDED_AT || '',
    last_reminder_error: row.LAST_REMINDER_ERROR || '',
    created_time: row.CREATEDTIME || '',
    modified_time: row.MODIFIEDTIME || '',
  };
}

function logToDto(row) {
  return {
    id: String(row.ROWID),
    follow_up_id: row.FOLLOW_UP_ID || '',
    sent_at: row.SENT_AT || '',
    trigger: row.TRIGGER_TYPE || '',
    targets: row.TARGETS || '',
    status: row.DELIVERY_STATUS || '',
    error: row.DELIVERY_ERROR || '',
    actor_id: row.ACTOR_ID || '',
  };
}

/**
 * Build the column values for a create or a patch.
 * `partial` leaves out anything the body didn't mention, so a PATCH that only flips STATUS does not
 * have to round-trip the evidence text it isn't touching.
 */
function buildValues(body, { partial }) {
  const b = body || {};
  const values = {};

  if (!partial || b.task !== undefined) values.TASK = nonEmpty(b.task, 'Task', LIMITS.TASK);
  if (!partial || b.ref_url !== undefined) values.REF_URL = httpUrl(b.ref_url, 'Link');
  if (!partial || b.eta !== undefined) values.ETA = isoDate(b.eta, 'ETA');
  if (!partial || b.dri !== undefined) values.DRI = clip(String(b.dri || '').trim(), LIMITS.DRI);
  if (!partial || b.evidence !== undefined) values.EVIDENCE = clip(b.evidence, LIMITS.EVIDENCE);

  if (!partial || b.status !== undefined) {
    values.STATUS = b.status === undefined ? 'open' : oneOf(b.status, STATUSES, 'Status');
  }

  if (!partial || b.notify_targets !== undefined) {
    const targets = parseTargets(b.notify_targets);
    values.NOTIFY_TARGETS = clip(JSON.stringify(targets), LIMITS.NOTIFY_TARGETS);
  }

  if (!partial || b.remind_before_days !== undefined) {
    values.REMIND_BEFORE_DAYS = String(
      b.remind_before_days === undefined ? 2 : wholeNumber(b.remind_before_days, 'Remind before', 90)
    );
  }
  if (!partial || b.overdue_every_days !== undefined) {
    values.OVERDUE_EVERY_DAYS = String(
      b.overdue_every_days === undefined ? 1 : wholeNumber(b.overdue_every_days, 'Overdue every', 90)
    );
  }
  if (!partial || b.is_active !== undefined) {
    values.IS_ACTIVE = String(!(b.is_active === false || b.is_active === 'false'));
  }

  return values;
}

/* ------------------------------------------------------------------ reads */

async function getRow(req, id) {
  if (!/^\d+$/.test(String(id))) throw new BadRequest('Invalid follow-up id');
  const { zcql } = ds(req);
  const rows = unwrap(await guard(() => zcql.executeZCQLQuery(
    `SELECT ${COLUMNS} FROM ${TABLE} WHERE ROWID = ${id}`
  )));
  if (!rows.length) throw new NotFound('No such follow-up');
  return rows[0];
}

/**
 * The board. `scope`:
 *   open   (default) — everything not done or cancelled
 *   mine             — open rows this caller filed
 *   closed           — done and cancelled
 *   all              — everything
 *
 * Ordered by ETA ascending with undated rows last, because the whole point of the screen is what
 * is due next. ZCQL sorts the empty string before any date, so undated rows are moved in code.
 */
async function listFollowUps(req, { scope = 'open' } = {}) {
  const { zcql } = ds(req);
  let where = '';
  if (scope === 'closed') where = `WHERE STATUS IN ('done', 'cancelled')`;
  else if (scope === 'mine') where = `WHERE STATUS NOT IN ('done', 'cancelled') AND OWNER_ID = '${esc(req.userId)}'`;
  else if (scope !== 'all') where = `WHERE STATUS NOT IN ('done', 'cancelled')`;

  const rows = unwrap(await guard(() => zcql.executeZCQLQuery(
    `SELECT ${COLUMNS} FROM ${TABLE} ${where} ORDER BY ETA ASC LIMIT 300`
  ))).map(toDto);

  const dated = rows.filter(r => r.eta);
  const undated = rows.filter(r => !r.eta);
  return [...dated, ...undated];
}

/** The reminder log for one row — what was sent, when, and whether it landed. */
async function listReminders(req, id) {
  if (!/^\d+$/.test(String(id))) throw new BadRequest('Invalid follow-up id');
  const { zcql } = ds(req);
  const rows = unwrap(await guard(() => zcql.executeZCQLQuery(
    `SELECT ${LOG_COLUMNS} FROM ${LOG_TABLE} WHERE FOLLOW_UP_ID = '${esc(id)}' ORDER BY ROWID DESC LIMIT 50`
  )));
  return rows.map(logToDto);
}

/**
 * Rows the scheduled sweep should consider: active, still open, with an ETA.
 * Whether each one is actually *due* today is decided in followup-notify-service — this is only the
 * narrowing that keeps the sweep from reading the whole table.
 */
async function listDueCandidates(req) {
  const { zcql } = ds(req);
  const rows = unwrap(await guard(() => zcql.executeZCQLQuery(
    `SELECT ${COLUMNS} FROM ${TABLE} ` +
    `WHERE STATUS NOT IN ('done', 'cancelled') AND IS_ACTIVE != 'false' AND ETA != '' ` +
    `ORDER BY ETA ASC LIMIT 300`
  )));
  return rows.map(toDto);
}

/* ------------------------------------------------------------------ writes */

/**
 * Refuse a save whose targets do not exist, so an unreachable row cannot be filed in the first
 * place.
 *
 * The form is picker-only, so the ordinary cause of a miss is not a typo: it is a channel the
 * shared Cliq account has since left, or a person removed from the app. Both deserve a 400 that
 * names them rather than a row that looks fine and goes nowhere every morning.
 *
 * Required lazily — directory-service reaches Cliq, and nothing else in this file touches the
 * network; keeping the require here means a pure parse/CRUD path stays pure.
 */
async function assertTargetsExist(req, values) {
  if (values.NOTIFY_TARGETS === undefined) return;
  const targets = readTargets(values.NOTIFY_TARGETS);
  if (!targets.length) return;

  const directory = require('./directory-service');
  const { unknown } = await directory.validateTargets(req, targets);
  if (unknown.length) {
    // Only channels are validated — see validateTargets for why a ZUID cannot be, so this message
    // never has to hedge between two causes.
    const named = unknown.map(t => `#${t.value}`).join(', ');
    throw new BadRequest(
      `Can't notify ${named} — the shared Zoho Cliq connection has not joined that channel, so a ` +
      'reminder could not reach it. Add the shared account to the channel, or pick another.'
    );
  }
}

async function createFollowUp(req, body) {
  const values = buildValues(body, { partial: false });
  await assertTargetsExist(req, values);
  values.OWNER_ID = String(req.userId || (req.caller && req.caller.user_id) || '');
  values.LAST_REMINDED_AT = '';
  values.LAST_REMINDER_ERROR = '';

  const { table } = ds(req);
  const row = await guard(() => table.insertRow(values));
  return toDto({ ...values, ROWID: row.ROWID, CREATEDTIME: row.CREATEDTIME });
}

async function updateFollowUp(req, id, body) {
  const existing = await getRow(req, id);
  const values = buildValues(body, { partial: true });
  if (!Object.keys(values).length) return toDto(existing);
  await assertTargetsExist(req, values);

  const { table } = ds(req);
  await guard(() => table.updateRow({ ROWID: String(id), ...values }));
  return toDto({ ...existing, ...values });
}

/**
 * Delete is owner-or-admin, unlike every other write here.
 *
 * Editing a shared board is the point; removing a row takes its evidence and its reminder history
 * with it, and there is no undo, so that one stays with whoever filed it.
 */
async function deleteFollowUp(req, id) {
  const existing = await getRow(req, id);
  const caller = String(req.userId || (req.caller && req.caller.user_id) || '');
  const isAdmin = req.caller && req.caller.role === 'admin';
  if (!isAdmin && existing.OWNER_ID && String(existing.OWNER_ID) !== caller) {
    throw new Denied('Only the person who filed this follow-up (or an admin) can delete it');
  }

  const { table, zcql, log } = ds(req);
  // Clear the reminder log first: an orphaned log row would keep a dedupe key alive for an id that
  // DataStore can hand to a future row.
  const logRows = unwrap(await guard(() => zcql.executeZCQLQuery(
    `SELECT ROWID FROM ${LOG_TABLE} WHERE FOLLOW_UP_ID = '${esc(id)}' LIMIT 300`
  )));
  for (const r of logRows) {
    await log.deleteRow(String(r.ROWID)).catch(e => console.log('follow-up log delete failed:', e.message));
  }
  await guard(() => table.deleteRow(String(id)));
  return { id: String(id), deleted: true };
}

/**
 * Append one delivery attempt and stamp the parent row.
 *
 * `DEDUPE_KEY` (`<id>::<trigger>::<bucket>`) is Mandatory + Unique, which is what stops a re-run of
 * the sweep — a retry, a hand-submitted job, two ticks after a deploy — from nagging the same
 * channel twice in the same window. The bucket is a day today (`2026-10-13`) and can be a finer
 * slice later (`2026-10-13T14`) without a schema change; see CADENCES in
 * followup-notify-service.js for why the bucket, not the cron, is what caps the nagging. The caller checks first (`alreadySent`), so the
 * constraint is the backstop, not the normal path. A manual "Remind now" passes `force`, which
 * salts the key with the time so a person pushing the button deliberately is never deduped away.
 */
async function recordReminder(req, id, { trigger, targets, status, error, bucket, force }) {
  const { log, table } = ds(req);
  const sentAt = nowIso();
  const key = force
    ? `${id}::${trigger}::${sentAt}`
    : `${id}::${trigger}::${bucket || sentAt.slice(0, 10)}`;

  await guard(() => log.insertRow({
    FOLLOW_UP_ID: String(id),
    SENT_AT: sentAt,
    TRIGGER_TYPE: clip(trigger, 20),
    TARGETS: clip(targets, LIMITS.TARGETS),
    DELIVERY_STATUS: clip(status, 20),
    DELIVERY_ERROR: clip(error || '', LIMITS.DELIVERY_ERROR),
    ACTOR_ID: String(req.userId || (req.caller && req.caller.user_id) || ''),
    DEDUPE_KEY: clip(key, 120),
  }));

  await table.updateRow({
    ROWID: String(id),
    LAST_REMINDED_AT: sentAt,
    LAST_REMINDER_ERROR: clip(error || '', LIMITS.DELIVERY_ERROR),
  }).catch(e => console.log('follow-up stamp failed:', e.message));

  return { sent_at: sentAt };
}

/** Has this row already had this kind of reminder in this bucket? The sweep's idempotence check. */
async function alreadySent(req, id, trigger, bucket) {
  const { zcql } = ds(req);
  const rows = unwrap(await guard(() => zcql.executeZCQLQuery(
    `SELECT ROWID FROM ${LOG_TABLE} WHERE DEDUPE_KEY = '${esc(`${id}::${trigger}::${bucket}`)}' LIMIT 1`
  )));
  return rows.length > 0;
}

module.exports = {
  TABLE, LOG_TABLE, STATUSES, TARGET_TYPES, CLOSED, EXPECTED_COLUMNS,
  parseTargets, readTargets, toDto,
  listFollowUps, listReminders, listDueCandidates, getRow,
  createFollowUp, updateFollowUp, deleteFollowUp,
  recordReminder, alreadySent,
  BadRequest, NotFound, Denied,
};
