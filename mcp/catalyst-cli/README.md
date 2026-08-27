# catalyst-cli MCP server

Exposes a curated, **non-interactive** subset of the Zoho Catalyst CLI as MCP tools (stdio).
It shells out to the `catalyst` binary already installed and logged in on this Mac, with
`cwd` = repo root so `.catalystrc` / `catalyst.json` apply.

## Tools

| Tool | Wraps | Notes |
|---|---|---|
| `catalyst_whoami` | `whoami` | read-only |
| `catalyst_project_list` | `project:list` | read-only |
| `catalyst_apig_status` | `apig:status [--previous]` | read-only |
| `catalyst_deploy` | `.claude/skills/deploy/deploy.sh` | detect/deploy targets, verify, push (never force) |
| `catalyst_functions_config` | `functions:config <fn> [--memory]` | |
| `catalyst_ds_export` | `ds:export --table …` | starts a job; poll with `ds_status` |
| `catalyst_ds_import` | `ds:import <csv> --table …` | **writes data** |
| `catalyst_ds_status` | `ds:status import\|export [jobId]` | |
| `catalyst_iac_export` | `iac:export` | zip into repo root (gitignored) |
| `catalyst_pull` | `pull <feature> [--resource] [--overwrite]` | can clobber local files with `overwrite` |

Not exposed on purpose: `login`/`logout`/`token:*`, `functions:delete`, `client:delete`,
`project:reset`, `iac:import`, `serve`, `functions:shell`, `init`/`functions:add`/`client:setup`.
There is no CLI or API for function **logs**, so none is offered.

## Setup

```bash
cd mcp/catalyst-cli && npm install
```

The repo's `.mcp.json` registers the server for Claude Code sessions opened in this repo:

```json
{ "mcpServers": { "catalyst-cli": { "command": "node", "args": ["mcp/catalyst-cli/server.js"] } } }
```

For other MCP clients, run `node <repo>/mcp/catalyst-cli/server.js` over stdio. Set `CATALYST_BIN`
if the `catalyst` binary is not on `PATH`.

## Smoke test

```bash
npm run smoke                                            # lists tools, calls catalyst_whoami
node smoke.js catalyst_deploy '{"dryRun":true}'          # any tool + JSON args
```

## Requirements

Runs only where `zcatalyst-cli` (≥1.27) is installed and logged in — this Mac. Not usable from a
cloud sandbox.
