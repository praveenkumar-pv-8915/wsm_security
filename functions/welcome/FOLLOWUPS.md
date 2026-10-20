# Follow-ups — tables and setup

The chase list: one row per thing someone is following up on, with Cliq reminders sent now, before
the ETA, or every day it stays overdue.

Code: `followup-service.js` (records) and `followup-notify-service.js` (sending), routes under
`/api/followups` in `index.js`, UI in `frontend/src/views/FollowUps.jsx`, scheduled sweep via the
`followup_reminders` task in `functions/welcome/scheduled-tasks.js`, run by `functions/scheduler_job/`.

## Create these two tables in the Catalyst console

Column names follow the standing rule — **UPPERCASE_SNAKE_CASE** for app columns; `ROWID`,
`CREATEDTIME` and `MODIFIEDTIME` are Catalyst's own and are created automatically.

**`Var Char` is capped at 255 in Catalyst** — the console rejects a larger Max Length outright.
Anything longer has to be `Text`, and a `Text` column **cannot be Mandatory**. That pair of
constraints is what fixes the three sizing choices below (`TASK`, `REF_URL`, `TARGETS`). Dates that need
only day precision are `Var Char` `'YYYY-MM-DD'`, which string-sorts correctly and sidesteps ZCQL
date/timezone handling.

### `follow_ups`

| Column | Type | Max | Mandatory | Unique | Notes |
|---|---|---|---|---|---|
| `TASK` | Var Char | **255** | **Yes** | No | what is being chased. 255 is Catalyst's `Var Char` ceiling; kept as Var Char rather than `Text` because **`Text` cannot be Mandatory**, and "a follow-up must say what it is" is worth more than a longer title |
| `REF_URL` | **Text** | — | No | No | the doc / task / project link. `Text`, not `Var Char`: a Projects or Writer URL runs past the 255 ceiling. http(s) only — validated server-side, because it is rendered as an anchor in the table *and* in the Cliq card |
| `ETA` | Var Char | 10 | No | No | `'YYYY-MM-DD'`. Empty means the row is tracked but never chased on a schedule |
| `DRI` | Var Char | 120 | No | No | free text. **Not** a user_id — see "Identity" below |
| `NOTIFY_TARGETS` | Text | — | No | No | JSON array of `{ type, value }`, `type` ∈ `channel` (Cliq `unique_name`) \| `user` (Catalyst `user_id`). **Never an email** — see Identity. Text, so it cannot be Mandatory |
| `STATUS` | Var Char | 20 | **Yes** | No | `open` \| `in_progress` \| `blocked` \| `done` \| `cancelled`. The last two stop the sweep |
| `EVIDENCE` | Text | — | No | No | what proves it is done. Clipped to 9,000 chars by the service, under the 10,000 `Text` cap with headroom for JSON escaping |
| `REMIND_BEFORE_DAYS` | Var Char | 5 | No | No | pre-ETA window in days; `0` switches that half off |
| `OVERDUE_EVERY_DAYS` | Var Char | 5 | No | No | overdue repeat in days; `0` switches that half off |
| `IS_ACTIVE` | Var Char | 5 | No | No | `'true'` \| `'false'` — the Pause toggle. Same text-boolean convention as `tasks.IS_ARCHIVED` |
| `OWNER_ID` | Var Char | 50 | No | No | Catalyst `user_id` of whoever filed the row. The only identity column here |
| `LAST_REMINDED_AT` | Var Char | 25 | No | No | ISO-8601 UTC |
| `LAST_REMINDER_ERROR` | Var Char | 255 | No | No | truncated by the service, not the caller |

### `follow_up_reminders`

The delivery log — what was sent, when, to whom, and whether it landed.

| Column | Type | Max | Mandatory | Unique | Notes |
|---|---|---|---|---|---|
| `FOLLOW_UP_ID` | Var Char | 25 | **Yes** | No | the parent's `ROWID`, as text |
| `DEDUPE_KEY` | Var Char | 120 | **Yes** | **Yes** | `<id>::<trigger>::<bucket>`. The bucket is the IST calendar day today (`2026-10-13`) and can be a finer slice later (`2026-10-13T14`) with no schema change — 120 chars leaves room. This is what makes a re-run of the sweep safe, and what caps the nagging independently of how often the cron fires; see `CADENCES` in `followup-notify-service.js` |
| `SENT_AT` | Var Char | 25 | No | No | ISO-8601 UTC |
| `TRIGGER_TYPE` | Var Char | 20 | No | No | `manual` \| `pre_eta` \| `overdue`. **Not** named `TRIGGER` — it is a reserved word in most SQL dialects and ZCQL is SQL-like; renaming before creation is free, afterwards it is a console-only rename plus an ordered deploy |
| `TARGETS` | **Text** | — | No | No | who it went to, as ids (`#channel, user:<id>`). `Text` because 25 targets will not fit in 255 |
| `DELIVERY_STATUS` | Var Char | 20 | No | No | `sent` \| `partial` \| `failed` |
| `DELIVERY_ERROR` | Var Char | 255 | No | No | per-target errors, joined |
| `ACTOR_ID` | Var Char | 50 | No | No | `user_id`, or the job's name for a scheduled run |

