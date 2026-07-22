FILE_PURPOSE: Read when creating, deploying, or debugging Catalyst Functions — selecting function type, runtime, SDK setup, or understanding execution constraints.
TRIGGER_KEYWORDS: functions, Basic I/O, Advanced I/O, Event function, Cron function, Integration function, context.close, zcatalyst-sdk-node, Node.js runtime, Python runtime, Java runtime, catalyst deploy, function type
SOURCE_DOC: help-docs/functions.md

TECHNICAL_CONSTRAINTS:
- Function types and I/O:
  - Basic I/O: JSON in/out; string param; synchronous; usable in Circuits
  - Advanced I/O: full HTTP request/response (headers, body, status); serves like a web handler
  - Event: triggered by Signals/event listeners; no direct HTTP invocation
  - Cron: triggered by Cron scheduler only; no HTTP invocation
  - Integration: NOT available in EU, AU, IN, CA data centers
- Runtimes available:
  - Java: 8, 11, 17
  - Node.js: 12 (EOL — avoid), 14, 16, 18, 20
  - Python: 3.9 only (no other Python versions)
- Console code editor: available for Node.js only; Java and Python require CLI + external editor
- `context.close()` is REQUIRED at end of Basic I/O and Event functions — omitting it causes the function to hang until timeout
- Advanced I/O functions: cannot be tested via `catalyst functions:serve` Node shell; use full deploy + HTTP test
- SDK install:
  - Node.js: `npm install zcatalyst-sdk-node`
  - Python: `pip install zcatalyst-sdk`
  - Java: add Maven/Gradle dependency `com.zohocorp.catalyst:zcatalyst-sdk`
- Memory and timeout limits: configurable per function in console; defaults vary by runtime
- Functions must be deployed before they can be used in Cron, Circuits, or Signals

REQUIRED_PARAMETERS:
- Function name: alphanumeric + hyphens; no spaces
- Function type: Basic I/O | Advanced I/O | Event | Cron | Integration
- Runtime: select from available versions per language
- Entry point (Java): fully qualified class name implementing the handler interface
- Basic I/O handler signature (Node.js):
  ```js
  module.exports = async (catalyst, data, context) => {
    // ...
    context.close(responseObject);
  };
  ```
- Advanced I/O handler signature (Node.js):
  ```js
  module.exports = async (req, res) => {
    res.status(200).send({ message: 'ok' });
  };
  ```
- Event handler signature (Node.js):
  ```js
  module.exports = async (catalyst, data, context) => {
    // ...
    context.close();
  };
  ```

UI_ONLY_ACTIONS:
- Create function (console editor): Console → Serverless → Functions → Create Function → select type + runtime → write code in editor → Save
- Create function (CLI): `catalyst functions:create` in project directory → select type + runtime → writes scaffold to local directory
- Deploy function: `catalyst deploy --only functions` or `catalyst deploy` (from CLI); OR Console → Functions → function row → Deploy
- Test Basic I/O in console: Console → Functions → open function → Test → provide JSON input → Run
- Configure memory/timeout: Console → Functions → open function → Settings → update memory/timeout → Save
- View function logs: Console → Functions → open function → Logs (or use APM for performance data)
- Note: Advanced I/O functions cannot be tested in Node shell — must deploy and call via HTTP

CRITICAL_FAILURE_MODES:
- Missing context.close() in Basic I/O or Event function: function hangs until timeout; no error thrown — silent hang
- Using Integration function in EU/AU/IN/CA: function type not available; will not appear in type selector in those DCs
- Targeting non-cron-type function from Cron scheduler: Cron dropdown only shows Cron-type functions; other types filtered out
- Python version: only 3.9 is available; code using 3.10+ syntax or libraries that require newer Python will fail at runtime
- Java/Python development without CLI: no console editor for these languages; attempting console edit returns error or read-only view
- Deploying without `npm install` for Node.js: missing node_modules causes runtime import errors; run `npm install` in function directory before deploy
- Advanced I/O tested via serve: `catalyst functions:serve` only works for Basic I/O functions; Advanced I/O requires a deployed environment
