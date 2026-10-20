/**
 * scheduler_job — the one job function this app needs.
 *
 * A Job Function, triggered by Catalyst Job Scheduling. It owns no logic: it works out which task
 * to run and hands off to `runTask` in `shared/scheduled-tasks.js`, so the scheduled path and the
 * UI's "run now" button execute the same code.
 *
 * ── Adding a scheduled feature ──────────────────────────────────────────────────────────────
 *
 *   1. add an entry to TASKS in functions/welcome/scheduled-tasks.js
 *   2. add its modules to the scheduler_job list in scripts/sync-job-modules.js, then npm run sync:job
 *   3. create a console cron targeting THIS function with a `task` parameter
 *
 * No new deploy target, no new job function, no code here.
 *
 * ── The contract, CONFIRMED from a live run (2026-10-15) ────────────────────────────────────
 *
 *     module.exports = async (jobRequest, context)      // argc=2, jobRequest first
 *     jobRequest.getAllJobParams()  →  { task: '…', dry_run: '…' }
 *     the Catalyst app comes from catalyst.initialize(…), NOT from an argument
 *
 * Console Query Parameters arrive as **strings**, so `dry_run` is `'true'`, never `true`.
 *
 * That is settled now, but the defensive code below stays. The Catalyst docs contradict each other
 * on this — the tutorial shows `(jobRequest, context)` while the older `vm_notifier_job` in this
 * repo was written against `(catalystApp, context, jobData)` — and two rounds of guessing cost two
 * failed runs on 2026-10-15 (`app.datastore is not a function`, and a tick that ran every task
 * because no parameter was found). The cost of keeping it is a few lines and one log line per tick;
 * the cost of removing it is rediscovering this from a silent 09:00 failure after an SDK upgrade.
 *
 * The `SHAPE` log line is what turned a guess into an answer. It stays for the same reason.
 */

'use strict';

const catalyst = require('zcatalyst-sdk-node');
const { runTask, taskKeys } = require('./shared/scheduled-tasks');

/**
 * Describe what the platform actually handed us, without printing any values.
 *
 * The docs disagree about this function's signature and never name the accessor that reads job
 * parameters, and two rounds of guessing cost two failed runs. So the contract gets established
 * from a real tick: names only — own keys and prototype methods — never values, because a job
 * argument can carry anything and these logs are not a safe place for it.
 *
 * Kept permanently. It is a handful of strings once per tick, and the next person to wonder which
 * shape Catalyst uses gets the answer from any run instead of from another deploy.
 */
function describeArgs(args) {
  return args.map((a, i) => {
    if (a === null || a === undefined) return `${i}:${a}`;
    const type = typeof a;
    if (type !== 'object' && type !== 'function') return `${i}:${type}`;
    const own = Object.keys(a).slice(0, 25);
    let proto = [];
    try {
      proto = Object.getOwnPropertyNames(Object.getPrototypeOf(a) || {})
        .filter(n => n !== 'constructor').slice(0, 25);
    } catch { /* exotic object */ }
    const ctor = (a.constructor && a.constructor.name) || '?';
    return `${i}:${ctor}{own:[${own.join('|')}] proto:[${proto.join('|')}]}`;
  }).join('  ');
}

/** A Catalyst app object is the one with the datastore/zcql methods on it. */
const looksLikeApp = o => !!o && typeof o.datastore === 'function' && typeof o.zcql === 'function';

/** A context is the one that can end the run. */
const looksLikeContext = o => !!o && (typeof o.closeWithSuccess === 'function' || typeof o.close === 'function');

/**
 * Pull `{ task, tasks, dry_run }` out of whatever the platform handed us.
 *
 * Checked in order of how specific the signal is: an explicit JSON argument, then the console's
 * key-value parameters, then plain properties. `shape` names what actually worked, for the log.
 */
