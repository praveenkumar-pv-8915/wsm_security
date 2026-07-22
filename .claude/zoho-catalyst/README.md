# zoho-catalyst — Catalyst Development Skill

The team's canonical Claude Code skill for building on Zoho Catalyst. This is also the **reference implementation** for the entire `zoho-skills` library — if you're building a new product skill, use this as your worked example alongside `STANDARDS.md`.

---

## What this is

A Claude Code skill that gives Claude deep, production-grade knowledge of the Zoho Catalyst serverless platform. It covers all 7 function types, all 3 SDK languages (Node.js, Python, Java), the full platform component set (31 distilled doc files), and team-authored references on deployment, OAuth, Data Store patterns, pricing, and platform equivalents.

The skill was built from four sources, consolidated here as the single source of truth:
- **Team's production experience** — 13 verified gotchas, OAuth/deployment/datastore patterns from real shipping code
- **Catalyst team's official skill** — industry equivalents, meta IDs, pricing, and SDK code templates (shipped April 15, 2026)
- **Zach's skill** — credit optimization framing, anti-patterns table, cache helper (archived in `applied-ai/scratch/`)
- **Applied AI learning runs** — 3 learning run outputs (April 2026) that produced the docs/ layer

---

## How it works (3-level loading)

Claude Code loads skills in three levels. Understanding this explains every architectural decision here.

```
Level 1 — Always loaded (~100 tokens):
  name + description from SKILL.md frontmatter
  This is the ONLY activation trigger. No triggers: field exists.

Level 2 — On invocation (≤500 lines):
  Full SKILL.md body
  Contains: routing table, top 5 gotchas, architecture defaults,
  deprecation table, credit optimization, quick references

Level 3 — On demand (per explicit Read call):
  Reference files in references/ and docs/
  Loaded ONLY when routing table says "read this file"
  Never preloaded — this is the progressive disclosure mechanism
```

**The routing table in SKILL.md is the progressive disclosure engine.** It maps task types to the right Level 3 file so Claude loads only what's relevant, never the whole library at once.

---

## File map

### Core skill files

| File | Purpose |
|------|---------|
| `SKILL.md` | Entry point: description trigger, 5-section routing table, top 5 gotchas, architecture defaults, deprecation table, credit optimization, quick references |
| `FINDINGS.md` | Compounding learning staging area: PENDING → VERIFIED → PROMOTED pipeline |
| `DISTILLATION_RULES.md` | Governs how `docs/` entries are created, structured, and updated |
| `README.md` | This file |

### Team-authored references (`references/`)

| File | What it contains |
|------|-----------------|
| `oauth.md` | Zoho OAuth login end-to-end — auth URL construction, token exchange, session management |
| `deployment.md` | Deploy workflow — Slate, Web Client, env vars, build scripts, ZIPSANITIZER workarounds |
| `datastore-sdk.md` | Data Store SDK init, ZCQL queries, credentials, pagination gotcha |
| `sync-connectors.md` | CRM ↔ Creator bidirectional sync — bidirectional write patterns |
| `console-navigation.md` | Console click-paths for hard-to-find UI (Job Scheduling, Cron, Job Pool) |
| `gotchas-extended.md` | Additional gotchas beyond top 5 — OAuth edge cases, code-level traps, cache patterns |
| `industry-equivalents.md` | AWS/GCP/Azure/Vercel/Netlify/Supabase/Firebase → Catalyst equivalents mapping |
| `meta-ids.md` | Every Catalyst ID explained — what it is, where to find it in the console |
| `pricing.md` | Billing model, free tier limits, cost estimation, spreadsheet generation guide |
| `functions-and-sdk.md` | Code templates for all 7 function types in Node.js, Python, and Java |
| `cloud-scale.md` | Data Store / Cache / Auth code patterns — working sample code |
| `services.md` | AppSail / Circuits / Signals / Slate / SmartBrowz / Job Scheduling code patterns |
| `project-and-cli.md` | Complete CLI command reference, project structure, environments |

