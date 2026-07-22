FILE_PURPOSE: Read when setting up automated API testing, configuring test cases with assertions, or scheduling test plans in Catalyst.
TRIGGER_KEYWORDS: Automation Testing, test case, test suite, test plan, assertions, Catalyst testing, API test, test module, test variables, Deluge connections auth
SOURCE_DOC: help-docs/automation-testing.md

TECHNICAL_CONSTRAINTS:
- Dev environment ONLY — Automation Testing console not accessible in Production; can test prod function URLs from dev environment
- NOT available in EU, AU, IN, CA data centers
- Hierarchy: Test Plan → Test Suite → Module → (Sub-module OR Test Cases, never both at same level in one module)
- Sub-modules: max 1 level deep — cannot nest sub-modules inside sub-modules
- Test case must always be inside a module; cannot exist at root level
- Module constraint: a module can contain EITHER test cases OR sub-modules, not both at the same level
- Assertions are OPTIONAL per request; no assertion = execution auto-marked as success
- Each individual request must pass for overall test case to pass
- Auth: only Custom Auth via Deluge Connections (no native Catalyst auth in test requests)
- Request methods supported: GET, PUT, POST, PATCH, DELETE, HEAD, OPTIONS

REQUIRED_PARAMETERS:
- Request config: URL (function URL, API Gateway URL, or third-party URL), HTTP method
- Variable syntax:
  - Environment/Global variables: `{{$<variable_name>}}`
  - Response-chained variables (from prior request): `{{<variable_name>}}`
- Assertion fields: Source (Header | Status Code | XML Body | JSON Body), Property (path/key), Comparison operator, Value
- Assertion comparison operators: Equals, Not Equals, Contains, Not Contains, Is Empty, Is Not Empty, Lesser Than, Greater Than, Lesser Than Or Equal To, Greater Than Or Equal To, Has Key, Array Count
- Status Code source: only supports Equals, Not Equals, Lesser Than, Greater Than, Lesser Than/Greater Than Or Equal To — NOT Contains, Is Empty, Has Key, Array Count
- Body types: form-data, x-www-form-urlencoded, raw (JSON)

UI_ONLY_ACTIONS:
- Enable Automation Testing: Console → DevOps → Automation Testing → Enable Now → Proceed
- Disable Automation Testing: Console → Automation Testing → ellipsis → Disable → type "DISABLE" → Yes, Proceed
- Create module: Console → Automation Testing → Test Cases → Create Test Case → type new module name in dropdown → Create
- Create test case: Console → Automation Testing → Test Cases → Create Test Case → name + select/create module → Create
- Add request to test case: open test case → Add Request → enter URL + method → configure Params/Auth/Headers/Body/Assertions tabs
- Add assertion: test case request → Assertions tab → Add Assertion → set Source/Property/Comparison/Value
- Create test suite: Console → Automation Testing → Test Suites → Create Test Suite → add modules/test cases → configure parallel or sequential execution
- Create test plan: Console → Automation Testing → Test Plans → Create Test Plan → add test suites → set schedule
- View test results: Console → Automation Testing → Results
- Configure environment variables: Console → Automation Testing → Variables → Environment tab
- Configure global variables: Console → Automation Testing → Variables → Global tab
- Note: All of Automation Testing is UI-only; no CLI or API for test management

CRITICAL_FAILURE_MODES:
- Modules with both test cases and sub-modules at same level: not allowed; test cases must go inside a sub-module or a separate module — adding both to same level is silently blocked or errors
- No assertion on a request = always passes, even on 500 errors — always add a Status Code assertion minimum
- Variable chaining between requests requires prior request to have executed and returned the variable key — order of request execution matters
- Has Key operator checks for key existence only; does not validate value — combine with Is Not Empty for presence + non-null check
- Array Count operator: value must be a number string; mismatch type will fail assertion
- Custom Auth via Deluge connections: connection must be pre-configured in Connections before test case creation; cannot create inline during test
- Testing production URLs from dev: responses reflect production data — mutations (POST/PUT/DELETE) affect live data
