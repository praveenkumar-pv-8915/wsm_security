# task_manager

WSM Security task management API. Catalyst **Advanced I/O** function, `node18`, mounted at:

```
https://wsm-security-60073792083.development.catalystserverless.in/server/task_manager/
```

Separate from `functions/welcome` (the credential vault) on purpose — different concern, different
deploy target, no shared secrets. `catalyst-config.json` here carries **no** `env_variables`.

## Auth — Catalyst default Hosted Authentication

Catalyst's own hosted login pages sign the user in and establish the session. This function never
sees a password and never issues a token; it only verifies.

Per request (`auth.js`):

1. `catalyst.initialize(req)` → `userManagement().getCurrentUser()` — the **only** trusted identity.
   Nothing is read from the body, query, or a custom header.
2. The session's email must end in `@zohocorp.com`. Used for this one comparison only — never
   stored, logged, or returned.

There is **no `members` table** (2026-08-27 decision — see `CLAUDE.md` and the project KB,
`claude/datastore-conventions.md`). Ownership and role both come straight off the Catalyst session:
`req.caller = { userId, name, role }`, keyed on `user_id`, never email — a `user_id` is not PII, and
it's a plain column on the row that needs it, not a separate table.

`401` no session · `403` wrong domain. Any error **fails closed**.

Write access is narrower than read: only the **assignee**, the **reporter**, or a member with
`ROLE = 'admin'` may PATCH/DELETE a task or touch its checklist.

⚠️ **The SDK runs at admin scope.** Catalyst roles will not filter DataStore rows for the calling
user, so every ownership and visibility rule in this function is enforced in application code. Don't
add a query path that skips those checks.

## One-time console setup

1. **Authentication → Authentication Types → Hosted Authentication** — enable it if it isn't already,
   and set the branding/redirect for this app.
2. **Serverless → FAAS → task_manager → Security Rules** — set `authentication` to **`required`**.
   Catalyst defaults every new function to `optional`, which would leave these routes callable
   anonymously with `getCurrentUser()` returning null. This is the single most important step.
3. **Data Store** — create the three tables below.
4. Make sure your own account is invited under **Authentication → User Management** with the
   `App Administrator` role — that's what makes `role: 'admin'` come back on `/me`, no seed step
   needed.