### Distilled official docs (`docs/`)

31 condensed files — one per Catalyst platform component. Each file contains limits, parameters, and failure modes distilled from official documentation. Files: `api-gateway.md`, `apm.md`, `application-alerts.md`, `authentication.md`, `automation-testing.md`, `cache.md`, `circuits.md`, `connections.md`, `cron.md`, `data-store.md`, `domain-mappings.md`, `event-listeners.md`, `file-store.md`, `functions.md`, `getting-started.md`, `github-integration.md`, `job-scheduling.md`, `logs.md`, `mail.md`, `metrics.md`, `mobile-device-management.md`, `pipelines.md`, `push-notifications.md`, `quickml.md`, `search-integration.md`, `security-rules.md`, `slate.md`, `smartbrowz.md`, `stratus.md`, `web-client-hosting.md`, `zcql.md`

---

## How to install

Copy or symlink the skill directory into your Claude Code skills folder:

```bash
# Option A: copy (standalone)
cp -r ~/dev-zoho/zoho-skills/skills/zoho-catalyst ~/.claude/skills/

# Option B: symlink (stays in sync with repo updates)
ln -s ~/dev-zoho/zoho-skills/skills/zoho-catalyst ~/.claude/skills/zoho-catalyst
```

After copying, restart Claude Code (or start a new session) for the skill to appear.

---

## Trigger examples

These prompts activate this skill (not exhaustive):

1. "Write a Catalyst function that queries the Data Store and caches results"
2. "Deploy my Catalyst project — getting ZIPSANITIZER error"
3. "How does Catalyst pricing work for 1M function invocations?"
4. "I need something like AWS Lambda and S3 but in Zoho — what do I use?"
5. "What's my Table ID and where do I find it in the console?"
6. "Set up Zoho OAuth login in a Catalyst Advanced I/O function"
7. "Generate a pricing spreadsheet for our Catalyst app"
8. "Write the same function in Python instead of Node.js"
9. "My catalyst deploy says successful but the function is missing"
10. "Set up an AppSail service with Express that connects to Data Store"

---

## How to contribute — compounding learning

When you hit something unexpected during development, add it to `FINDINGS.md` so the skill improves over time.

**Pipeline:**

```
Hit unexpected behavior
  → Add to FINDINGS.md with status PENDING
  → Deliberately reproduce it (verify the finding)
  → Update status to VERIFIED with reproduction steps
  → Promote: move content to SKILL.md (if top-5 severity) or gotchas-extended.md
  → Update status to PROMOTED with destination reference
  → Update FINDINGS.md Promoted Findings table
```

**What qualifies as a finding worth adding:**
- Silent failures (no error, wrong behavior)
- Debugging time > 30 minutes on a non-obvious issue
- Official docs that are wrong or misleading
- Patterns that work better than the documented approach
- Hard limits discovered through production use

**What not to add:**
- General programming mistakes (not Catalyst-specific)
- Issues already in SKILL.md or gotchas-extended.md
- Things in the official docs that worked as documented

---

## Building new product skills

This skill is the reference implementation for the `zoho-skills` architecture. To build a new skill:

1. Read `STANDARDS.md` at the repo root — it defines the layer contract, naming rules, SKILL.md format, and description writing rules
2. Use this skill's structure as the worked example:
   - `SKILL.md` = thin entry point with routing table and critical inline gotchas only
   - `references/` = team-authored guides (patterns, gotchas, working code)
   - `docs/` = distilled official docs (limits, params, failure modes)
   - `DISTILLATION_RULES.md` = governs how docs/ entries are created
   - `FINDINGS.md` = compounding learning staging area
3. Description is the ONLY activation trigger — there is no `triggers:` field
4. Follow the three-level loading model: description (100 tokens) → SKILL.md (≤500 lines) → references on demand

Current skills in the library using this architecture: `zoho-cliq`, `zoho-crm`, `zoho-mail`, `zoho-calendar`, `zoho-workdrive`, `zoho-desk`, `zoho-compliance-assistant`
