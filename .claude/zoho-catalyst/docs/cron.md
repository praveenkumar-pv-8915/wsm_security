FILE_PURPOSE: Read when creating, configuring, or debugging scheduled jobs in Catalyst Cron — one-time or recursive executions targeting functions, third-party URLs, or circuits.
TRIGGER_KEYWORDS: Cron, cron job, Cron ID, Execution ID, recursive cron, cron function, schedule point, third-party URL cron, Job Scheduling, cron execution history
SOURCE_DOC: help-docs/cron.md

TECHNICAL_CONSTRAINTS:
- Execution limit: 500 executions/project/day in dev env; no limit in production
- Minimum recursive frequency: 1 hour (cannot schedule sub-hourly intervals in recursive mode)
- Schedule types: One-Time, Recursive (Repeat Types: Every, Daily, Monthly, Yearly)
- Schedule points: Cron Function (cron-type functions only — not Basic I/O, Advanced I/O, Event), Third-party URL, Circuit
- Third-party URL HTTP methods: POST, GET, PUT, DELETE
- Content-type header required for POST/PUT to third-party URLs; supported types: text/plain, application/json, application/javascript, application/xml, text/xml, text/html
- Execution history retention: 15 days in dev, 30 days in production
- Auto-disable: third-party URL crons are automatically disabled after 50 consecutive failures; cron functions are NEVER auto-disabled regardless of failure count
- Cron ID: auto-generated on creation; Execution ID: auto-generated per invocation
- Job Scheduling (Early Access): newer alternative to Cron — email support@zohocatalyst.com to enable
- Time zone: configurable per cron, independent of project time zone in General Settings

REQUIRED_PARAMETERS:
- Cron name (required), description (optional)
- Schedule point type: Function | Third-party URL | Circuit
- Function target: select from deployed cron functions only (dropdown filters by function type)
- Third-party URL: target URL, HTTP method, optional headers (name/value pairs), optional URL params, optional request body
- Circuit target: select from deployed circuits; pass JSON input as key-value pairs
- Schedule type: One Time (date + time + timezone) | Recursive (repeat type + interval/time + timezone)
- Function/Circuit parameters: key-value pairs, support placeholder variables for dynamic values at runtime

UI_ONLY_ACTIONS:
- Create cron: Console → Cloud Scale → Cron → Create Cron → configure name, schedule point, schedule type → Save
- Edit cron: Console → Cron → click cron → Edit → modify → Save
- Enable/disable cron: Console → Cron → toggle Status switch for the cron row
- Delete cron: Console → Cron → click cron → ellipsis → Delete → confirm
- View execution history: Console → Cron → click History icon for cron → filter by status/time/timezone
- Configure alert from cron: Console → Cron → click cron → +Configure (in alerts section) → configure → Confirm
- Remove alert from cron: Console → Cron → click cron → ellipsis next to alert → Remove
- Note: Cron cannot be created or triggered via CLI; execution is console/platform-only
- For practical console navigation, also read: `references/console-navigation.md`

CRITICAL_FAILURE_MODES:
- Sub-hourly recursive cron: not possible; minimum interval is 1 hour for recursive executions
- Using a non-cron function type as schedule point target: only cron-type functions appear in dropdown; other function types are filtered out — cannot bypass
- Third-party URL cron auto-disables at 50 consecutive failures silently unless Application Alert is configured; cron functions never auto-disable (failures accumulate without alert)
- Placeholder variable not resolved at runtime: if dynamic value source fails, placeholder remains literal string in parameter — verify placeholder logic in function code
- Execution history only goes back 15 days (dev) / 30 days (prod) — older executions are permanently gone
- Cron time zone vs project time zone: these are independent settings; setting project timezone does not affect cron execution time
