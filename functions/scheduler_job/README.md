# `scheduler_job`

The one job function this app needs. It runs **any** task in the registry
(`functions/welcome/scheduled-tasks.js`) and owns no logic of its own.

## Adding a scheduled feature

1. Add an entry to `TASKS` in `functions/welcome/scheduled-tasks.js`.
2. Add its modules to the `scheduler_job` list in `scripts/sync-job-modules.js`, then
   `npm run sync:job`.
3. Create a console cron targeting this function with `{"task": "<key>"}`.

No new deploy target. No new job function. Nothing changes in this directory.

## Job argument

| Argument | Runs |
|---|---|
| `{"task": "followup_reminders"}` | one task — the normal case, one cron per task |
| `{"task": "followup_reminders", "dry_run": true}` | reports what would happen, sends nothing |
| `{"tasks": ["a", "b"]}` | several in one tick, in order, budget split between them |
| `{}` (empty) | every registered task — only sensible if one cron drives them all |

## Registered tasks

| Key | Does | Suggested cron | Interval floor |
|---|---|---|---|
| `followup_reminders` | Chases follow-ups whose ETA is near or past, over Cliq | `30 3 * * *` UTC = 09:00 IST | none |
| `vm_dependency_scan` | Polls each watched dependency's release source, announces new versions | `0 */6 * * *` | 60 min |

### `vm_notifier_job` was folded in here (2026-10-13)

Its deploy target is gone from `catalyst.json` and `npm run deploy:vm-job` with it. The scan engine
is untouched — `vm_dependency_scan` calls the same `runScan` the UI's "Run now" calls.

**Console step this needs:** retarget the existing 6-hourly VM cron from `vm_notifier_job` to
`scheduler_job`, with argument `{"task": "vm_dependency_scan"}`. Until that is done the old cron
fires a function that is no longer deployed. `functions/vm_notifier_job/` can be deleted from the
repo once the cron is moved.

## Raising the frequency later

Edit the cron expression in the console. **Nothing in this repo changes.** Three things make that
safe, and each is documented where it lives:

- **Idempotence per window.** `follow_up_reminders.DEDUPE_KEY` is `<id>::<trigger>::<bucket>`,
  mandatory and unique. A faster cron re-finds the same rows and skips them.
- **The bucket, not the cron, caps the nagging.** `CADENCES` in `followup-notify-service.js`. The
  bucket is a calendar day today; `6h` and `hour` exist so a later phase can nag faster by setting a
  cadence rather than editing code. Going from daily to every 30 minutes does **not** multiply
  reminders — it only means a newly-due row is noticed sooner. ETA arithmetic stays day-based.
- **An overlap lease and an interval floor.** `runTask` in `scheduled-tasks.js`. The lease stops a
  slow tick from being joined by the next one; `minIntervalMinutes` is a per-task floor, which also
  allows the other pattern — one high-frequency cron driving several tasks at their own rates.

Two caveats worth knowing before you turn the dial:

- **The lease is advisory.** Catalyst offers no atomic compare-and-set, so two ticks in the same
  millisecond can both take it. That is tolerable only because every task is idempotent on its own
  terms — keep it that way when you add one.
- **A tick is capped at 40 rows** (`DEFAULT_MAX_PER_TICK`) inside a ~4-minute budget. The remainder
  is reported as `deferred` and picked up by the next tick, no cursor involved. At a daily cron that
  means a day's delay for the overflow, so the cap only earns itself once the cron runs more often
  than daily.

## Before the first run

1. **Create `tool_state`** if it does not exist yet (columns in
   `claude/vm-dependency-notifier-design.md`). Missing is survivable — `runTask` logs and runs
   without the lease and interval guards rather than refusing to run.
2. **Create `follow_ups` and `follow_up_reminders`** (columns in `functions/welcome/FOLLOWUPS.md`).
3. **Connect Zoho Cliq as SHARED.** The job has no `req.userId`, so credential resolution falls
   through to the shared connection; one scoped to a single person is invisible to it.
4. **Set `CRED_ENC_KEY`** in `catalyst-config.json` *locally only* — see the Security notes in the
   repo's `CLAUDE.md`. Without it the job cannot decrypt the stored Cliq token.

## Console steps

1. `npm run deploy:scheduler-job`
2. **Job Scheduling → Job Pools** → use the existing pool, or create one of type *Function*.
3. **Jobs → Create Job** → target `scheduler_job` → Cron → the task's suggested expression →
   argument `{"task": "followup_reminders"}`.
4. Test it first: submit by hand with `{"task": "followup_reminders", "dry_run": true}`.

`GET /api/scheduler/tasks` lists every registered task with its last run, last error and last
result, and `POST /api/scheduler/tasks/:key/run` runs one on demand through the same `runTask`.

## `shared/` is generated

`scripts/sync-job-modules.js` copies it. Never edit it — `npm run check:job` (which `predeploy`
runs) fails the deploy if a copy drifts from its original.
