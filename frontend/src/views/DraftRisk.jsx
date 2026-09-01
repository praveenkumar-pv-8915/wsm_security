import { useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Draft new risk — its own Compliance Manager sub-tab (moved out of Risk Register, item 3 of
 * claude/compliancemanager-integration-design.md's "Requested Risk Register UI changes").
 *
 * Mirrors compliancemanager's `risk draft_risk`. Calls the real POST /api/risks/draft endpoint,
 * which currently returns a clear 501 — see risk-service.js's draftRisk() — until this app has a
 * server-callable LLM path wired up for it (connections-service.js's chatCompletion() already
 * exists and is used by Ask, so this is scoped follow-up work, not a hard blocker).
 */
export default function DraftRisk() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const draft = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await api('/risks/draft', { method: 'POST', body: {} });
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
          <p className="view-sub">Have Compliance Manager draft a new risk register entry for review.</p>
        </div>
        <div className="view-actions">
          <button className="btn btn-primary" onClick={draft} disabled={busy}>
            {busy ? 'Drafting…' : '＋ Draft new risk'}
          </button>
        </div>
      </div>

      <section className="card">
        {error && <div className="banner banner-err" role="status">{error}</div>}
        {!error && !result && (
          <p className="hint">
            Click "Draft new risk" to generate a candidate risk entry from the current registers
            and guidelines. Nothing is written to Creator — this only prepares a draft.
          </p>
        )}
        {!error && result && (
          <pre className="guidelines-text">{JSON.stringify(result, null, 2)}</pre>
        )}
      </section>
    </>
  );
}
