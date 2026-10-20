/**
 * The sending half of Follow-ups: build the Cliq card, address it, and decide who is due today.
 *
 * Split from `followup-service.js` on purpose — that file is records, this one is delivery. The
 * scheduled job and the UI's "Remind now" button both land in `remindOne`, so the manual path and
 * the 09:00 path cannot drift apart (the same reason vm-scan-service has one `runScan`).
 *
 * ── Delivery: the OAuth connection, not a webhook ────────────────────────────────────────────
 *
 * The VM notifier posts to a Cliq *bot webhook URL* carrying its own zapikey. This module posts
 * through the stored `zoho-cliq` OAuth connection instead (2026-10-13 decision), because a
 * follow-up names its recipients per row — a channel here, two people there — and a webhook URL
 * is bound to one destination, so per-row addressing would mean pasting a new URL for every
 * combination and storing a fresh secret with each one.
 *
 * It needs no new scope: Cliq's whole v2 messaging surface — channel, buddy and bot posts alike —
 * is covered by `ZohoCliq.Webhooks.CREATE`, which `connections-registry.js` already requests for
 * `zoho-cliq`. Verified against the Cliq v2 Messages docs, 2026-10-13.
 *
 * ── Addressing (2026-10-20) ──────────────────────────────────────────────────────────────────
 *
 * A `user` target holds a Cliq **ZUID** and is posted to `/api/v2/buddies/{ZUID}/message`. There is
 * no email anywhere in this path any more — the previous design stored a Catalyst user_id and
 * resolved an address per send, which meant decrypting and holding one. Addressing by ZUID removed
 * that mechanism outright.
 *
 * ── Which credential sends ───────────────────────────────────────────────────────────────────
 *
 * `callConnection` resolves the caller's own connection first and falls back to the SHARED one.
 * The scheduled job has no `req.userId`, so it always lands on the shared credential — which is
 * the right identity for an unattended nag, and the same fall-through the VM job relies on. A
 * manual "Remind now" posts as whoever pushed the button, if they have connected Cliq themselves.
 */

'use strict';

const conn = require('./connections-service');
const store = require('./followup-service');

/**
 * ETAs are typed by a team in IST and compared against "today", so "today" has to be IST too.
 * Catalyst runs functions in UTC: a sweep at 09:00 IST is 03:30 UTC, same day — but an overdue
 * count taken in UTC would flip a day late for anything after 05:30 IST. 'en-CA' formats as
 * YYYY-MM-DD, which is the stored shape.
 */
const TZ = 'Asia/Kolkata';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });

/** The IST calendar day. All ETA arithmetic uses this, whatever the tick frequency. */
const today = (d = new Date()) => dayFmt.format(d);

/**
 * ── The dedupe bucket: how often a row may be reminded ───────────────────────────────────────
 *
 * Separate from how often the JOB runs, and that separation is the whole point. Raising the cron
 * from daily to every 30 minutes must not turn one nag into 48 — it only means the sweep notices a
 * newly-due row sooner. What caps the nagging is the bucket in `DEDUPE_KEY`: one reminder per row,
 * per trigger, per bucket.
 *
 * `day` is the only cadence this phase uses. The others exist so a later phase can nag hourly (an
 * incident follow-up, say) by setting a cadence rather than by touching this code — and because
 * `DEDUPE_KEY`'s format is frozen the moment the table is created, so the bucket token has to be
 * able to carry a time from the start.
 */
const CADENCES = {
  day:  d => dayFmt.format(d),                                       // 2026-10-13
  '6h': d => `${dayFmt.format(d)}T${String(Math.floor(Number(hourFmt.format(d)) / 6) * 6).padStart(2, '0')}`,
  hour: d => `${dayFmt.format(d)}T${hourFmt.format(d)}`,             // 2026-10-13T14
};

const DEFAULT_CADENCE = 'day';

