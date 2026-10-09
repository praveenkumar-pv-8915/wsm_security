import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Compare vs. DPIA — its own Compliance Manager sub-tab (moved out of Risk Register, item 3 of
 * claude/compliancemanager-integration-design.md's "Requested Risk Register UI changes").
 *
 * Mirrors compliancemanager's `risk compare_risks`, run as an async job: POST /api/risks/compare-
 * dpias returns { job_id } right away (the real work — fetching every DPIA's Writer export and
 * running an LLM comparison per document — can take a while), and this view polls GET
 * /api/risks/compare-dpias/:jobId until the job leaves 'running', showing progress in the
 * meantime. See risk-service.js's submitCompareDpiasJob/runCompareDpiasJob for the backend side.
 */
const POLL_MS = 1500;

export default function CompareDpias() {
  const [job, setJob] = useState(null); // { jobId, status, total, completed, current, result, error }
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState('');
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const poll = (jobId) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await api(`/risks/compare-dpias/${jobId}`);
        setJob(prev => ({ ...prev, ...r, jobId }));
        if (r.status === 'done' || r.status === 'failed') stopPolling();
      } catch (err) {
        stopPolling();
        setJob(prev => ({
          ...prev,
          status: 'failed',
          error: err instanceof ApiError ? err.message : 'Lost track of the comparison job.',
        }));
      }
    }, POLL_MS);
  };

  const compare = async () => {
    stopPolling();
    setStartError('');
    setJob(null);
    setBusy(true);
    try {
      const r = await api('/risks/compare-dpias', { method: 'POST' });
      setJob({ jobId: r.job_id, status: 'running', total: r.total, completed: 0, current: 'Starting…' });
      poll(r.job_id);
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : 'Comparing against DPIAs failed.');
    } finally {
      setBusy(false);
    }
  };

  const running = job && job.status === 'running';
  const pct = running && job.total ? Math.min(100, Math.round((job.completed / job.total) * 100)) : 0;

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Compare vs. DPIA</h2>
          <p className="view-sub">Check the risk registers for coverage gaps against the current DPIAs.</p>
        </div>
        <div className="view-actions">
          <button className="btn btn-primary" onClick={compare} disabled={busy || running}>
            {busy || running ? 'Comparing…' : 'Compare vs. DPIAs'}
          </button>
        </div>
      </div>

      <section className="card">
        {startError && <div className="banner banner-err" role="status">{startError}</div>}

        {!startError && !job && (
          <p className="hint">
            Click "Compare vs. DPIAs" to check every risk in the registers against the current DPIA
            documents and flag any that aren't covered. This runs as a background job and can take
            a little while — one DPIA at a time.
          </p>
        )}

        {running && (
          <div className="dpia-progress" role="status" aria-live="polite">
            <div className="dpia-progress-head">
              <span>In progress — {job.completed} of {job.total || '?'}</span>
              <span>{pct}%</span>
            </div>
            <div className="dpia-progress-bar">
              <div className="dpia-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="hint">{job.current || 'Working…'}</p>
          </div>
        )}

        {job && job.status === 'failed' && (
          <div className="banner banner-err" role="status">{job.error || 'Comparing against DPIAs failed.'}</div>
        )}

        {job && job.status === 'done' && job.result && (
          <>
            <div className="banner banner-ok" role="status">
              Compared {job.result.dpias_compared} DPIA document(s) — {job.result.rows_total} risk
              row(s), {job.result.rows_missing} missing from the registers, {job.result.rows_covered} covered.
              {job.result.message ? ` ${job.result.message}` : ''}
            </div>
            <pre className="guidelines-text">{JSON.stringify(job.result, null, 2)}</pre>
          </>
        )}
      </section>
    </>
  );
}
