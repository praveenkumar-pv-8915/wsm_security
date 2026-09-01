/**
 * Risk Reviewer — ported from the standalone compliancemanager tool's
 * `risk_manager/review/deterministic.py` (see risk-guidelines.md, this folder, for the guideline
 * text these rules encode — kept as its own file per that source: "keep the guidelines for review
 * as a separate file").
 *
 * Only the SCRIPTED rules made the crossing: G6, G7 (ISMS-scoped), G8, G9, G10, G19. The source
 * tool's other rules — G1–G5, G11–G13, G17–G18 (G15/G16 aren't checked by the source tool's
 * reviewer either) — are judged by an LLM prose review (risk_manager/review/registry_review.py,
 * `claude -p` against prompts/review_registry_risk.md). This app DOES have a server-callable LLM
 * path (connections-service.js's chatCompletion(), already used nowhere in risk-service.js yet) —
 * wiring the AI half up is a real, feasible follow-up, not blocked the way draftRisk/compareDpias
 * are. reviewGuidelines() is honest that it hasn't been wired up yet instead of faking a result for
 * rules it doesn't actually check — see PENDING_LLM_RULES below.
 *
 * Input shape (one risk): { risk_id, register, threat, statement, likelihood, impact, asset_value,
 * inherent_score, inherent_rating, residual_score, residual_rating, treatment,
 * control_description, raci_id }. `register` is this app's lowercase key (isms/pims/qms/bcms).
 */

const VALID_TREATMENTS = new Set(['Risk Modification', 'Risk Retention', 'Risk Avoidance', 'Risk Sharing']);
const REQUIRED_FIELDS = ['risk_id', 'threat', 'statement', 'likelihood', 'impact', 'treatment'];

// Every rule code this module can ever emit a finding for — used to know which rules are
// "implemented" (script-checkable) vs. still pending an LLM path, and to summarize a risk with no
// findings as an explicit pass on every rule that applied to it.
const IMPLEMENTED_RULES = ['G6', 'G7', 'G8', 'G9', 'G10', 'G19'];
// Matches the source tool's prompts/review_registry_risk.md exactly — note that doesn't include
// G15/G16 (ownership/mapping): those are [P] in the guideline doc but the source tool's own
// reviewer never actually checks them either, so they're not claimed as "pending" here.
const PENDING_LLM_RULES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G11', 'G12', 'G13', 'G17', 'G18'];

function finding(rule, riskId, severity, problem, suggestion) {
  return { rule, risk_id: riskId, severity, problem, suggestion, source: 'script' };
}