/** The bucket token for `DEDUPE_KEY`. An unknown cadence falls back to the day. */
function bucketOf(cadence = DEFAULT_CADENCE, d = new Date()) {
  return (CADENCES[cadence] || CADENCES[DEFAULT_CADENCE])(d);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `fromDay` to `etaDay`, both 'YYYY-MM-DD'. Negative once the ETA has passed. */
function daysUntil(etaDay, fromDay) {
  const a = Date.parse(`${etaDay}T00:00:00Z`);
  const b = Date.parse(`${fromDay}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / MS_PER_DAY);
}

/* ------------------------------------------------------------------ the message */

const TRIGGER_LABELS = {
  manual: 'Follow-up',
  pre_eta: 'Due soon',
  overdue: 'Overdue',
};

/**
 * The card, built fresh at send time and never stored — the row holds every fact in it, so keeping
 * a rendered copy would only be a second thing to keep in step.
 */
function buildPayload(row, { trigger, days }) {
  const label = TRIGGER_LABELS[trigger] || TRIGGER_LABELS.manual;

  let when = 'No ETA set';
  if (row.eta && days !== null && days !== undefined) {
    if (days > 1) when = `Due in ${days} days — ${row.eta}`;
    else if (days === 1) when = `Due tomorrow — ${row.eta}`;
    else if (days === 0) when = `Due today — ${row.eta}`;
    else if (days === -1) when = `Overdue by 1 day — was due ${row.eta}`;
    else when = `Overdue by ${Math.abs(days)} days — was due ${row.eta}`;
  } else if (row.eta) {
    when = `ETA ${row.eta}`;
  }

  const lines = [`*${row.task}*`, when];
  if (row.dri) lines.push(`DRI: ${row.dri}`);
  lines.push(`Status: ${row.status.replace(/_/g, ' ')}`);
  if (row.ref_url) lines.push(`[Open the task / doc](${row.ref_url})`);
  if (row.evidence) lines.push('', `_${String(row.evidence).slice(0, 500)}_`);

  return {
    text: lines.join('\n'),
    bot: { name: 'WSM Follow-ups' },
    card: { title: `${label}: ${String(row.task).slice(0, 80)}`, theme: 'modern-inline' },
  };
}

/* ------------------------------------------------------------------ addressing */

/**
 * The Cliq v2 path for one target, given an already-resolved address.
 *
 * The value is URL-encoded, so a target cannot traverse out of its path segment and turn this into
 * a general-purpose proxy into Cliq.
 */
function pathFor(type, address) {
  const value = encodeURIComponent(String(address || ''));
  if (type === 'user') return `/api/v2/buddies/${value}/message`;
  return `/api/v2/channelsbyname/${value}/message`;
}

/**
 * What a target is called in the log and the UI.
 *
 * A `user` is logged as `user:<id>`, never as a name or an email (2026-10-13 decision): identity at
 * rest is the Catalyst user_id, and the history view resolves ids to names through
 * `GET /api/followups/members` at display time.
 */
const describe = t => (t.type === 'channel' ? `#${t.value}` : `user:${t.value}`);

/**
 * Post to every target, and report per target.
 *
 * One failure does not stop the rest: a renamed channel should not silence the two people who were
 * also on the list. The outcome is 'sent' when all landed, 'partial' when some did, 'failed' when
 * none did — and the per-target errors are joined into the log row so "which one broke" is answered
 * without opening the function logs.
 *
 * Both target types are addressed directly by their stored value: a channel by `unique_name`, a
 * person by ZUID. No lookup, no resolution step, nothing held in memory between posts.
 */
async function postAll(req, targets, payload) {
  const results = [];

  for (const target of targets) {
    const label = describe(target);
    try {
      const resp = await conn.callConnection(req, 'zoho-cliq', pathFor(target.type, target.value), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      const text = await resp.text();
      if (!resp.ok) {
        results.push({ target: label, ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 120)}` });
      } else {
        results.push({ target: label, ok: true, error: '' });
      }
    } catch (e) {
      results.push({ target: label, ok: false, error: String((e && e.message) || e).slice(0, 150) });
    }
  }

  const ok = results.filter(r => r.ok);
  const bad = results.filter(r => !r.ok);
  return {
    results,
    status: bad.length === 0 ? 'sent' : (ok.length ? 'partial' : 'failed'),
    error: bad.map(r => `${r.target}: ${r.error}`).join(' | '),
  };
}

/* ------------------------------------------------------------------ one row */

/**
 * Send one reminder and log it.
 *
 * `force` is the manual button: it skips the dedupe (a person pressing Remind now means it) and
 * ignores whether the row is paused, but still refuses a closed row and a row with nobody to
 * notify, because both of those are mistakes rather than intentions.
 */
async function remindOne(req, row, { trigger = 'manual', force = false, day = today(), bucket } = {}) {
  const key = bucket || bucketOf(row.cadence || DEFAULT_CADENCE);
  const targets = row.notify_targets || [];
  if (!targets.length) {
    return { id: row.id, status: 'skipped', error: 'No one is listed to notify on this follow-up.' };
  }
  if (store.CLOSED.has(row.status)) {
    return { id: row.id, status: 'skipped', error: `This follow-up is ${row.status}.` };
  }
  if (!force && !row.is_active) {
    return { id: row.id, status: 'skipped', error: 'Reminders are paused on this follow-up.' };
  }
  if (!force && await store.alreadySent(req, row.id, trigger, key)) {
    return { id: row.id, status: 'skipped', error: 'Already reminded in this window.' };
  }

  const days = row.eta ? daysUntil(row.eta, day) : null;
  const outcome = await postAll(req, targets, buildPayload(row, { trigger, days }));

  await store.recordReminder(req, row.id, {
    trigger,
    targets: targets.map(describe).join(', '),
    status: outcome.status,
    error: outcome.error,
    bucket: key,
    force,
  });

  return { id: row.id, status: outcome.status, error: outcome.error, targets: outcome.results };
}

/* ------------------------------------------------------------------ the sweep */

/**
 * Decide what a row is due for today, or null for nothing.
 *
 *   • `remind_before_days` N and the ETA is 0…N days away → one 'pre_eta' ping per bucket in that
 *     window. A window rather than a single day on purpose: a row created the day before its ETA,
 *     or a tick missed because the job pool was busy, still gets chased.
 *   • past the ETA, `overdue_every_days` N → an 'overdue' ping every Nth day (N=1 is daily).
 *
 * Either count at 0 switches that half off, which is how someone turns a row into a record they
 * only chase by hand. Note this is **day** arithmetic whatever the tick frequency — running the job
 * more often finds a due row sooner, it does not make a row due more often.
 */
function dueReason(row, day = today()) {
  if (!row.eta || !row.is_active || store.CLOSED.has(row.status)) return null;
  const delta = daysUntil(row.eta, day);
  if (delta === null) return null;

  if (delta >= 0) {
    const window = Number(row.remind_before_days || 0);
    return window > 0 && delta <= window ? { trigger: 'pre_eta', days: delta } : null;
  }

  const every = Number(row.overdue_every_days || 0);
  if (every <= 0) return null;
  const overdueBy = Math.abs(delta);
  return overdueBy % every === 0 ? { trigger: 'overdue', days: delta } : null;
}

/** How many rows one tick will post for. See the note in `sweep` on why a cap is safe. */
const DEFAULT_MAX_PER_TICK = 40;

/**
 * The daily pass. Reached through `runTask('followup_reminders')` in scheduled-tasks.js, and by
 * POST /api/followups/sweep.
 *
 * Sequential, not parallel: a run is a handful of Cliq posts and the shared access token is
 * refreshed on first use, so firing them at once would just race several refreshes of the same
 * credential for no wall-clock worth having.
 *
 * ── Why a per-tick cap needs no resume cursor ────────────────────────────────────────────────
 *
 * A tick that stops at `maxPerTick` leaves the rest unsent — and they are still due on the next
 * tick, while the ones already handled are skipped by their `DEDUPE_KEY`. Idempotence gives
 * resumption for free, so there is no cursor to store and nothing to reset. The cost is that the
 * remainder waits for the next tick, which is why the cap only earns its place once the cron runs
 * more often than daily: at 30-minute ticks the backlog drains within the hour.
 */
async function sweep(req, { day = today(), cadence = DEFAULT_CADENCE, dryRun = false, maxPerTick = DEFAULT_MAX_PER_TICK, deadlineAt } = {}) {
  const bucket = bucketOf(cadence);
  const rows = await store.listDueCandidates(req);
  const due = [];
  for (const row of rows) {
    const reason = dueReason(row, day);
    if (reason) due.push({ row, reason });
  }

  if (dryRun) {
    return {
      success: true, day, bucket, cadence, dry_run: true, considered: rows.length, due: due.length,
      runs: due.map(d => ({ id: d.row.id, task: d.row.task, trigger: d.reason.trigger, status: 'would_send' })),
    };
  }

  const runs = [];
  let deferred = 0;
  for (const { row, reason } of due) {
    const outOfBudget = (deadlineAt && Date.now() >= deadlineAt) || runs.length >= maxPerTick;
    if (outOfBudget) { deferred += 1; continue; }
    try {
      const result = await remindOne(req, row, { trigger: reason.trigger, day, bucket });
      runs.push({ id: row.id, task: row.task, trigger: reason.trigger, ...result });
    } catch (e) {
      runs.push({ id: row.id, task: row.task, trigger: reason.trigger, status: 'failed', error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  return {
    success: true, day, bucket, cadence, considered: rows.length, due: due.length,
    sent: runs.filter(r => r.status === 'sent').length,
    failed: runs.filter(r => r.status === 'failed' || r.status === 'partial').length,
    // Rows left for the next tick. Not an error: they are still due and still un-logged.
    deferred,
    runs,
  };
}

module.exports = {
  sweep, remindOne, dueReason, buildPayload, daysUntil,
  today, bucketOf, CADENCES, DEFAULT_CADENCE, DEFAULT_MAX_PER_TICK, TZ,
};
