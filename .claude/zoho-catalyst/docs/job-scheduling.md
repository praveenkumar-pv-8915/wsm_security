FILE_PURPOSE: Read when using Job Scheduling to create Job Pools, submit jobs, or configure Pre-defined/Dynamic Crons — the newer, more capable alternative to the basic Cron component.
TRIGGER_KEYWORDS: Job Scheduling, Job Pool, job pool ID, Dynamic Cron, Pre-defined Cron, Cron Expression, Job Function, dispatch delay, job state, job timeout
SOURCE_DOC: help-docs/job-scheduling.md

TECHNICAL_CONSTRAINTS:
- Job Scheduling is separate from the basic Cron component (docs/cron.md); Job Scheduling is more capable (1-minute minimum vs 1-hour minimum for basic Cron)
- Circuits target type: NOT available in EU, AU, IN, JP, SA, CA data centers (same 6 DCs as Circuits itself — see docs/circuits.md)
- Minimum recursive interval: 1 minute (vs 1 hour in basic Cron component)
- Job timeout: 15 minutes (Function Job Pool); job state becomes Failure/Timeout after this
- Job Pool types: Functions | Webhooks | Circuits | AppSail
- Function Job Pool: requires memory allocation; Job Pool memory MUST exceed the function's own memory requirement; max 10GB total per project
- Non-function Job Pools (Webhook/Circuit/AppSail): configure max parallel execution count; hard cap = 10 concurrent targets per pool
- Pre-defined Crons: created in console; DO migrate to production on deploy
- Dynamic Crons: created via SDK (ideal) or console Builder (testing only); do NOT migrate to production; must be recreated in production via code
- Retry config: max 10 retry attempts; min retry interval 1 minute, max 24 hours
- Execution history: 15 days dev, 30 days production
- Cron Expression format: 5 fields — `Mins Hrs Day(Month) Month Day(Week)`
  - Ranges: Mins 0–59, Hrs 0–23, Day(Month) 1–31, Month 1–12, Day(Week) 0–6 (0/6=Sunday)
  - Special chars: `*` (all), `,` (list), `-` (range), `/` (increment), `#` (nth weekday)

REQUIRED_PARAMETERS:
- Job Pool ID: auto-generated; required for SDK/API operations; find in console Job Pool details
- Job Pool creation: name + type (Function/Webhook/Circuit/AppSail) + memory (Function type only) or max count (others)
- Job submission: target (function/URL/circuit/AppSail service) + optional payload + schedule (immediate or via Cron)
- Dynamic Cron SDK (Node.js):
  ```js
  const jobScheduling = app.jobScheduling();
  const cron = await jobScheduling.createCron({ cronName: 'name', jobDetail: {...}, scheduleInfo: {...} });
  ```
- Job states: Success | Pending (dispatch delay) | Running | Failure
  - Failure sub-types: Failure | Timeout | Code_Exception | Not_Found | Unintentional_Termination

UI_ONLY_ACTIONS:
- Create Job Pool: Console → Job Scheduling → Job Pool → Create Job Pool → select type → configure memory/max count → Save
- Submit immediate job: Console → Job Scheduling → Job Pool → open pool → Submit Job → configure target + payload → Submit
- Create Pre-defined Cron: Console → Job Scheduling → Cron → Create Cron → Pre-defined → configure schedule → Save
- Create Dynamic Cron (console, testing only): Console → Job Scheduling → Cron → Create Cron → Dynamic → configure → Save
- View Dashboard: Console → Job Scheduling → Dashboard → view job statuses, top delayed jobs, pool summaries
- View execution history: Console → Job Scheduling → Cron → click cron → Execution History
- Configure Application Alert: Console → Job Scheduling → Job Pool → open pool → Configure Alert → set failure/delay conditions
- For actual page layout and click-paths, also read: `references/console-navigation.md`

CRITICAL_FAILURE_MODES:
- Function Job Pool memory less than function memory: causes dispatch delays; jobs queue but execute late — increase pool memory to exceed function's memory requirement
- Dynamic Cron in dev not migrated to production: Dynamic Crons do not auto-deploy; must implement creation logic in code so they get created at production runtime
- Circuits in blocked DC: Job Pool type "Circuit" is unavailable in EU/AU/IN/JP/SA/CA — creating a Circuit Job Pool fails silently or option is absent from console
- Job timeout at 15 minutes: long-running functions killed at 15-minute mark with Timeout failure state; design functions to complete within this limit
- Cron Expression syntax error: cron will not execute — no error at save time; validate expression in console Builder before using in code
- Max parallel count >10 for non-function pools: hard cap; exceeding submissions queue up and may accumulate dispatch delays
