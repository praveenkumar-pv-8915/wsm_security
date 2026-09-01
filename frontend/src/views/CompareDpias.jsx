import { useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Compare vs. DPIA — its own Compliance Manager sub-tab (moved out of Risk Register, item 3 of
 * claude/compliancemanager-integration-design.md's "Requested Risk Register UI changes").
 *
 * Mirrors compliancemanager's `risk compare_risks`. Calls the real POST /api/risks/compare-dpias
 * endpoint, which currently returns a clear 501 — see risk-service.js's compareDpias() — until the
 * DMS Manager (Zoho Writer fetch) and a server-callable LLM path are wired up for it.
 */
export default function CompareDpias() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const compare = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await api('/risks/compare-dpias', { method: 'POST' });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Comparing against DPIAs failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Compare vs. DPIA</h2>
          <p className="view-sub">Check the risk registers for coverage gaps against the current DPIAs.</p>
        </div>
        <div className="view-actions">
          <button className="btn btn-primary" onClick={compare} disabled={busy}>
            {busy ? 'Comparing…' : 'Compare vs. DPIAs'}
          </button>
        </div>
      </div>

      <section className="card">
        {error && <div className="banner banner-err" role="status">{error}</div>}
        {!error && !result && (
          <p className="hint">
            Click "Compare vs. DPIAs" to check every risk in the registers against the current DPIA
            documents and flag any that aren't covered.
          </p>
        )}
        {!error && result && (
          <pre className="guidelines-text">{JSON.stringify(result, null, 2)}</pre>
        )}
      </section>
    </>
  );
}
