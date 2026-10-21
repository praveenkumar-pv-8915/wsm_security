/**
 * The scheduled-task registry — one place every recurring job in this app is declared, and one
 * runner that executes them.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────
 *
 * `vm_notifier_job` is a job function that does one thing, with its schedule baked into a console
 * cron and its "am I already running / when did I last run" concerns absent because, at 6-hourly,
 * nothing overlapped. The next few features all want the same thing — a thing that runs on a clock,
 * with a lease, a last-run stamp and a frequency somebody can raise later — so that machinery lives
 * here once instead of being copied per job.
 *
 * `functions/scheduler_job/` is the only job function needed from now on: it is a thin shell that
 * passes its argument to `runTask` below. **Adding a scheduled feature means adding a TASKS entry
 * and a console cron, not a new deploy target.**
 *
 * ── Frequency is console config, not code ───────────────────────────────────────────────────
 *
 * One Catalyst cron per task, each passing `{"task": "<key>"}`. Changing how often something runs
 * is editing that cron's expression — no deploy. Two knobs here guard the two things that actually
 * break when the frequency goes up:
 *
 *   `minIntervalMinutes`  A floor. Protects a task from a cron that fires faster than the task
 *                         wants — and makes the other pattern possible: ONE cron at high frequency
 *                         driving several tasks that each run at their own rate, which is where
 *                         this goes if per-task crons become tedious to manage.
 *   `leaseMs`             An overlap lease. At 6-hourly nothing overruns its own tick, which is why
 *                         `tool_state` deliberately has no LOCKED_UNTIL column. At 15-minute ticks
 *                         that assumption stops holding, so the lease lives in `STATE_VALUE` JSON —
 *                         no console column change, and it costs nothing while unused.
 *
 * Both are advisory, not distributed locks: Catalyst gives no atomic compare-and-set, so two ticks
 * landing in the same millisecond can both take the lease. That is tolerable here precisely because
 * every task below is idempotent on its own terms (the follow-up sweep by `DEDUPE_KEY`). The lease
 * stops the ordinary case — a slow tick still working when the next fires — not a race.
 *
 * ── State ───────────────────────────────────────────────────────────────────────────────────
 *
 * `tool_state` under TOOL_KEY `scheduler`, STATE_KEY = the task key. LAST_RUN_AT and LAST_ERROR are
 * its own columns; the lease and the last result summary go in STATE_VALUE.
 */

'use strict';

const state = require('./tool-state-service');

const TOOL_KEY = 'scheduler';

/** Run budget. Advanced I/O functions have an execution ceiling; stop short of it, cleanly. */
const DEFAULT_BUDGET_MS = 4 * 60 * 1000;

/**
 * Every recurring task in the app.
 *
 * `run(ctx, opts)` gets the same context shape the HTTP services use (`catalystAdmin`/`catalystApp`,
 * and `userId` only when a person triggered it) plus `{ dryRun, deadlineAt }`. It must be idempotent
 * within its own window — the runner offers no exactly-once guarantee and never will.
 */
const TASKS = {
  followup_reminders: {
    label: 'Follow-up reminders',
    summary: 'Chase follow-ups whose ETA is near or past, over Cliq.',
    // Daily today. The sweep is day-based arithmetic, so a faster cron finds a newly-due row sooner
    // without multiplying the reminders — the per-row DEDUPE_KEY bucket is what caps those.
    suggestedCron: '30 3 * * *  (UTC — 09:00 IST)',
    minIntervalMinutes: 0,
    leaseMs: 10 * 60 * 1000,
    run: (ctx, opts) => require('./followup-notify-service').sweep(ctx, opts),
  },

  vm_dependency_scan: {
    label: 'Dependency upgrade scan',
    summary: "Poll each watched dependency's release source and announce new versions on Cliq.",
    // Migrated off its own `vm_notifier_job` deploy target on 2026-10-13. The engine is unchanged —
    // this calls the same `runScan` the UI's "Run now" button calls, with the same trigger label, so
    // the only thing that moved is which function hosts the tick.
    suggestedCron: '0 */6 * * *',
    // A 6-hourly scan has no business running twice in an hour: the floor makes an over-eager cron
    // or a double submit a no-op rather than a second pass over every Connect feed.
    minIntervalMinutes: 60,
    leaseMs: 20 * 60 * 1000,
    run: (ctx, opts) => require('./vm-scan-service').runScan(ctx, {
      depKeys: opts.depKeys || [],
      trigger: opts.trigger || 'schedule',
    }),
  },

  hacksaw_review_purge: {
    label: 'Hacksaw review retention',
    summary: 'Delete review records closed more than two years ago (threads expire by NoSQL TTL at six months).',
    // Retention is anchored on the close date (decided 2026-10-20). Data Store has no TTL, so this
    // is the only thing that enforces the two-year window on the record itself.
    suggestedCron: '15 2 * * *  (UTC — 07:45 IST)',
    minIntervalMinutes: 60,
    leaseMs: 10 * 60 * 1000,
    run: (ctx, opts) => require('./hacksaw-review-service').purge(ctx, { dryRun: opts.dryRun === true }),
  },
};