Both services answer **424 with the full expected column list** if a table is missing or a column is
misnamed, so a fresh environment tells you what to create instead of looking like a 500.

## Cliq delivery

Posting goes through the stored **`zoho-cliq` OAuth connection**, not a webhook URL — a follow-up
names its recipients per row, and a webhook URL is bound to one destination.

**No new scope is needed.** Cliq's whole v2 messaging surface is covered by
`ZohoCliq.Webhooks.CREATE`, which `connections-registry.js` already requests for `zoho-cliq`
(verified against the Cliq v2 Messages docs, 2026-10-13):

| Target type | Endpoint | Stored value |
|---|---|---|
| `channel` | `POST /api/v2/channelsbyname/{unique_name}/message` | the `unique_name` |
| `user` | `POST /api/v2/buddies/{email}/message` | the Catalyst `user_id`; the email is resolved at send time |

`bot` targets were dropped: Cliq has no bot-listing endpoint within these scopes, and the form is
picker-only, so a bot could not be offered from a list.

### Scopes

`ZohoCliq.Webhooks.CREATE` covers all of the posting above. **`ZohoCliq.Channels.READ` was added on
2026-10-13** for the channel picker — posting to a channel never needed it, listing them does. A
`zoho-cliq` connection created before that date must be **reauthorized** or the picker answers 424
with that instruction.

The target value is URL-encoded into its path segment, so a mistyped target cannot traverse out of
it and turn the route into a general-purpose proxy into Cliq.

**Connect Cliq as SHARED.** `callConnection` resolves the caller's own connection first and falls
back to the shared one; the scheduled job has no `req.userId`, so a connection scoped to one person
is invisible to it.

## Identity (the 2026-08-27 no-PII rule)

**No email is ever stored by this feature.** `OWNER_ID` and a `user` target are both Catalyst
`user_id`s. Cliq addresses a person by email, so the email is resolved from Catalyst User Management
at send time by `directory-service.userEmailResolver`, used for that one POST, and dropped — one
cached directory read per sweep, never a column, never a log line. A failure says `user:<id>`.

An earlier design stored a typed email as a `buddy` target and justified it as "an address, not
identity". That was wrong: a stored email is stored PII however it is labelled. It is gone, and
`parseTargets` now **rejects** a typed email with a message pointing at the picker rather than
coercing it.

`DRI` stays free text — it is a label on the work, not an address.

## The notify directories

Both read live on every call, nothing persisted:

| Route | Source | Returns |
|---|---|---|
| `GET /api/followups/members` | Catalyst User Management | `{ id, name, role }` — **never email** |
| `GET /api/followups/channels` | Cliq `GET /api/v2/channels?joined=true` | `{ unique_name, name }` |

The channel list comes from the **shared** connection, because that is the credential the cron posts
with: a channel only the signed-in person has joined would accept the pick and then fail every
scheduled reminder. It is memoised for 60 seconds server-side — Cliq rate-limits that endpoint to 20
calls a minute and then locks it for ten, and every save validates its targets against it.

Saves are validated: a target that is not in either list is a 400 naming it. The usual cause is not a
typo (the form is picker-only) but a channel the shared account has left, or a member who has been
removed.

## Re-running the sweep is safe

`DEDUPE_KEY` is Mandatory + Unique, and `alreadySent()` checks it before posting, so the constraint
is a backstop rather than the normal path. A retry after a failure, a hand-submitted job, or two
ticks after a deploy all re-find the same rows and skip every one of them. **Remind now**
deliberately bypasses this (the key is salted with the time) — a person pressing the button means it.

## The day boundary is IST

ETAs are typed by a team in Asia/Kolkata and compared against "today", so `today()` formats in that
zone. Catalyst runs functions in UTC: a sweep at 09:00 IST is 03:30 UTC on the same day, but an
overdue count taken in UTC would flip a day late for anything after 05:30 IST. Schedule the job
accordingly — `30 3 * * *` UTC.

## Raising the frequency

Edit the cron expression in the console; nothing in this repo changes. ETA arithmetic is day-based
whatever the tick frequency, so a faster cron finds a newly-due row *sooner* without multiplying
reminders — `DEDUPE_KEY`'s bucket is what caps those. `functions/scheduler_job/README.md` has the
caveats (the lease is advisory; a tick is capped at 40 rows and reports the rest as `deferred`).
