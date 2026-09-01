# Risk Definition Guidelines — Compliance Management registers

## 0. Definitions (official)

- **Risk** — "the potential that threats will exploit vulnerabilities of an information asset or
  group of information assets and thereby cause harm to an organization"; expressed as a
  combination of the **consequences** of an event (impact) and the associated **likelihood** of
  occurrence.
- **Vulnerability** — "weakness of an asset or control that can be exploited by one or more
  threats."
- **Threat** — "potential cause of an unwanted incident, which can result in harm to a system or
  organization."

## 1. Risk identification & statement structure

- **G1 [Z/U][P]** — Every risk names its **Threat** and **Vulnerability** (and the **Issue** where
  applicable), and the **Risk** text is a distinct statement derived from them ("any risk
  identified will have threats and vulnerability"). Each of issue / threat / vulnerability must be
  **valid and brief** — a specific, concise phrase, not boilerplate, not a paragraph, and not a
  copy of one of the other fields.
- **G2 [Z][P]** — The Risk text states the **consequence/harm** (loss of confidentiality,
  integrity or availability, or harm to the organization / data subjects) — impact and likelihood
  are what get scored, so the harm must be identifiable from the statement.
- **G3 [Z][P]** — A risk arises from at least one of the five identification factors: threats &
  vulnerabilities; internal/external issues; requirements of interested parties; assets;
  incidents. **Incident-based risks must carry the Incident ID and the incident link** (RCA /
  incident-tool link).
- **G4 [T][P]** — One risk per entry, so it can be rated and treated separately.
- **G5 [T][P]** — No mitigation text inside the Risk statement — controls belong in *Description
  of the Control*.

## 2. Scoring & required fields (ISMS scheme per the article)

- **G6 [Z][S]** — Every entry must have: `Risk_ID`, `Threat`, `Risk`, `Likelihood`, an impact
  score, `Risk_Treatment_Options`, and — when the treatment is *Risk Modification* — a non-empty
  *Description of the Control* (modification also requires testing the control's effectiveness and
  deriving the revised score).
- **G7 [Z][S — ISMS]** — Scales: impact on each of C / I / A is **0–3**, and **Impact = Max(C, I,
  A)**; **Likelihood 0–3** (0 never, 1 once a year, 2 once in 6 months, 3 once a month); **Asset
  Value 1–4** (1 Low, 2 Medium, 3 High, 4 Very High; currently infrastructure = 4 and everything
  else = 3).
- **G8 [Z][S]** — **Inherent Risk Score = Impact × Likelihood × Asset Value** (ISMS; range 1–36).
  The other registers' apps compute Likelihood × Impact.
- **G9 [Z][S — bands ISMS-only]** — Rating bands: **1–12 Low, 13–24 Medium, 25–36 High** (score 0
  counts as Low). The revised (residual) score — recalculated after applying controls — must be
  **≤ the inherent score**, and an entry with no residual rating is *pending assessment*.
- **G10 [Z][S]** — Treatment is one of: **Risk Modification** (recommended), **Risk / Control
  Transfer (Sharing)** (risk or control owned by another team), **Risk Avoidance** (terminate the
  activity), **Risk Retention** (accept). Untreated / shared / avoided risks are classified *Risk
  evaluation in progress* pending further analysis.

## 3. Language quality (tool-added)

- **G11 [T][P]** — Grammar and spelling are correct; sentences are complete.
- **G12 [T][P]** — Plain, precise wording: no vague quantifiers, no unexplained abbreviations, no
  filler.
- **G13 [T][P]** — Written in third person, present/future tense.

## 4. DPIA ↔ registry coverage (tool-added)

- **G14 [T][S/P]** — Every risk recorded in a DPIA document's RISK AND CONTROL table must be
  covered by a register entry. DPIA tables carry no register IDs, so coverage is judged
  semantically; a DPIA risk with no covering entry is a **coverage gap** to be registered. Not
  implemented in this app — see `compareDpias` in risk-service.js (stubbed 501, same as
  `draftRisk`).

## 5. Ownership & mapping (official)

- **G15 [Z][P]** — Risk owner: process/activity risks take the RACI activity's accountable person
  (automatic); product-feature risks name the owner manually; risks tied to both follow the RACI
  accountable person.
- **G16 [Z][P]** — Map the relevant **interested parties** (keep only the needs/expectations
  applicable to the specific risk), the **Asset ID** from the asset register, and the **product
  feature / RACI activity** the risk belongs to.

## 6. Controls & RACI (compliance-owner mandated)

- **G17 [U][P]** — The described control must be **reasonable**: it plausibly mitigates the stated
  risk, is proportionate to it, and is concrete enough to be implemented and tested. "User is
  informed via help documentation" is not a reasonable control for a technical exploitation risk.
- **G18 [U][P]** — The selected **ISO controls** (and other regulatory / CCM controls) must
  **match the control description** — the description should be an instance of what those control
  clauses require. Judged only where ISO/CCM controls are recorded (ISMS, PIMS).
- **G19 [U][S]** — The **RACI matrix must be referred** and the appropriate RACI record mapped on
  every risk (registers that carry the field: ISMS, PIMS, BCMS). The risk owner then follows the
  RACI accountable person per G15.

## References

- Official guideline article (source of the [Z] rules):
  <https://learn.zoho.in/portal/zohocorp/team/zoho-compliance/manual/clause-and-control-guidelines/article/how-to-derive-a-risk>
- Interested parties register (map relevant parties per G16):
  <https://app.zohocreator.in/zohointranet/risk-assessment/#Report:All_Interested_Parties>
- Asset registration report (Asset IDs and values per G7/G16):
  <https://app.zohocreator.in/zohointranet/risk-assessment#Report:Asset_Registration_Report>
- NIST mobile threat catalogue (threat reference):
  <https://pages.nist.gov/mobile-threat-catalogue/>
- ISO 27002:2022 control attributes (control type, security properties, cybersecurity concepts,
  operational capabilities, security domains) are auto-mapped per selected ISO control in the risk
  form.