/** One risk (canonical shape above) -> a list of guideline findings (empty = nothing scripted flagged it). */
function checkRegistryRisk(risk) {
  const findings = [];
  const rid = risk.risk_id || '(no id)';
  const isIsms = risk.register === 'isms';

  // G6 — required fields; control description required for Risk Modification
  for (const field of REQUIRED_FIELDS) {
    const val = risk[field];
    if (val === null || val === undefined || val === '') {
      findings.push(finding('G6', rid, 'high', `Required field '${field}' is empty.`,
        `Fill in '${field}' in the register entry.`));
    }
  }
  if (risk.treatment === 'Risk Modification' && !risk.control_description) {
    findings.push(finding('G6', rid, 'high',
      'Treatment is Risk Modification but Description of the Control is empty.',
      'Describe the modifying control (or change the treatment option).'));
  }

  // G7 — official scales (ISMS only; other registers have their own scales)
  if (isIsms) {
    const scales = [['likelihood', 0, 3], ['impact', 0, 3], ['asset_value', 1, 4]];
    for (const [field, lo, hi] of scales) {
      const val = risk[field];
      if (val !== null && val !== undefined && !(val >= lo && val <= hi)) {
        findings.push(finding('G7', rid, 'high',
          `'${field}' is ${val}; the official scale is ${lo}-${hi}.`,
          `Re-rate '${field}' per the How-to-derive-a-risk guideline.`));
      }
    }
  }

  // G8 — inherent score arithmetic (per-register formula)
  const lk = risk.likelihood, im = risk.impact, sc = risk.inherent_score, av = risk.asset_value;
  if (lk !== null && lk !== undefined && im !== null && im !== undefined && sc !== null && sc !== undefined) {
    const expected = (isIsms && av) ? lk * im * av : lk * im;
    if (sc !== expected) {
      const formula = isIsms ? 'Likelihood x Impact x Asset Value' : 'Likelihood x Impact';
      findings.push(finding('G8', rid, 'medium',
        `Inherent score is ${sc} but ${formula} = ${expected}.`,
        'Recalculate the inherent score (or fix the input ratings).'));
    }
  }

  // G9 — ISMS rating bands (1-12 Low, 13-24 Medium, 25-36 High; 0 counts Low)
  if (isIsms) {
    const band = (score) => (score <= 12 ? 'Low' : score <= 24 ? 'Medium' : 'High');
    const pairs = [
      [risk.inherent_score, risk.inherent_rating, 'inherent'],
      [risk.residual_score, risk.residual_rating, 'residual'],
    ];
    for (const [score, rating, kind] of pairs) {
      if (score !== null && score !== undefined && rating && rating !== band(score)) {
        findings.push(finding('G9', rid, 'medium',
          `${kind} rating is '${rating}' but score ${score} falls in the '${band(score)}' band ` +
          '(1-12 Low / 13-24 Medium / 25-36 High).',
          'Align the rating with the official band for the score.'));
      }
    }
  }

  // G9 — residual vs inherent; pending residual assessment
  const res = risk.residual_score;
  if (res !== null && res !== undefined && sc !== null && sc !== undefined && res > sc) {
    findings.push(finding('G9', rid, 'high',
      `Residual score (${res}) exceeds inherent score (${sc}).`,
      'Treatment cannot increase a risk — re-rate the revised scores.'));
  }
  if (!risk.residual_rating) {
    findings.push(finding('G9', rid, 'info',
      'Residual assessment pending (no revised risk rating).',
      'Complete the revised assessment after treatment.'));
  }

  // G10 — treatment vocabulary
  if (risk.treatment && !VALID_TREATMENTS.has(risk.treatment)) {
    findings.push(finding('G10', rid, 'medium',
      `Treatment '${risk.treatment}' is not one of ${[...VALID_TREATMENTS].sort().join(', ')}.`,
      'Pick a valid treatment option.'));
  }

  // G19 — RACI record mapped (registers that carry the field: ISMS/PIMS/BCMS)
  if (['isms', 'pims', 'bcms'].includes(risk.register) && !risk.raci_id) {
    findings.push(finding('G19', rid, 'medium',
      'No RACI record is mapped to this risk.',
      'Refer to the RACI matrix and map the appropriate RACI ID ' +
      '(the risk owner then follows the RACI accountable person).'));
  }

  return findings;
}

/**
 * Reduce one risk's findings to a per-rule pass/fail summary in the [[code, 'pass'|'fail'], ...]
 * shape the Risk Register UI already renders (see RiskRegister.jsx's Guideline review pills).
 * A rule only appears if it actually applied to this risk (mirrors checkRegistryRisk's own
 * conditionals — e.g. G7 never applies outside ISMS, so it's omitted rather than forced to pass).
 */
function summarizeChecks(risk, findings) {
  const failedRules = new Set(findings.map(f => f.rule));
  const applicable = ['G6', 'G8', 'G10']; // always evaluated above, register-agnostic
  if (risk.register === 'isms') applicable.push('G7', 'G9');
  else if (['pims', 'bcms'].includes(risk.register)) applicable.push('G19');
  if (risk.register === 'isms') applicable.push('G19');
  // G9's "residual pending" / "residual > inherent" checks run for every register, not just ISMS.
  if (!applicable.includes('G9')) applicable.push('G9');
  return [...new Set(applicable)].map(code => [code, failedRules.has(code) ? 'fail' : 'pass']);
}

module.exports = { checkRegistryRisk, summarizeChecks, IMPLEMENTED_RULES, PENDING_LLM_RULES, VALID_TREATMENTS };
