# Help Doc Distillation Rules

Used to convert raw Catalyst help docs (`help-docs/*.md`) into compressed reference nodes in `docs/`.

## Node Template

Every file must follow this exact structure:

```
FILE_PURPOSE: [One sentence — exactly when an LLM should read this file]
SOURCE_DOC: help-docs/[filename].md
TRIGGER_KEYWORDS: [5–10 highly specific keywords]

TECHNICAL_CONSTRAINTS:
- Hard limits, auth methods, hard caps, data center restrictions, env restrictions

REQUIRED_PARAMETERS:
- Exact parameter names, expected types, payload structures, endpoint paths

UI_ONLY_ACTIONS:
- Actions with no CLI or API equivalent — console navigation path only
- Format: Console → Section → Subsection → Action → Confirm
- Include a Note: line clarifying what IS available via CLI/API

CRITICAL_FAILURE_MODES:
- Non-obvious errors, silent failures, and how to resolve them
```

## Distillation Rules

1. **LLM-optimized output** — no conversational prose, no UI tutorials beyond UI_ONLY_ACTIONS, no marketing copy ("benefits", "why this is great"). Retain only hard limits, required parameters, payload structures, non-obvious behaviors, and error states.

2. **Preserve exact terminology** — keep all internal variable names, endpoint paths, SDK method names, and proprietary acronyms exactly as documented. Do not generalize (e.g., keep `ZCFKEY`, `zcatalyst-sdk-node`, `catalystserverless`, `generateAuthToken`).

3. **Length cap: 50–150 lines per file** — be brutal with cuts. If a section only adds value for console navigation (click-through tutorials), it belongs in UI_ONLY_ACTIONS or gets dropped.

4. **UI_ONLY_ACTIONS are required** — any action that has no CLI command and no API/SDK equivalent must be preserved as a navigation path. This is the one exception to cutting console instructions. Format as single-line paths, not prose.

5. **Avoid duplication with references/** — if a topic is already deeply covered in `references/oauth.md`, `references/datastore-sdk.md`, etc., the `docs/` node should point there rather than re-document it.

6. **Routing table** — after each file is created, append its path and TRIGGER_KEYWORDS to the Official Docs section of `SKILL.md`.

## Source Files

Raw help docs live in `help-docs/*.md`. These were scraped from docs.catalyst.zoho.com and pre-cleaned (metadata blocks removed, HTML entities decoded, Hugo shortcodes converted).

## Batch Protocol

Process in batches of 5. After each batch, output a status checklist before proceeding.
