FILE_PURPOSE: Read when deploying Catalyst projects from a GitHub repository or synchronizing GitHub changes to the Catalyst console.
TRIGGER_KEYWORDS: GitHub integration, Git repository, GitHub deploy, catalyst.json, sync repository, revoke GitHub, Pipelines alternative
SOURCE_DOC: help-docs/github-integration.md

TECHNICAL_CONSTRAINTS:
- Availability: only for Catalyst users active before July 2024 OR who have already integrated GitHub; new users should use Catalyst Pipelines instead
- Repository must be in standard Catalyst project directory structure with `catalyst.json` at root
- Default branch of the repository is what gets deployed (not selectable during deploy)
- Only one repository can be deployed at a time — simultaneous deploys not supported; wait for first to complete before starting next
- Sync only works on a previously deployed repository (not new repos)
- All operations are console-only; no CLI equivalent for GitHub integration management

REQUIRED_PARAMETERS:
- `catalyst.json`: must be present in the root of the repository's default branch
- Standard project directory structure: `functions/` for function code, `client/` for web/mobile app assets
- GitHub account: must be authenticated via OAuth (Authorize ZohoCorporation)

UI_ONLY_ACTIONS:
- Integrate GitHub account: Console → DevOps → Repositories → Git → Integrate GitHub → Agree to terms → Sign in to GitHub → Authorize ZohoCorporation
- Integrate via Settings: Console → Settings icon → General Settings → Integrations → GitHub tile → Add Account
- Deploy repository: Console → DevOps → Repositories → Git → select repository → Deploy → Deploy (confirm)
- Sync repository: Console → DevOps → Repositories → Git → Deployed Repository status bar → Sync
- Revoke GitHub access: Console → Settings → General Settings → Integrations → GitHub → ellipsis → Revoke → Revoke

CRITICAL_FAILURE_MODES:
- Deploying without `catalyst.json`: deployment fails; functions and client are not reflected in console
- Repository not in standard structure: deploy completes but Functions and Web Client Hosting show nothing; silent structure mismatch
- Simultaneous deployment attempt: blocked; second deploy button is inactive until first completes
- New Catalyst user using GitHub Integration instead of Pipelines: feature may not be available; Catalyst will prompt to use Pipelines instead
- After revoking GitHub access: repositories are no longer visible in GitHub Integration page; must re-integrate to restore access
