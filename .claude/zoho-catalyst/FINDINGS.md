# Catalyst Skill — Findings Queue

Discoveries made during real usage sessions that may improve this skill.
Status pipeline: **PENDING** → **VERIFIED** → **PROMOTED** (added to SKILL.md or gotchas-extended.md).

---

## How to add a finding

1. Copy the template below into the **Pending Findings** section
2. Fill in what you found and how to reproduce it
3. Set status to `PENDING`
4. @mention the team in Cliq if it seems critical or blocks deployment
5. Once verified (you've reproduced it deliberately), update status to `VERIFIED`
6. At session end, promoted findings move to the appropriate section in SKILL.md or gotchas-extended.md

```markdown
### [YYYY-MM-DD] Summary of finding

| Field | Value |
|---|---|
| **Status** | PENDING |
| **Date** | YYYY-MM-DD |
| **Found by** | name |
| **Category** | gotcha / pattern / outdated-doc / limit |
| **Summary** | One sentence describing what was unexpected |
| **Reproduction** | Steps or code that triggers this |
| **Fix / Pattern** | What to do instead |
| **Promoted to** | *(fill when promoted)* |
```

---

## Pending Findings

*(none yet)*

---

## Verified Findings

*(none yet)*

---

## Promoted Findings

| Date | Summary | Category | Promoted To |
|---|---|---|---|
| 2026-02-11 | ZCQL SELECT silently returns max 300 rows with no error | gotcha | SKILL.md #1 |
| 2026-02-11 | `catalyst deploy` replaces all env vars from catalyst-config.json, wiping console-set secrets | gotcha | SKILL.md #2 |
| 2026-02-10 | `/oauth/v2/userinfo` does not return email; must use `/oauth/user/info` | gotcha | SKILL.md #3 |
| 2026-02-11 | Missing `"functions"` in catalyst.json → silent deploy with function missing | gotcha | SKILL.md #4 |
| 2026-03-19 | No ignore mechanism for client deploy → ZIPSANITIZER_FILES_COUNT_EXCEEDED | gotcha | SKILL.md #5 |
| 2026-02-10 | Zoho userinfo returns capitalized field names (Email, First_Name, Last_Name) | gotcha | gotchas-extended.md |
| 2026-02-11 | Missing package.json in function directory → deploy silently skipped | gotcha | gotchas-extended.md |
| 2026-02-10 | `require('express')` crashes on blank template (no node_modules) | gotcha | gotchas-extended.md |
| 2026-02-10 | `http.createServer().listen()` causes EADDRINUSE on warm starts | gotcha | gotchas-extended.md |
| 2026-02-10 | SameSite=Strict blocks OAuth redirect cookie cross-site | gotcha | gotchas-extended.md |
| 2026-02-10 | Set-Cookie + Location must be in a single writeHead call | gotcha | gotchas-extended.md |
| 2026-02-11 | zcatalyst-sdk-node v4 does not exist (latest: 3.1.1) | gotcha | gotchas-extended.md |
| 2026-02-11 | catalyst.initialize(req) vs catalyst.initializeApp({}) — wrong context causes silent auth failure | gotcha | gotchas-extended.md |
