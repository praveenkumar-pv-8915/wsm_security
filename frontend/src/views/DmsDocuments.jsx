import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { RefreshIcon } from '../lib/icons';

/**
 * DMS Manager — the team's document records, live from the Zoho Creator "documents" report
 * (GET /api/dms/documents → risk-service.js's listDocuments → fetchDmsDocuments). Live rather than
 * the persisted dms_documents snapshot because this screen shows each document's open-in link
 * and added date, which that table never stored (2026-10-09 decision: read them from Creator
 * rather than widen the table).
 *
 * Lives as a Compliance Manager section (App.jsx's GROUPS) beside Risk Register and shares its
 * team filter: both read the same `team_names` tool_config entry (TOOL_KEY 'Compliance_manager',
 * see risk-service.js and datastore-conventions.md) — one team filter for the whole compliance
 * app. Add/remove teams under Settings › Compliance.
 *
 * Layout follows the "WSM Security v5" mockup (design/WSM Security v5.dc.html — see README ›
 * Design): a filter bar (search, Team, Template, Clear filters, "N of M documents") over a flat,
 * full-bleed table whose Document name opens the Writer/Sheet file. The mockup's Status and
 * Module columns are not here — Creator's document record carries neither a review date nor a
 * module — so the added date takes the last column instead.
 *
 * No "Submitted by" column — Creator's Submitted_By is a person's email, third-party PII this app
 * never persists or displays (see risk-service.js's mapDocRecord and datastore-conventions.md's
 * No-PII identity decision).
 */

const DMS_COLS = 'minmax(0, 1.6fr) 150px minmax(0, 1fr) minmax(0, 1.5fr) 96px 110px';

function uniq(list, key) {
  return Array.from(new Set(list.map((d) => d[key]).filter(Boolean))).sort();
}

export default function DmsDocuments() {
  const [state, setState] = useState({ status: 'loading', documents: [], error: '' });
  const [q, setQ] = useState('');
  const [fTeam, setFTeam] = useState('');
  const [fTemplate, setFTemplate] = useState('');
  const [fApp, setFApp] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const r = await api('/dms/documents');
      const documents = r.documents || [];
      setState({ status: 'ok', documents, error: '' });
      // The rail shows a count beside each section (the mockup's nav) — announced from here so
      // the shell never makes a second call just to count.
      window.dispatchEvent(new CustomEvent('wsm:section-count', {
        detail: { path: '/dms-documents', count: documents.length },
      }));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Fetching documents failed.';
      setState({ status: 'error', documents: [], error: message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const teams = useMemo(() => uniq(state.documents, 'team'), [state.documents]);
  const templates = useMemo(() => uniq(state.documents, 'template'), [state.documents]);
  const apps = useMemo(() => uniq(state.documents, 'app'), [state.documents]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.documents.filter((d) => (
      (!needle || [d.document_id, d.name, d.template, d.team].some((f) => String(f || '').toLowerCase().includes(needle)))
      && (!fTeam || d.team === fTeam)
      && (!fTemplate || d.template === fTemplate)
      && (!fApp || d.app === fApp)
    ));
  }, [state.documents, q, fTeam, fTemplate, fApp]);

  const filtersOn = Boolean(fTeam || fTemplate || fApp);
  const clearFilters = () => { setFTeam(''); setFTemplate(''); setFApp(''); };

  const shown = state.status === 'loading'
    ? 'Loading…'
    : `${filtered.length} of ${state.documents.length} document${state.documents.length === 1 ? '' : 's'}`;

  if (state.status === 'error') {
    return (
      <div className="wsm-dms">
        <div className="wsm-register-error">
          <div className="banner banner-err" role="status">{state.error}</div>
          <button className="btn" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const selectFilter = (label, value, onChange, options) => (
    <label className="wsm-dms-filter">
      <span className="wsm-label">{label}</span>
      <select className={value ? 'wsm-dms-select-on' : ''} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  return (
    <div className="wsm-dms">
      <div className="wsm-dms-bar">
        <input
          type="search"
          className="wsm-search"
          placeholder="Search document, template, team"
          aria-label="Search documents"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {selectFilter('Team', fTeam, setFTeam, teams)}
        {selectFilter('Template', fTemplate, setFTemplate, templates)}
        {apps.length > 1 && selectFilter('Opens in', fApp, setFApp, apps)}
        {filtersOn && (
          <button type="button" className="btn" onClick={clearFilters}>Clear filters</button>
        )}
        <span className="wsm-count wsm-dms-shown">{shown}</span>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={load}
          disabled={state.status === 'loading'}
          title="Refresh from Creator"
          aria-label="Refresh from Creator"
        >
          <RefreshIcon />
        </button>
      </div>

      <div className="pane wsm-dms-pane">
        <div className="wsm-dms-table">
          <div className="wsm-dms-head" style={{ gridTemplateColumns: DMS_COLS }}>
            <div>Document name</div>
            <div>Document ID</div>
            <div>Team</div>
            <div>Template</div>
            <div>Opens in</div>
            <div>Added</div>
          </div>

          {filtered.map((d, i) => (
            <div
              key={d.document_id || d.name}
              data-row="1"
              className="wsm-dms-row"
              style={{
                gridTemplateColumns: DMS_COLS,
                animation: `wsm-row-a 300ms var(--ease) ${Math.min(i * 28, 340)}ms both`,
              }}
            >
              <div className="wsm-dms-name">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" title={`Open in Zoho ${d.app || ''}`.trim()}>
                    {d.name || '—'}<span className="wsm-dms-ext" aria-hidden="true">↗</span>
                  </a>
                ) : (
                  <span>{d.name || '—'}</span>
                )}
              </div>
              <div className="wsm-dms-id">{d.document_id || '—'}</div>
              <div className="wsm-dms-muted">{d.team || '—'}</div>
              <div className="wsm-dms-muted">{d.template || '—'}</div>
              <div>{d.app ? <span className="tag">{d.app}</span> : <span className="wsm-dms-muted">—</span>}</div>
              <div className="wsm-dms-muted wsm-dms-date">{d.added_on || '—'}</div>
            </div>
          ))}

          {state.status === 'ok' && filtered.length === 0 && (
            <p className="wsm-empty">
              {state.documents.length === 0
                ? 'No documents for the configured team(s).'
                : 'No documents match this search or filter.'}
            </p>
          )}
          {state.status === 'loading' && <p className="wsm-empty">Loading…</p>}
        </div>
      </div>
    </div>
  );
}
