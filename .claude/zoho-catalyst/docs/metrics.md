FILE_PURPOSE: Read when looking up what usage data is visible in Catalyst Metrics and how to navigate to it — Data Store, Cache, Cron, File Store, and API usage graphs.
TRIGGER_KEYWORDS: Metrics, usage metrics, row count history, cache segment size, cron execution count, file store space, API call count, resource usage, DevOps metrics
SOURCE_DOC: help-docs/metrics.md

TECHNICAL_CONSTRAINTS:
- Metrics is read-only — display only, no configuration actions available
- Covers 5 components: Data Store, Cache, Cron, Files, API
- No alerting from Metrics directly; use Application Alerts for that (see docs/application-alerts.md)
- Billing-based usage (API call counts, ongoing bill): separate from Metrics — found in Settings → Billing

REQUIRED_PARAMETERS:
- None — all data is auto-populated from project activity; no parameters to configure

UI_ONLY_ACTIONS:
- Access Metrics: Console → DevOps → Metrics
- Data Store metrics: Total Number of Tables graph; Row Count History bar graph (filter by table)
- Cache metrics: Number of Segments diagram; Keys About to Expire (filter by segment); Keys per Segment; Total Size per Segment (max 32 KB per segment shown)
- Cron metrics: Active/Inactive Jobs diagram; Execution Count per cron job (filter by cron)
- Files metrics: Total Space Utilization (used vs available of 10 GB); Number of Files per Folder; Size per Folder
- API metrics: Total Number of API Calls; Frequency of API Calls by HTTP request method (filter by method)
- Note: All Metrics views are console-only; there is no API or SDK to read metrics data programmatically

CRITICAL_FAILURE_MODES:
- Looking for billing/cost data in Metrics: not here — go to Settings → Billing
- Looking for function execution performance in Metrics: not here — go to APM (docs/apm.md) or Logs (docs/logs.md)
- File store space shown as 10 GB in Metrics: this appears to be the production limit displayed; dev limit is 1 GB (see docs/file-store.md)
