FILE_PURPOSE: Read when accessing Catalyst function logs, writing log statements in function code, or filtering/debugging execution history.
TRIGGER_KEYWORDS: Logs, Access Log, Application Log, log level, context.log, console.log, LOGGER.log, Execution ID, log retention, push to logs
SOURCE_DOC: help-docs/logs.md

TECHNICAL_CONSTRAINTS:
- Two log types (mutually exclusive view — cannot combine):
  - Access Logs: external invocation layer only; covers Basic I/O, Advanced I/O, Integration, Browser Logic functions only (NOT Event or Cron)
  - Application Logs: all function types including Event and Cron
- Log retention: 7 days in dev, 14 days in production (hard — older logs are permanently gone)
- Max log message size: 1500 characters per push
- Log indexing: usually instant; up to 5-minute delay possible
- Log levels (Application Logs only; not shown in Access Logs):
  - Java: Severe, Warning, Info
  - Node.js: Error, Info, Warning, Debug
  - Python: Critical, Error, Warning, Info, Debug

REQUIRED_PARAMETERS: Log push methods by runtime and function type:
- Node.js Basic I/O: `context.log("message")` — OR `console.log()`
- Node.js all other types (Advanced I/O, Cron, Event, Integration): `console.log()`, `console.error()`, `console.warn()`, `console.debug()`
- Python Basic I/O: `context.log("message")`
- Python all other types: `logger.critical()`, `logger.error()`, `logger.warning()`, `logger.info()`, `logger.debug()`
- Java all types: `LOGGER.log(Level.INFO, "message")` OR `logger.severe()`, `logger.warning()`, `logger.info()`

UI_ONLY_ACTIONS:
- View logs: Console → Host & Manage → Logs → select log type (Access or Application) → set filters → Search
- Filter Access Logs: log type + date/time/timezone + function (Basic I/O / Advanced I/O / Integration / Browser Logic) + keyword
- Filter Application Logs: same as Access + log level + Execution ID (for Event/Cron functions)
- Refresh logs: hide filter panel → click Refresh Logs button
- Configure alert from logs: Console → Logs → Manage Alerts (top right) → configure search query + frequency + email
- Navigate to logs from execution history: Console → Cron → Execution History → select execution → View Logs
- Note: Log configuration is console-only; viewing and search are console-only; log push statements are written in function code

CRITICAL_FAILURE_MODES:
- Viewing Access Logs for Event/Cron functions: these function types are not in the Access Log function dropdown; they only appear in Application Logs
- Log message over 1500 characters: truncated silently; large objects/stacktraces must be truncated before logging
- Retention cutoff: logs older than 7 days (dev) / 14 days (production) are gone permanently; export important logs before cutoff
- Using `context.log()` in Advanced I/O function (Node.js): context object is not available in Advanced I/O handlers; use `console.log()` instead — `context.log()` will throw a runtime error
- 5-minute indexing delay: searching logs immediately after function execution may return no results; wait and refresh
- Log type selector not changed: console defaults to Access Logs; Cron/Event executions won't appear until switched to Application Logs
