FILE_PURPOSE: Read when configuring HTTP method restrictions or authentication requirements for Basic I/O or Advanced I/O functions using Security Rules (the default, non-API-Gateway config).
TRIGGER_KEYWORDS: Security Rules, security-rules.json, methods, authentication required, authentication optional, Advanced I/O route security, API Gateway migration, function access control
SOURCE_DOC: help-docs/security-rules.md

TECHNICAL_CONSTRAINTS:
- Applies to: Basic I/O and Advanced I/O functions only — NOT Cron or Event functions (those cannot be directly invoked by users)
- Security Rules and API Gateway are MUTUALLY EXCLUSIVE: enabling API Gateway automatically disables Security Rules; cannot use both simultaneously
- When API Gateway is disabled, Security Rules definitions are enforced by default
- Security Rules can be migrated to API Gateway (not lossy — migration preserves configs)
- Default values on function creation: all 5 methods enabled, authentication = optional
- Authentication methods supported: Catalyst Users Auth (session-based) OR OAuth (Zoho-oauthtoken header)
- Advanced I/O: wildcard `.*` applies definitions to all routes; can define per-route configs individually

REQUIRED_PARAMETERS: Security Rules JSON structure:
```json
{
  "functions": {
    "FunctionName": {
      "methods": ["GET", "POST", "DELETE", "PUT", "PATCH"],
      "authentication": "optional"
    }
  },
  "advancedio": {
    "FunctionName": [
      {
        ".*": {
          "methods": ["GET", "POST"],
          "authentication": "required"
        }
      }
    ]
  }
}
```
- `methods` allowed values: `GET`, `POST`, `DELETE`, `PUT`, `PATCH`
- `authentication` allowed values: `optional`, `required`
- OAuth call header: `Authorization: Zoho-oauthtoken {token}`

UI_ONLY_ACTIONS:
- Edit Security Rules JSON: Console → Serverless → Functions → open function → Security Rules tab → edit JSON → Save
- Migrate to API Gateway: Console → API Gateway → Migrate Security Rules → follow migration wizard
- Note: Security Rules JSON can also be committed via CLI as part of project directory structure

CRITICAL_FAILURE_MODES:
- Enabling API Gateway without migrating: existing Security Rules configs are ignored once API Gateway is active — functions default to API Gateway rules; migrate first
- Authentication set to optional on sensitive function: function URL is globally accessible to anyone without auth — intentional but dangerous default; explicitly set to required for any function processing user-specific or sensitive data
- Removing a method from Security Rules: calls using that method return 403 silently; verify methods match what your frontend is using
- Configuring per-route on Advanced I/O without removing wildcard: if both `.*` and a specific route like `/vendor` exist, route-specific rule takes precedence for that route — wildcard applies to all others; order in array matters
