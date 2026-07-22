FILE_PURPOSE: Read when configuring automated alerts for Cron failures, Event Listener failures, or log keyword monitoring in Catalyst.
TRIGGER_KEYWORDS: Application Alerts, alert frequency, alert criteria, cron failure alert, event listener alert, log keyword alert, alert notifiers, alert threshold
SOURCE_DOC: help-docs/application-alerts.md

TECHNICAL_CONSTRAINTS:
- Limits: 5 alerts max in dev env; 20 alerts max in production env
- Max 10 email notifiers per alert
- Single alert: ONE component only — Cron, Event Listener, OR Logs; cannot mix components in one alert
- Alert threshold for multi-condition (e.g., Failure + Timeout): count is COLLECTIVE across all conditions, not per-condition
- Cron alert condition options: Failure, Code Exception, Timeout
- Event Listener alert condition options: Failure, Code Exception, Timeout
- Logs alert: requires log type (Access or Application), function(s), keyword; Application logs also requires log level
- Node.js log levels include: Info, Error, Severe, Warning, Uncaught Exception, Unhandled Rejection
- Alert frequency options: every 15min / 1h / 12h OR specific daily time (hour:minute)
- Frequency window is rolling from alert config time, not calendar-aligned

REQUIRED_PARAMETERS:
- Cron alert: schedule point (function execution or third-party URL), cron selection, condition(s), comparator, threshold value, frequency, recipient emails (1 min)
- Event Listener alert: event bus type (Catalyst Component or custom), rule selection, condition(s), comparator, threshold, frequency, recipient emails
- Logs alert: Logs Query (type + function(s) + keyword [+ log level if Application]), comparator, threshold, frequency, recipient emails
- Comparators available: greater than, lesser than, equals to, greater than or equal to
- Alert ID: auto-generated on creation

UI_ONLY_ACTIONS:
- Create alert: Console → DevOps → Application Alerts → Create Alert → select component (Cron/Event Listener/Logs) → name → configure entities → set conditions/query/criteria/frequency → add recipient emails → Create
- Edit alert: Console → Application Alerts → ellipsis on alert row → Edit (or open alert → Edit) → modify → Edit
- Disable alert: Console → Application Alerts → ellipsis → Disable → Yes, Proceed
- Enable alert: Console → Application Alerts → ellipsis → Enable
- Delete alert: Console → Application Alerts → ellipsis → Delete → Yes, Proceed
- Add entities to existing Cron/Event alert: open alert details → +Configure → select additional crons or event rules → Configure
- Shortcut: Alerts can also be created directly from the Cron, Event Listeners, or Logs component pages without navigating to Application Alerts
- Note: No CLI or API for alert management; console-only

CRITICAL_FAILURE_MODES:
- Multi-condition threshold is collective: if Failure=7 and Timeout=4 with threshold "≥10", alert fires (11 total) even though neither condition alone crossed 10
- Frequency window starts from alert creation/modification time, NOT from midnight or hour boundary — modifying frequency resets the window clock
- Logs alerts: if no function logs exist in the window matching the query, threshold is 0 — alert only fires if threshold condition is met (e.g., "greater than 0" with 0 results = no alert)
- Cannot configure one alert to span Cron AND Event Listener — must create separate alerts
- Disabling an alert stops all event listening for that alert; events during disabled window are not retroactively counted when re-enabled
