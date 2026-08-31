/**
 * Ask — a first slice of compliancemanager's query_handler ("compliance Q&A") ported into the
 * Welcome app.
 *
 * compliancemanager's `query "<question>"` reasons via the `claude -p` CLI, grounded in the active
 * product's package, common links, fetched snapshots and the risk guidelines, and returns a cited
 * answer. That server-callable LLM path now exists — connections-service.js's chatCompletion(),
 * backed by the zoho-platformai connection (see claude/compliancemanager-integration-design.md,
 * now resolved).
 *
 * Full parity with compliancemanager would ground answers in every manager's snapshot (RACI, DMS,
 * product docs, ...) — none of those sync paths exist in this app yet. What's real today is the
 * risk register (`compliance_risks`), so that's what grounds this: the current risks are summarised
 * into the model's context, and it's told plainly not to claim knowledge of anything else. This is
 * honest but narrower than the original tool — expand the context section as more managers land.
 *
 * Falls back to the old canned DEMO_QA + "not grounded yet" behaviour when no zoho-platformai
 * connection is configured, rather than hard-failing the whole page — Ask should degrade, not break,
 * for a caller who hasn't set up AI yet.
 */

const { chatCompletion, AiUnavailable } = require('./connections-service');
const { listRisks } = require('./risk-service');

const DEMO_QA = {
  'which iso standards do our registers cover?': {
    answer: 'The four registers map to ISO/IEC 27001 (ISMS), ISO/IEC 27701 (PIMS), ISO 9001 (QMS) ' +
      'and ISO 22301 (BCMS). Coverage is current as of the last fetch.',
    citations: [
      'product.yaml — compliance_team_name, standards list',
      'registry.yaml — common ManageEngine compliance links',
    ],
    sources: [['Product package', 'log360-cloud'], ['Guidelines', 'RISK_GUIDELINES.md']],
  },
  'what open risks are flagged critical right now?': {
    answer: 'One critical risk is currently open: PIMS-031 (notification emails stored unencrypted ' +
      'in history table), also flagged by DPIA-2026-07 as missing from the register at the time it ' +
      'was reviewed.',
    citations: ['risk_manager snapshot — data/risks.json', 'risk_manager/results/coverage — DPIA comparison'],
    sources: [['Risk snapshot', 'synced 2h ago'], ['DPIA coverage report', 'synced 2h ago']],
  },
  'which modules are missing from the raci matrix?': {
    answer: 'Five modules documented in the product help pages have no corresponding row in the ' +
      'RACI matrix: Notifications, Backup & Recovery, Release Process, Disaster Recovery and ' +
      'Credential Management.',
    citations: ['raci_manager snapshot — data/raci.json', 'product help doc — compare_raci diff'],
    sources: [['RACI snapshot', 'synced 2h ago'], ['Product help doc', 'live diff']],
  },
};

const NOT_GROUNDED = q => ({
  success: true,
  question: q,
  answer: 'Not grounded yet — Ask only answers a small set of demo questions until AI is configured ' +
    '(Connections -> Zoho PlatformAI) or the real query_handler grounding is fully wired up.',
  citations: [],
  sources: [['Product package', 'log360-cloud']],
});

/** Builds the grounding context handed to the model as `context`, not a user-visible message. */
function buildContext(risks) {
  const lines = risks.map(r =>
    `- ${r.risk_id} [${r.register.toUpperCase()}, ${r.severity}, status=${r.status}] ${r.title}` +
    (r.description ? ` -- ${r.description}` : '')
  );
  const registerText = lines.length ? lines.join('\n') : '(no risks currently on file)';
  return [
    'You are answering a compliance question for the WSM Security team, grounded ONLY in the risk',
    'register data below. Do not invent RACI matrices, DPIA documents, or product package details --',
    'this app does not yet sync those, so you have no real information about them. If the question',
    "needs something outside the risk register, say plainly that it isn't covered by what's synced",
    'here yet, rather than guessing.',
    '',
    'Current risk register:',
    registerText,
    '',
    'Answer in 2-4 sentences. After the answer, on a new line, list the RISK_IDs your answer relies',
    'on as a comma-separated CITATIONS: line (e.g. "CITATIONS: PIMS-031, ISMS-014"), or',
    '"CITATIONS: none" if the register was not needed to answer.',
  ].join('\n');
}

/** Split the model's "<answer>\n\nCITATIONS: X, Y" convention back into the two parts. */
function splitCitations(text) {
  const match = text.match(/CITATIONS:\s*(.*)\s*$/i);
  if (!match) return { answer: text.trim(), citations: [] };
  const answer = text.slice(0, match.index).trim();
  const list = match[1].trim();
  const citations = /^none$/i.test(list) ? [] : list.split(',').map(s => s.trim()).filter(Boolean);
  return { answer, citations };
}

/** POST /api/ask -- body: { question }. Read-only; never writes anything. */
async function answerQuestion(req, question) {
  const q = String(question || '').trim();
  if (!q) {
    const err = new Error('question is required');
    err.status = 400;
    throw err;
  }

  const hit = DEMO_QA[q.toLowerCase()];
  if (hit) return { success: true, question: q, ...hit };

  try {
    const { risks } = await listRisks(req, {});
    const { text } = await chatCompletion(req, {
      prompt: q,
      context: buildContext(risks),
    });
    const { answer, citations } = splitCitations(text);
    return {
      success: true,
      question: q,
      answer: answer || 'The model returned an empty answer.',
      citations,
      sources: [['Risk register', `${risks.length} risk(s) synced`]],
    };
  } catch (e) {
    if (e instanceof AiUnavailable) return NOT_GROUNDED(q);
    // A configured-but-failing call (bad portal_id, expired token, gateway error, timeout, ...) is
    // still worth surfacing distinctly from "not grounded yet" -- the difference between "you
    // haven't set this up" and "this is broken" matters for whoever's debugging it.
    const err = new Error(`AI is configured but the call failed: ${e.message}`);
    err.status = 502;
    throw err;
  }
}

module.exports = { answerQuestion };