const taskKeys = () => Object.keys(TASKS);

/**
 * Resolve a task key leniently: `HacksawReviewPurge`, `hacksaw-review-purge` and
 * `hacksaw_review_purge` all name the same task. Console cron parameters are typed by people, and
 * a PascalCase job name is the natural thing to type there; the registry key stays snake_case.
 */
const canonical = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
function resolveTaskKey(raw) {
  const wanted = canonical(raw);
  if (!wanted) return '';
  return taskKeys().find(k => canonical(k) === wanted) || String(raw || '').trim();
}

class UnknownTask extends Error {
  constructor(key) {
    super(`Unknown scheduled task '${key}'. Known: ${taskKeys().join(', ')}`);
    this.status = 400;
  }
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function readValue(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Run one task.
 *
 * Options:
 *   task      required, a key of TASKS
 *   dryRun    pass through to the task; takes no lease and stamps nothing
 *   force     ignore both the interval floor and a held lease (the "run it now" button)
 *   budgetMs  wall-clock allowance; the task gets it as an absolute `deadlineAt`
 *
 * Returns the task's own result, plus `task`, `skipped` and `ms`. A skip is a normal answer, not an
 * error: `{ success: true, skipped: 'interval' | 'locked' }`.
 */
async function runTask(ctx, { task, dryRun = false, force = false, budgetMs = DEFAULT_BUDGET_MS, ...rest } = {}) {
  const key = resolveTaskKey(task);
  const def = TASKS[key];
  if (!def) throw new UnknownTask(key);

  const started = Date.now();
  const deadlineAt = started + budgetMs;

  if (dryRun) {
    const result = await def.run(ctx, { ...rest, dryRun: true, deadlineAt });
    return { task: key, dry_run: true, ms: Date.now() - started, ...result };
  }

  // Reading state must never be what stops a task running — a missing tool_state table should not
  // silence reminders, it should just lose the guards.
  let prior = null;
  try {
    prior = await state.getState(ctx, TOOL_KEY, key);
  } catch (e) {
    console.log(`scheduler: ${key} — state unreadable, running without guards:`, e.message);
  }

  if (prior && !force) {
    const floorMs = Number(def.minIntervalMinutes || 0) * 60 * 1000;
    const since = prior.last_run_at ? started - Date.parse(prior.last_run_at) : Infinity;
    if (floorMs > 0 && since < floorMs) {
      return { success: true, task: key, skipped: 'interval', ms: Date.now() - started };
    }
    const lockedUntil = Number(readValue(prior.value).locked_until || 0);
    if (lockedUntil > started) {
      return { success: true, task: key, skipped: 'locked', locked_until: new Date(lockedUntil).toISOString(), ms: Date.now() - started };
    }
  }

  const lease = { locked_until: started + Number(def.leaseMs || 0) };
  const writeState = async patch => {
    try {
      await state.setState(ctx, TOOL_KEY, key, patch);
    } catch (e) {
      console.log(`scheduler: ${key} — state write failed:`, e.message);
    }
  };

  if (def.leaseMs) await writeState({ value: JSON.stringify(lease), ran: false });

  try {
    const result = await def.run(ctx, { ...rest, deadlineAt });
    await writeState({
      error: '',
      value: JSON.stringify({ locked_until: 0, last_result: summarise(result), at: nowIso() }),
    });
    return { task: key, ms: Date.now() - started, ...result };
  } catch (e) {
    const message = String((e && e.message) || e).slice(0, 255);
    await writeState({ error: message, value: JSON.stringify({ locked_until: 0, at: nowIso() }) });
    throw e;
  }
}

/** A few scalars worth seeing in the console without opening the function logs. */
function summarise(result) {
  if (!result || typeof result !== 'object') return {};
  const { considered, due, sent, failed, deferred } = result;
  return { considered, due, sent, failed, deferred };
}

/** What the UI lists on a "scheduled jobs" screen, with each task's last run. */
async function listTasks(ctx) {
  let all = {};
  try {
    all = await state.listState(ctx, TOOL_KEY);
  } catch (e) {
    console.log('scheduler: state unreadable:', e.message);
  }
  return taskKeys().map(key => {
    const s = all[key] || {};
    return {
      key,
      label: TASKS[key].label,
      summary: TASKS[key].summary,
      suggested_cron: TASKS[key].suggestedCron || '',
      min_interval_minutes: TASKS[key].minIntervalMinutes || 0,
      last_run_at: s.last_run_at || '',
      last_error: s.last_error || '',
      last_result: readValue(s.value).last_result || null,
    };
  });
}

module.exports = { TASKS, TOOL_KEY, runTask, listTasks, taskKeys, resolveTaskKey, UnknownTask, DEFAULT_BUDGET_MS };
