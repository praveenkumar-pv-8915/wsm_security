FILE_PURPOSE: Read when the user wants help navigating the Catalyst console UI, especially Job Scheduling, Cron, Job Pool, or execution-history pages.
TRIGGER_KEYWORDS: Catalyst console, Catalyst UI, Job Scheduling UI, Cron UI, Job Pool UI, where is this in Catalyst, how do I create a cron in Catalyst

# Catalyst Console Navigation

This file is for practical console navigation, not API syntax.

The examples below are grounded in the current Catalyst console shape seen in the `us-newsletter` project on `2026-03-25`.

## Job Scheduling Layout

In the left sidebar, `Job Scheduling` contains four pages:

- `Dashboard`
- `Job Pool`
- `Cron`
- `Jobs`

Use them like this:

- `Dashboard`: top-level health and counts
- `Job Pool`: where function/webhook/app pool definitions live
- `Cron`: where scheduled submissions live
- `Jobs`: raw execution list across the project

This is the main place to reason about scheduled operational workflows.

## Job Pool Navigation

Path:

`Job Scheduling > Job Pool > <pool>`

The pool detail page usually has:

- `Overview`
- `Jobs`

Use `Overview` to confirm:

- pool name
- pool id
- pool type
- memory or concurrency settings

Use `Jobs` to confirm:

- scheduled jobs actually fired
- `Source Type`
- `Source Name`
- submitted time
- success/failure mix

For debugging cron chains, this page is often faster than opening each cron individually.

If the user says "I see jobs here but not there", this is usually the first place to look.

## Cron Navigation

Path:

`Job Scheduling > Cron`

The cron page has two tabs:

- `Pre-defined`
- `Dynamic`

Use `Pre-defined` for console-managed recurring schedules.
Use `Dynamic` for crons created at runtime or for testing.

Each row typically shows:

- cron name
- cron id
- created time
- target type
- status toggle
- execution history icon

The row list is the fastest way to confirm whether a cron exists at all.

## Creating a Pre-defined Function Cron

Path:

`Job Scheduling > Cron > Create Cron`

The create flow is usually two steps.

### Step 1: Schedule

Typical fields:

- cron name
- description
- format type
- schedule type
- time/date or cron expression
- timezone

Important distinction:

- `Cron Expression`: useful for compact schedules like `0 21 * * *`
- `Standard Input` + `Recursive` + `Daily`: easier when the user thinks in wall-clock time

### Step 2: Target

For function targets, Catalyst asks for:

- `Job Name`
- `Select Job Pool`
- `Target Function`
- optional parameters
- retry count
- retry interval

Important distinction:

- `Cron Name` is the schedule object name
- `Job Name` is the submitted job label that appears in execution history

Do not mix those up.

## Cron Detail Page

Opening a cron usually shows:

- General Details
- Additional Parameters
- schedule section

Use this page to confirm:

- target function
- retries
- retry interval
- timezone
- actual saved params

The saved detail page is more trustworthy than memory after a UI wizard.

## Execution History

There are two useful history surfaces:

- `Cron > <cron> > Execution History`
- `Job Pool > <pool> > Jobs`

Use cron history when checking one schedule.
Use job pool jobs when checking the whole system.

## Practical Debugging Pattern

When the user says "ingest ran but enrichment did not":

1. Open `Job Scheduling > Cron` and check whether both crons exist and are enabled.
2. Open `Job Scheduling > Job Pool > <pool> > Jobs`.
3. Check whether scheduled rows exist for both targets.
4. Compare `Source Type`, `Source Name`, and submitted time.
5. If only ingest appears there, the problem is usually missing scheduling, not function logic.

## Newsletter Example

A real working pattern from the `us-newsletter` project:

- `daily_rss_ingest` at `9:00 PM America/Chicago`
- `daily_pulse_enrich` at `9:30 PM America/Chicago`
- both target job pool `newsletterfunctions`

This layout makes the operational model obvious in the UI:

- ingest cron creates rows
- enrich cron follows later
- Job Pool > Jobs shows whether both actually fired

## Common UI Gotchas

- Seeing successful rows in `Job Pool > Jobs` does not prove every downstream step exists. It only proves those submitted jobs ran.
- `Cron Name` and `Job Name` are separate and show up in different places.
- If a function never appears in the second create-cron step, verify the selected job pool and target type.
- The detail page is the easiest place to confirm whether params like `dry_run=false` were actually saved.

## Serverless Layout

In the left sidebar, `Serverless` typically contains:

- `Functions`
- `Security Rules`
- `AppSail`

Use this area for deployed compute and access-control surfaces.

## Functions List

Path:

`Serverless > Functions`

The list page usually shows:

- function name
- id
- created by
- created time
- stack
- type

This is the quickest place to confirm:

- whether a function actually exists in the project
- the function type, such as `Job`
- the runtime stack, such as `NodeJS 18`

In the newsletter project, this page clearly shows:

- `pulse_rss_ingest`
- `pulse_enrich`
- `pulse_connect_ingest`

## Function Detail Page

Path:

`Serverless > Functions > <function>`

The function detail page usually has tabs:

- `Overview`
- `Code`
- `Configuration`

### Overview tab

Use it to confirm:

- name
- id
- stack
- type
- creator
- basic invocation/time-out counters

This is the fastest UI-level confirmation that the deployed function matches the intended artifact.

### Configuration tab

Use it to confirm:

- environment variables
- allocated memory
- trigger-related settings

The environment-variable section usually includes:

- environment selector, such as `Development`
- search box
- `+ Add Variable`

The add-variable modal typically asks only for:

- `Key`
- environment-specific value

This matters because it teaches the agent what the real console flow looks like when the user is setting secrets manually.

Important reminder:

- Console-set env vars are easy to inspect here.
- Repo deploy behavior may still overwrite them depending on project setup, so console visibility and deployment persistence are separate questions.

## Security Rules Page

Path:

`Serverless > Security Rules`

This page is a project-level rules editor, not a per-function overview.

If the page shows something like `Functions are not created yet!!`, do not trust that message literally without cross-checking `Serverless > Functions`.

That kind of mismatch can mean:

- the feature is stale or not initialized for the current function types
- the page expects a different function exposure model
- API Gateway or advanced routing has not been configured yet

In other words:

- `Functions` is the source for "what exists"
- `Security Rules` is the source for "what is protected"

Do not confuse the two.

## Slate Layout

Path:

`Slate`

The Slate landing page is oriented around frontend app deployment and usually has multiple entry points:

- repository picker/search
- starter templates
- direct upload
- deploy from repository

Use this page to infer the supported app bootstrap paths:

- start from a repo already visible to the connected account
- start from a template
- upload a build artifact
- deploy from a repo URL

This is useful when the user asks "what does Catalyst expect for frontend hosting?" because the console makes the supported flows visually obvious before any code is written.
