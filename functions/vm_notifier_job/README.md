# vm_notifier_job

The 6-hourly scan behind **VM Manager → Dependency Upgrade Notifier**. Scans each watched
dependency's release-notes source, records new versions in `vm_notifications`, and posts a
consolidated card to that dependency's channel.

It is a **Job Function** (`type: "job"`), not a Cron Function — Cron Functions reached EOL in
April 2026 and Job Scheduling replaced them.

The function is a shell around `runScan()` in `shared/vm-scan-service.js`. The UI's **Run now**
button calls the same function inside `welcome`, so a manual run rehearses the scheduled one.

## Before it can run

Three things, in this order. All three are console-only — Catalyst has no API for any of them.

### 1. Create the `vm_notifications` table

Data Store → Create a new Table. Name it exactly `vm_notifications`.

| Column | Type | Max length | Mandatory | Unique |
|---|---|---|---|---|
| DEP_KEY | Var Char | 60 | Yes | No |
| VERSION | Var Char | 60 | Yes | No |
| DEP_VERSION_KEY | Var Char | 130 | Yes | **Yes** |
| DEP_NAME | Var Char | 100 | No | No |
| SOURCE_TYPE | Var Char | 20 | No | No |
| SOURCE_URL | Var Char | 255 | No | No |
| TITLE | Var Char | 255 | No | No |
| SUMMARY | Text | — | No | No |
| POSTED_AT | Var Char | 25 | No | No |
| DETECTED_AT | Var Char | 25 | No | No |
| DELIVERY_STATUS | Var Char | 20 | No | No |
| DELIVERY_ERROR | Var Char | 255 | No | No |
| DELIVERY_AT | Var Char | 25 | No | No |

`DEP_VERSION_KEY` is `DEP_KEY::VERSION`, computed by the app. It is the reason a re-scan cannot
notify the same release twice, and **`IsUnique` cannot be changed after the column is created** —
set it now or recreate the table later.

`SUMMARY` must be **Text**, not Var Char: a release excerpt runs past 255 characters.
`POSTED_AT` is blank for Learn-sourced rows — that page has no per-version date.

`tool_state` must exist too (see `claude/datastore-conventions.md`); it holds each dependency's
Connect watermark.

### 2. Register `zoho-connect` and connect it

Already in `connections-registry.js`. Someone still has to create a **shared** connection for it
(Connections → Zoho Connect → Connect, scope level *shared*) and that Zoho account must be a member
of every Connect group being watched — otherwise `allScopes` simply will not list the network, and
the scan reports `Connect network '<portal>' not found`.

### 3. Deploy, then schedule

```bash
npm run sync:job        # refresh shared/ from functions/welcome
npm run deploy          # predeploy fails the build if shared/ is stale
```

Then in the console: **Job Scheduling → Job Pools** → create or pick a pool → **Create Job** with

- Target: `vm_notifier_job` (Job Function)
- Type: Cron / recurring
- Cron expression: `0 */6 * * *` — every 6 hours, on the hour

A scheduled run needs no argument. To re-scan one dependency out of band, submit a job with
`{"dependencies":["stratus_client"]}`.

## The first run is a baseline

A dependency added today has no known current version, so everything its source lists looks new — a
Learn page can carry forty historical versions. The first scan therefore **records** what it finds
and announces nothing; those rows show on the page with delivery `skipped` and the reason
*Baseline*. From the next run on, anything newer than that watermark is a real release and is
posted.

## shared/ is generated

`shared/` is a copy of eight modules from `functions/welcome`, made by
`scripts/sync-job-modules.js`, because Catalyst packages each function directory separately and a
cross-directory `require` resolves locally then fails after deploy. **Edit
`functions/welcome/<file>`, never `shared/<file>`** — `npm run check:job` compares content and fails
the deploy if the two ever disagree.
