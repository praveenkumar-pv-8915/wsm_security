import { useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Draft new risk — its own Compliance Manager sub-tab (moved out of Risk Register, item 3 of
 * claude/compliancemanager-integration-design.md's "Requested Risk Register UI changes").
 *
 * Mirrors compliancemanager's `risk draft_risk`. The reviewer describes the risk in their own
 * words (a free-text statement is the required input); POST /api/risks/draft turns that into one
 * complete, guideline-compliant candidate risk register entry via connections-service.js's
 * chatCompletion() (see risk-service.js's draftRisk()) — grounded in that statement, the current
 * register snapshot (for style/dedupe context) and risk-guidelines.md, then self-checked against
 * risk-review.js's scripted rules. Nothing is ever written back to Creator or compliance_risks
 * from this screen.
 */
export default function DraftRisk() {
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const draft = async () => {
    const text = statement.trim();
    if (!text) {
      setError('Describe the risk first — the draft is built from what you write here.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await api('/risks/draft', { method: 'POST', body: { statement: text } });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Drafting a risk failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Draft new risk</h2>
          <p className="view-sub">Describe a risk in your own words and have Compliance Manager turn it into a candidate risk register entry for review.</p>
        </div>
      </div>

      <section className="card">
        <div className="form-grid">
          <label className="span-full">
            <span>Describe the risk</span>
            <textarea
              rows={5}
              placeholder="e.g. Our new API integration accepts a user-supplied callback URL with no allowlist, so a malicious caller could reach internal services."
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        <div className="form-foot">
          <span className="hint">Nothing is written to Creator — this only prepares a draft.</span>
          <button className="btn btn-primary" onClick={draft} disabled={busy || !statement.trim()}>
            {busy ? 'Drafting…' : '＋ Draft new risk'}
          </button>
        </div>
      </section>

      <section className="card">
        {error && <div className="banner banner-err" role="status">{error}</div>}
        {!error && !result && (
          <p className="hint">
            The candidate entry — register, threat, vulnerability, ratings, treatment and control —
            will appear here once drafted, along with a guideline pass/fail check.
          </p>
        )}
        {!error && result && (
          <pre className="guidelines-text">{JSON.stringify(result, null, 2)}</pre>
        )}
      </section>
    </>
  );
}
