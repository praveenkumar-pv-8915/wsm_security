FILE_PURPOSE: Read when configuring event-driven triggers in Catalyst — linking component events to functions/circuits, creating custom event endpoints, or setting up third-party webhooks via Signals.
TRIGGER_KEYWORDS: event listener, Signals, custom event, third-party event, webhook, event function, event rule, component event, trigger URL, Event type function
SOURCE_DOC: help-docs/event-listeners.md

TECHNICAL_CONSTRAINTS:
- Signals is the current service name; "Event Listeners" is legacy terminology — they are the same feature
- Three listener types:
  1. Catalyst Component Event Listener: built-in; triggers on platform events (Data Store row insert/update/delete, File Store upload, Auth user signup/login, etc.)
  2. Custom Event Listener: auto-generates a unique invoke URL; POST to URL triggers the associated function/circuit
  3. Third-party Event Listener: same as Custom but scoped for external service webhooks; supports auth via Connections
- Target must be an Event-type function or a Circuit (not Basic I/O, Advanced I/O, or Cron functions)
- Rules: each listener has one or more rules; each rule maps an event to a target function/circuit
- Auth for webhooks: can be tied to a Connection (see docs/connections.md); enabled per webhook in console
- Component events that can trigger listeners: Data Store (insert/update/delete), File Store (upload), Auth (signup, login, password change), Cron (execution)

REQUIRED_PARAMETERS:
- Listener name (required)
- Listener type: Catalyst Component | Custom | Third-party
- For Component type: select component type + event action (e.g., Data Store → Insert)
- Target: Event function or Circuit (selected from deployed assets)
- For Custom/Third-party: invoke URL is auto-generated; POST requests to this URL trigger execution
- Request payload: passed as-is to the target function's event context
- Auth (optional, third-party): enable "Authorize via Connection" → select Connection Link Name

UI_ONLY_ACTIONS:
- Create listener: Console → Cloud Scale → Signals → Create Listener → select type → configure rules → Save
- View invoke URL (Custom/Third-party): Console → Signals → listener row → expand → copy Invoke URL
- Enable/disable listener: Console → Signals → toggle Status switch on listener row
- Add rule to listener: Console → Signals → open listener → Add Rule → configure event + target → Save
- Delete listener: Console → Signals → listener row → ellipsis → Delete → confirm
- Configure webhook auth: Console → Signals → Webhooks → Create Webhook → enable "Authorize via Connection" → select connection
- Note: No CLI commands for creating or managing Signals listeners; invoke URL can be called externally via HTTP POST

CRITICAL_FAILURE_MODES:
- Targeting a non-Event function: only Event-type functions appear in target dropdown; Basic I/O / Advanced I/O / Cron functions are filtered out
- Invoke URL not secured: Custom/Third-party listener URLs are publicly invocable by default unless auth via Connection is configured — anyone with the URL can trigger execution
- Component event not firing: verify the triggering component (Data Store table, File Store folder, etc.) is correctly associated in the rule; table/folder scope mismatches cause silent non-trigger
- Disabled listener: status toggle is easy to miss; disabled listeners silently drop all events
- Circuit target in unsupported DC: if Circuit feature is unavailable in the project's DC, Circuit cannot be selected as target (see docs/circuits.md for DC restrictions)