5. Optional but recommended: a **Custom User Validation** Basic I/O function that checks the
   `@zohocorp.com` domain (or Catalyst's own invite list) at signup and fails closed, so a valid
   Zoho account outside the team can't self-register. `functions/welcome` has no equivalent;
   Tech-Stack-Inventory's `signup_validator` is the pattern.

## DataStore schema

`ROWID`, `CREATEDTIME` and `MODIFIEDTIME` are added by Catalyst — don't create them.

No `members` table. The assignee/reporter picker (`GET /members`) reads Catalyst's own user
directory live via `userManagement().getAllUsers()` — see `task-service.js#listMembers`. The roster
lives in exactly one place: the console's User Management screen.

### `tasks`

| Column | Type | Notes |
|---|---|---|
| `TITLE` | Text | required, ≤ 500 chars |
| `DESCRIPTION` | Text | long text |
| `TASK_TYPE` | Text | `hacksaw_review` \| `dev` \| `security_review` \| `tools_development` \| `techstack_2_0` |
| `PRODUCT` | Text | e.g. `ADAudit Plus`, `Platform / shared` |
| `ASSIGNEE_ID` | Text | Catalyst `user_id`; empty = unassigned |
| `REPORTER_ID` | Text | Catalyst `user_id`, set from the session, never the client |
| `PRIORITY` | Text | `P0` \| `P1` \| `P2` \| `P3` |
| `STATUS` | Text | `backlog` \| `in_progress` \| `blocked` \| `in_review` \| `done` |
| `DUE_DATE` | Text | `YYYY-MM-DD` — plain text so ZCQL string ordering sorts it correctly |
| `TAGS` | Text | comma-separated |
| `VISIBILITY` | Text | `team` \| `private` (private = assignee + reporter + admins only) |
| `IS_ARCHIVED` | Text | `'true'` \| `'false'` — soft delete |

Index `ASSIGNEE_ID` and `STATUS`; those two carry every list query.

### `task_checklist`

| Column | Type | Notes |
|---|---|---|
| `TASK_ID` | Text | `tasks.ROWID` |
| `ITEM` | Text | |
| `IS_DONE` | Text | `'true'` \| `'false'` |
| `POSITION` | Number | display order |

### `task_activity`

Append-only. Feeds the drawer's activity panel and doubles as the audit trail.

| Column | Type | Notes |
|---|---|---|
| `TASK_ID` | Text | `tasks.ROWID` |
| `ACTOR_ID` | Text | Catalyst `user_id`, from the session |
| `EVENT_TYPE` | Text | `created` \| `field_changed` \| `comment` \| `archived` \| `checklist_*` |
| `FIELD_NAME` | Text | for `field_changed` |
| `FROM_VALUE` | Text | |
| `TO_VALUE` | Text | |
| `COMMENT` | Text | for `comment` |

## Endpoints

All paths are relative to `/server/task_manager/`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness — the only unauthenticated route |
| GET | `/me` | caller's `user_id`, name, role (no email) |
| GET | `/members` | active users from Catalyst User Management (assignee dropdown) |
| GET | `/meta` | allowed types/statuses/priorities, so UI dropdowns can't drift from the API |
| GET | `/tasks?scope=mine\|team\|closed` | list (default `team`) |
| GET | `/tasks/:id` | one task + checklist + activity |
| POST | `/tasks` | create |
| PATCH | `/tasks/:id` | partial update; one activity row per changed field |
| DELETE | `/tasks/:id` | soft delete (archive) |
| POST | `/tasks/:id/comments` | `{ comment }` |
| POST | `/tasks/:id/checklist` | `{ item }` |
| PATCH | `/tasks/:id/checklist/:itemId` | `{ is_done }` |
| DELETE | `/tasks/:id/checklist/:itemId` | remove item |

### Create example

```json
POST /server/task_manager/tasks
{
  "title": "Rotate service-account credentials for the ADAudit ingestion job",
  "description": "The ingestion job still uses the credential issued in Q1.",
  "type": "security_review",
  "product": "ADAudit Plus",
  "assignee_id": "60073792083000012345",
  "priority": "P1",
  "status": "in_progress",
  "due_date": "2026-08-21",
  "tags": "credential-rotation, quarterly",
  "visibility": "team",
  "checklist": ["Generate replacement credential", "Store in Credential Vault"]
}
```

## Design notes

- **Filtering and sorting are client-side.** `GET /tasks` returns the scope set; the UI applies the
  seven filters and the sort. Team-scale data is hundreds of rows, and this keeps the API surface
  small. Revisit if the table passes a few thousand rows.
- **ZCQL caps SELECT at 300 rows.** `db.js#selectAll` pages past it; every paged query carries a
  stable `ORDER BY` so pages can't repeat or skip.
- **Dates are text, not DateTime.** `YYYY-MM-DD` sorts correctly as a string and sidesteps ZCQL
  date/timezone handling. Overdue/due-soon logic lives in the client.
- **Soft delete only.** Archiving preserves the activity trail; nothing hard-deletes a task.

## Deploy

```bash
cd functions/task_manager
npm install            # or: cp -r ../welcome/node_modules .
cd ../..
catalyst deploy        # catalyst.json targets both "welcome" and "task_manager"
```

Then verify: `curl .../server/task_manager/health` should return `{"status":"ok",...}`, and
`/server/task_manager/me` should return **401** in a browser with no session — if it returns data,
Security Rules is still `optional`.

## UI

`POC/wsm-security-workspace-outline.html` is the interactive wireframe this API is shaped to serve.
Its in-memory `TASKS` array maps 1:1 onto the `tasks` table; the type keys there are the display
labels for the `TASK_TYPE` values above.
