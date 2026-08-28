/**
 * Ask — a first slice of compliancemanager's query_handler ("compliance Q&A") ported into the
 * Welcome app.
 *
 * compliancemanager's `query "<question>"` reasons via the `claude -p` CLI, grounded in the active
 * product's package, common links, fetched snapshots and the risk guidelines, and returns a cited
 * answer. There is no server-callable equivalent wired up yet — see the "LLM steps" open question
 * in claude/compliancemanager-integration-design.md.
 *
 * Until that's decided, this answers a small fixed set of demo questions (the same ones used in the
 * design) with a canned, cited response, and returns an honest "not grounded yet" message for
 * anything else. Replace DEMO_QA + the fallback with a real call once the LLM path exists — do not
 * build more product logic on top of this stub.
 */

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

/** POST /api/ask — body: { question }. Read-only; never writes anything. */
function answerQuestion(question) {
  const q = String(question || '').trim();
  if (!q) {
    const err = new Error('question is required');
    err.status = 400;
    throw err;
  }
  const hit = DEMO_QA[q.toLowerCase()];
  if (hit) return { success: true, question: q, ...hit };
  return {
    success: true,
    question: q,
    answer: 'Not grounded yet — Ask only answers a small set of demo questions until the real ' +
      'query_handler LLM path is wired up (see claude/compliancemanager-integration-design.md).',
    citations: [],
    sources: [['Product package', 'log360-cloud']],
  };
}

module.exports = { answerQuestion };
