FILE_PURPOSE: Read when setting up APM, interpreting function performance data, or debugging slow/failing functions via Catalyst DevOps.
TRIGGER_KEYWORDS: APM, Application Performance Monitoring, function trace, component usage trace, slowest calls, invocation errors, function execution stats
SOURCE_DOC: help-docs/apm.md

TECHNICAL_CONSTRAINTS:
- NOT available in CA (Canada) data center
- Python functions NOT supported — only Java and Node.js functions are tracked
- All five function types tracked: Basic I/O, Advanced I/O, Cron, Event, Browser Logic
- Data retention: 30 days max; gaps during disabled periods are permanent (no backfill)
- Production billing: each graph/table fetch = 1 read credit
- Failure threshold: any function response with status > 400 is counted as an error/failure
- Top 100 Slowest Calls: aggregated across ALL functions of selected type, NOT per specific function
- API calls to Catalyst components (using HTTP/REST APIs) are NOT tracked in component trace — only SDK calls are tracked

REQUIRED_PARAMETERS:
- Dashboard requires: function type selection AND specific function selection AND time period
- Time period options: Last 24h (hourly), Last 7d, Last 15d, Last 30d (daily)
- Executed Functions filters: User ID, Request Method, Response Type, Function Name, Component type, Execution Time, Remote Calls, Response Time
- Remote calls filter and Response Time filter require comparator + numeric value

UI_ONLY_ACTIONS:
- Enable APM: Console → DevOps → APM → Enable Now → Proceed
- Disable APM: Console → DevOps → APM → ellipsis → Disable → type "DISABLE" → Confirm
- View Dashboard (invocation/error graphs, response time, Top 100 Slowest): Console → DevOps → APM → Dashboard → select function type + function + time period
- View Executed Functions list with filters: Console → DevOps → APM → Functions → Filters
- View component trace for a specific execution: Console → DevOps → APM → Functions → click execution row → Trace tab
- Note: No CLI or API access to APM data; all monitoring is console-only

CRITICAL_FAILURE_MODES:
- Top 100 Slowest Calls table ignores the specific function dropdown — it always shows all functions of the selected TYPE; do not expect per-function filtering there
- Disabling APM mid-deployment creates permanent blind spots: no data is collected during disabled window, even after re-enabling
- Component trace only shows SDK-initiated calls; if function makes direct HTTP calls to Catalyst APIs (not through SDK), those calls are invisible in the trace
- For Cron and Event functions: HTTP method and response code fields are blank in Executed Functions table — only "Success"/"Failure" status is shown
- CA data center users get no APM at all — silence is not a bug, feature is unavailable
