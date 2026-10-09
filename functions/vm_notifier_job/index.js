/**
 * vm_notifier_job — the scheduled half of VM Manager > Dependency Upgrade Notifier.
 *
 * A Job Function, triggered every 6 hours by a Job Scheduling cron (see README.md in this folder
 * for the console steps). It does no work of its own: it builds the small context the services
 * expect and hands off to the same `runScan` the UI's "Run now" button calls, so the scheduled path
 * and the manual path cannot drift apart.
 *
 * ── Why a Job Function and not a Cron Function ───────────────────────────────────────────────
 *
 * Catalyst **Cron Functions reached EOL in April 2026**; Job Scheduling is the replacement (see
 * .claude/zoho-catalyst/references/deployment.md). Nothing new should be built on the old type.
 *
 * ── Why this, and not an HTTP call into `welcome` ────────────────────────────────────────────
 *
 * The design doc left "how does the cron authenticate" unresolved, and the answer turned out to be
 * "it doesn't have to". `welcome` is gated by `requireMember`, which needs a Catalyst *session* — a
 * scheduler has none. The alternatives were both worse than they look:
 *
 *   • A shared-secret header on an exempt route — Catalyst Security Rules are per FUNCTION, not per
 *     path, so exempting one route means setting the whole `welcome` function to `no_auth`. That
 *     would put every connection, risk and DMS route behind nothing but application code.
 *   • A webhook-triggered job — same problem, same exemption.
 *
 * A Job Function runs inside Catalyst with an admin-scoped `catalystApp` already in hand. No route,
 * no secret to store, no rule to loosen.
 *
 * ── Shared code ─────────────────────────────────────────────────────────────────────────────
 *
 * Catalyst packages each function directory on its own, so `require('../welcome/…')` would resolve
 * locally and then fail at runtime after deploy. `scripts/sync-job-modules.js` copies the modules
 * this job needs into ./shared/ and `npm run predeploy` refuses to deploy when they are stale, so
 * the duplication is mechanical and loud rather than manual and quiet. Never edit ./shared/ —
 * `functions/welcome/` is the original.
 */

'use strict';

const { runScan } = require('./shared/vm-scan-service');

/**
 * The services all read `req.catalystAdmin || req.catalystApp`, and nothing in the scan path reads
 * `req.userId` — which is what makes credential resolution fall through to the SHARED connection,
 * the only credential a run with no human behind it should use.
 */
function jobContext(catalystApp) {
  return {
    catalystAdmin: catalystApp,
    catalystApp,
    caller: { user_id: 'vm_notifier_job', role: 'admin' },
  };
}

module.exports = async (catalystApp, context, jobData) => {
  try {
    let depKeys = [];
    // A scheduled run passes no argument. A hand-submitted job may pass {"dependencies":["key"]}
    // to re-scan one dependency without waiting for the next tick.
    try {
      const raw = jobData && typeof jobData.getArgument === 'function' ? jobData.getArgument() : null;
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed && parsed.dependencies)) depKeys = parsed.dependencies.map(String);
      }
    } catch (e) {
      console.log('vm_notifier_job: ignoring unreadable job argument:', e.message);
    }

    const result = await runScan(jobContext(catalystApp), { depKeys, trigger: 'schedule' });
    console.log(
      `vm_notifier_job: checked ${result.checked}, ${result.new_versions} new version(s)`,
      JSON.stringify(result.runs.map(r => ({
        dep: r.dep_key,
        new: r.new_versions.length,
        delivery: r.delivery && r.delivery.status,
        skipped: r.skipped || undefined,
        error: r.error || undefined,
      })))
    );

    // A per-dependency failure is already recorded in that dependency's tool_state row and shown in
    // the UI, so the job itself still succeeded: failing it would make the whole run look dead when
    // one source was briefly unreachable, and Job Scheduling's retry would re-run the healthy ones.
    context.closeWithSuccess();
  } catch (error) {
    // Only a failure that stopped the run reaching any dependency lands here — a missing table, or
    // tool_config being unreadable.
    console.error('vm_notifier_job failed before scanning:', error && error.message, error && error.stack);
    context.closeWithFailure();
  }
};
