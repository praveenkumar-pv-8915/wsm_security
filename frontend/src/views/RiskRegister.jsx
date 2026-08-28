import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Risk Register — first slice of compliancemanager (risk_manager) in the Welcome app.
 *
 * Read-only for now: rows come from the `compliance_risks` DataStore table (seeded with demo data
 * server-side until the real Zoho Creator sync is designed — see risk-service.js). "Draft new risk"
 * and "Compare vs. DPIAs" call real endpoints that currently return a clear 501, surfaced here as a
 * banner rather than swallowed — see claude/compliancemanager-integration-design.md for what's
 * still open.
 */

const REGISTERS = [
  { key: '', label: 'All registers' },
  { key: 'isms', label: 'ISMS' },
  { key: 'pims', label: 'PIMS' },
  { key: 'qms', label: 'QMS' },
  { key: 'bcms', label: 'BCMS' },
];
const STATUSES = [
  { key: '', label: 'Status: all' },
  { key: 'ok', label: 'Guideline OK' },
  { key: 'review', label: 'Needs review' },
  { key: 'dpia', label: 'DPIA gap' },
];
const SEVERITIES = [
  { key: '', label: 'Severity: all' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
];
const STATUS_TAG = { ok: 'tag tag-good', review: 'tag tag-warn', dpia: 'tag tag-bad' };
const STATUS_LABEL = { ok: 'Guideline OK', review: 'Needs review', dpia: 'DPIA gap' };
const SEVERITY_TAG = { critical: 'tag tag-bad', high: 'tag tag-warn', medium: 'tag tag-muted', low: 'tag tag-muted' };

export default function RiskRegister({ onNotice }) {
  const [filters, setFilters] = useState({ register: '', status: '', severity: '', q: '' });
  const [state, setState] = useState({ status: 'loading', risks: [], error: '' });
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    const params = new URLSearchParams();
    if (filters.register) params.set('register', filters.register);
    if (filters.status) params.set('status', filters.status);
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.q) params.set('q', filters.q);
    const qs = params.toString();
    api(`/risks${qs ? `?${qs}` : ''}`)
      .then((r) => setState({ status: 'ok', risks: r.risks || [], error: '' }))
      .catch((err) => setState({ status: 'error', risks: [], error: err.message }));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (label, fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  const draftRisk = () => runAction('Draft new risk', () => api('/risks/draft', { method: 'POST', body: {} }));
  const compareDpias = () => runAction('Compare vs. DPIAs', () => api('/risks/compare-dpias', { method: 'POST' }));

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Risk Register</h2>
          <p className="view-sub">
            Pulled from the ISMS / PIMS / QMS / BCMS registers, reviewed against the risk guidelines.
          </p>
        </div>
        <div className="view-actions">
          <button className="btn btn-ghost" onClick={compareDpias} disabled={busy}>Compare vs. DPIAs</button>
          <button className="btn btn-primary" onClick={draftRisk} disabled={busy}>＋ Draft new risk</button>
        </div>
      </div>

      <div className="form-grid risk-filters">
        <label>
          <span>Register</span>
          <select value={filters.register} onChange={(e) => setFilters({ ...filters, register: e.target.value })}>
            {REGISTERS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label>
          <span>Severity</span>
          <select value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })}>
            {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label>
          <span>Search</span>
          <input
            type="search"
            placeholder="Risk ID, title…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
        </label>
      </div>

      <section className="card">
        {state.status === 'error' && (
          <div className="banner banner-err" role="status">{state.error}</div>
        )}
        {state.status !== 'error' && (
          <div className="table-scroll">
            <table className="cred-table">
              <thead>
                <tr>
                  <th>Risk ID</th><th>Title</th><th>Register</th><th>Severity</th><th>Status</th><th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {state.risks.map((r) => (
                  <Fragment key={r.risk_id}>
                    <tr onClick={() => setOpenId(openId === r.risk_id ? null : r.risk_id)} style={{ cursor: 'pointer' }}>
                      <td className="mono">{r.risk_id}</td>
                      <td className="strong">{r.title}</td>
                      <td style={{ textTransform: 'uppercase' }} className="dim">{r.register}</td>
                      <td><span className={SEVERITY_TAG[r.severity] || 'tag'}>{r.severity}</span></td>
                      <td><span className={STATUS_TAG[r.status] || 'tag'}>{STATUS_LABEL[r.status] || r.status}</span></td>
                      <td className="dim">{r.updated_at}</td>
                    </tr>
                    {openId === r.risk_id && (
                      <tr>
                        <td colSpan={6}>
                          <div className="risk-detail">
                            <p className="hint">{r.description}</p>
                            <dl className="kv">
                              <dt>Feature</dt><dd>{r.feature}</dd>
                            </dl>
                            <div className="sec-title">Guideline checks (scripted G6–G10, G19)</div>
                            <div className="risk-checks">
                              {r.checks.map(([code, result]) => (
                                <span key={code} className={`tag ${result === 'pass' ? 'tag-good' : 'tag-bad'}`}>
                                  {code} {result === 'pass' ? '✓' : '✕'}
                                </span>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {state.status === 'ok' && state.risks.length === 0 && (
              <p className="empty">No risks match these filters.</p>
            )}
            {state.status === 'loading' && <p className="empty">Loading…</p>}
          </div>
        )}
      </section>
    </>
  );
}
