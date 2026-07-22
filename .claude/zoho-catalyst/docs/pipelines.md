FILE_PURPOSE: Read when setting up CI/CD with Catalyst Pipelines — creating pipelines, configuring catalyst-pipelines.yaml, connecting Git providers, or triggering deployments.
TRIGGER_KEYWORDS: Pipelines, catalyst-pipelines.yaml, CI/CD, pipeline stages, pipeline jobs, runners, pipeline images, artifacts, Git integration, pipeline trigger, pipeline YAML
SOURCE_DOC: help-docs/pipelines.md

TECHNICAL_CONSTRAINTS:
- Early Access — newer replacement for GitHub Integration (see docs/github-integration.md)
- Pipeline config defined in `catalyst-pipelines.yaml` file — this file drives all execution
- Git integration (optional): supports GitHub, GitLab, Bitbucket; pushing to linked repo auto-triggers pipeline
- Without Git integration: pipeline must be manually triggered from console each time
- Stages limit: max 5 stages per pipeline
- Jobs limit: max 5 jobs per stage
- Build artifacts: stored in Catalyst Stratus service (upload/download keys in YAML)
- SDK available (Java, Node.js, Python) for fetching pipeline details and executing pipelines programmatically
- Deployment targets supported: Catalyst AppSail, Amazon S3, Google Cloud Platform, Heroku, Microsoft Azure, Firebase, and others
- YAML file must be committed to the repo after every configuration change (when Git integration is active)

REQUIRED_PARAMETERS: YAML top-level keys:
- `version`: integer; pipeline version identifier
- `stages`: array; max 5; each stage contains jobs
- `jobs`: array per stage; max 5 per stage; each job contains steps/runners/images/variables
- `steps`: commands to run (build/test/deploy logic)
- `runners`: VM configuration (defined at pipeline, stage, or job level)
- `images`: Docker image or package set (name + registry URL + auth)
- `variables`: key-value pairs (pipeline or job level)
- `artifacts`: `upload` (store build ZIP in Stratus) + `download` (retrieve from Stratus)
- `notify`: `on-start` or `on-end` notifications per job
- `approve`: approval job config (type-name + reviewers email + message)
- Conditional keys: `when-equal`, `when-not`, `when-not-equal`, `when-and`, `when-or`, `pipeline-when`
- Pipeline-level: `pipeline-runner`, `pipeline-image`

UI_ONLY_ACTIONS:
- Create pipeline: Console → DevOps → Pipelines → Create Pipeline → enter name → optionally connect Git provider → Create
- Configure YAML (code editor): Console → Pipelines → open pipeline → code editor tab → edit YAML → Save / Save as Draft → Commit
- Configure YAML (visual builder): Console → Pipelines → open pipeline → Builder tab → drag-and-drop components → Generate → Add to Code
- Manually trigger pipeline: Console → Pipelines → open pipeline → Execute
- View execution history: Console → Pipelines → open pipeline → Execution History → Basic or Advanced tab
- Note: SDK available for programmatic pipeline execution and status retrieval

CRITICAL_FAILURE_MODES:
- Exceeding 5 stages or 5 jobs per stage: YAML validation fails at save/commit; restructure pipeline to stay within limits
- YAML not committed after changes (Git-linked pipeline): pipeline runs the old YAML version — changes are not picked up until committed
- Pipeline without Git integration and no manual trigger: pipeline never runs; must manually execute from console
- Build artifacts not configured: build outputs lost between jobs/stages if not explicitly uploaded to Stratus via `artifacts.upload` and retrieved via `artifacts.download`
- Registry auth missing for private images: pipeline fails at image pull step; add `auth` keys with username and password
- YAML syntax error (indentation, wrong keys): pipeline fails to parse; validate in console code editor before committing