function readParams(args) {
  const out = { task: '', tasks: [], dryRun: false, shape: 'none' };

  const absorb = (obj, shape) => {
    if (!obj || typeof obj !== 'object' || out.shape !== 'none') return;
    const task = obj.task || obj.TASK;
    const tasks = obj.tasks || obj.TASKS;
    const dry = obj.dry_run !== undefined ? obj.dry_run : obj.dryRun;
    if (task === undefined && tasks === undefined && dry === undefined) return;
    if (task) out.task = String(task);
    if (Array.isArray(tasks)) out.tasks = tasks.map(String);
    else if (typeof tasks === 'string') out.tasks = tasks.split(',').map(s => s.trim()).filter(Boolean);
    out.dryRun = dry === true || dry === 'true';
    out.shape = shape;
  };

  const parse = (raw) => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(String(raw)); } catch { return null; }
  };

  for (const candidate of args) {
    if (!candidate || typeof candidate !== 'object') continue;

    // 1. a JSON argument blob
    if (typeof candidate.getArgument === 'function') {
      try { absorb(parse(candidate.getArgument()), 'getArgument'); } catch { /* keep looking */ }
    }
    // 2. the console's key-value parameters, under either spelling
    for (const fn of ['getAllJobParams', 'getAllParams', 'getJobParams', 'getParams']) {
      if (typeof candidate[fn] === 'function') {
        try { absorb(parse(candidate[fn]()), fn); } catch { /* keep looking */ }
      }
    }
    // 3. a single named parameter
    if (typeof candidate.getJobParam === 'function' && out.shape === 'none') {
      try {
        const task = candidate.getJobParam('task');
        if (task) { out.task = String(task); out.shape = 'getJobParam'; }
      } catch { /* keep looking */ }
    }
    // 4. plain properties on the request object
    absorb(candidate.job_params || candidate.params || candidate, 'property');
  }

  return out;
}

/**
 * The services read `req.catalystAdmin || req.catalystApp`, and no task reads `req.userId` — which
 * is what makes credential resolution fall through to the SHARED connection, the only credential an
 * unattended run should use.
 */
const jobContext = app => ({
  catalystAdmin: app,
  catalystApp: app,
  caller: { user_id: 'scheduler_job', role: 'admin' },
});

module.exports = async (...args) => {
  const context = args.find(looksLikeContext);
  const done = (ok) => {
    if (!context) return;
    if (ok && typeof context.closeWithSuccess === 'function') context.closeWithSuccess();
    else if (!ok && typeof context.closeWithFailure === 'function') context.closeWithFailure();
  };

  // First line of every run: the argument surface. See describeArgs.
  console.log('scheduler_job: SHAPE', describeArgs(args));

  try {
    // Prefer an app the platform handed us; otherwise initialize. `catalyst.initialize` is tried
    // against each argument in turn rather than only the context, because which object it wants is
    // exactly what the docs do not settle — and a wrong guess here is what produced
    // "app.datastore is not a function" on 2026-10-15.
    let app = args.find(looksLikeApp);
    if (!app) {
      for (const candidate of [context, ...args]) {
        if (!candidate) continue;
        try {
          const made = catalyst.initialize(candidate);
          if (looksLikeApp(made)) { app = made; break; }
        } catch { /* try the next candidate */ }
      }
    }
    if (!app) {
      try {
        const made = catalyst.initialize();
        if (looksLikeApp(made)) app = made;
      } catch { /* out of options */ }
    }
    if (!app) {
      throw new Error(
        'scheduler_job: no usable Catalyst app from any argument. Argument surface: ' +
        describeArgs(args)
      );
    }

    const params = readParams(args);
    const requested = params.tasks.length ? params.tasks : (params.task ? [params.task] : taskKeys());

    // Logged on every run, deliberately: this is how the handler contract gets confirmed from a
    // real tick rather than from the docs. `shape: none` means no parameter reached us and every
    // task ran — correct behaviour, but not what a per-task cron intended.
    console.log('scheduler_job: argc=%d shape=%s tasks=%s dry_run=%s',
      args.length, params.shape, requested.join(','), params.dryRun);

    const ctx = jobContext(app);
    // Split the budget so one slow task cannot eat the whole tick when several share a cron.
    const budgetMs = Math.floor((4 * 60 * 1000) / Math.max(requested.length, 1));

    let failed = 0;
    for (const task of requested) {
      try {
        const result = await runTask(ctx, { task, dryRun: params.dryRun, budgetMs });
        console.log(`scheduler_job: ${task} —`, JSON.stringify({
          skipped: result.skipped || undefined,
          considered: result.considered,
          due: result.due,
          sent: result.sent,
          failed: result.failed,
          deferred: result.deferred || undefined,
          ms: result.ms,
        }));
      } catch (e) {
        failed += 1;
        console.error(`scheduler_job: ${task} failed:`, e);
      }
    }

    // One task failing must not mark the tick a failure for the others — but a tick where
    // everything failed should show red in the console, not green.
    done(!(failed && failed === requested.length));
  } catch (e) {
    console.error('scheduler_job failed:', e);
    done(false);
  }
};
