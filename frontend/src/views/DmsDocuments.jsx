import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * DMS Manager — lists the team's document records from the persisted `dms_documents` DataStore
 * table (mirrors Risk Register's compliance_risks pattern — see risk-service.js's listDocuments()/
 * syncDmsDocuments(), GET /api/dms/documents and POST /api/dms/documents/sync). The table
 * auto-syncs once from the live Zoho Creator connection the first time it's empty; "Sync from
 * Creator" is the manual full-replace refresh after that, same as Risk Register's own button.
 * "Refresh" just re-reads the persisted table (no Creator call) — same as loading the page again.
 *
 * Lives as a Compliance Manager sub-tab (App.jsx's GROUPS), alongside Risk Register, and shares
 * its team filter with it: both read/write the same `team_names` tool_config entry (TOOL_KEY
 * 'Compliance_manager', see risk-service.js and datastore-conventions.md) — there is one team
 * filter for the whole compliance app, not a separate one per feature. This view has no filter UI
 * of its own; add/remove teams from Risk Register's "Teams synced" panel.
 *
 * UI mirrors Risk Register's table (toolbar with count/page-size/pagination on the left, search +
 * columns menu on the right, same `cred-table`/`table-scroll` classes) — everything here is a
 * single live Creator response (no server-side paging), so search/columns/paging are all
 * client-side over the one loaded list.
 */

const SEARCH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);
const COLUMNS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <path d="M15 4v16" />
  </svg>
);
const CHEVRON_LEFT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const CHEVRON_RIGHT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

// No "Submitted by" column — Creator's Submitted_By is a person's email, third-party PII this
// app never persists or displays (see risk-service.js's mapDocRecord and
// datastore-conventions.md's No-PII identity decision).
const COLUMNS = [
  { key: 'document_id', label: 'Document ID', hideable: false },
  { key: 'name', label: 'Name', hideable: true },
  { key: 'template', label: 'Template', hideable: true },
  { key: 'team', label: 'Team', hideable: true },
];
const COLUMNS_STORAGE_KEY = 'wsm.dmsDocuments.hiddenColumns';
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

function loadHiddenColumns() {
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveHiddenColumns(hidden) {
  try {
    window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(hidden)));
  } catch {
    /* best-effort only — a column-visibility preference isn't worth failing over */
  }
}

export default function DmsDocuments() {
  const [state, setState] = useState({ status: 'loading', documents: [], error: '' });
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hiddenColumns, setHiddenColumns] = useState(loadHiddenColumns);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const r = await api('/dms/documents');
      setState({ status: 'ok', documents: r.documents || [], error: '' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Fetching documents failed.';
      setState({ status: 'error', documents: [], error: message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const syncFromCreator = async () => {
    setSyncing(true);
    try {
      await api('/dms/documents/sync', { method: 'POST' });
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Sync from Creator failed.';
      setState((s) => ({ ...s, status: 'error', error: message }));
    } finally {
      setSyncing(false);
    }
  };

  const toggleColumn = (key) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveHiddenColumns(next);
      return next;
    });
  };
  const activeColumns = COLUMNS.filter((c) => !hiddenColumns.has(c.key));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return state.documents;
    return state.documents.filter((d) => (
      [d.document_id, d.name, d.template, d.team]
        .some((field) => String(field || '').toLowerCase().includes(needle))
    ));
  }, [state.documents, q]);

  useEffect(() => { setPage(1); }, [q, pageSize]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);
  const visibleDocs = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">DMS Manager</h2>
          <p className="view-sub">Document records from Zoho Creator, for the configured team(s).</p>
        </div>
        <div className="view-actions">
          <button className="btn btn-ghost" onClick={load} disabled={state.status === 'loading' || syncing}>
            {state.status === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn btn-primary" onClick={syncFromCreator} disabled={syncing || state.status === 'loading'}>
            {syncing ? 'Syncing…' : 'Sync from Creator'}
          </button>
        </div>
      </div>

      <section className="card">
        {state.status === 'error' && (
          <div className="banner banner-err" role="status">{state.error}</div>
        )}
        {state.status !== 'error' && (
          <>
            <div className="table-toolbar">
              <div className="pagination-left">
                <span className="table-count">
                  {state.status === 'loading'
                    ? 'Loading…'
                    : total > 0
                      ? `Showing ${rangeStart}–${rangeEnd} of ${total} document${total === 1 ? '' : 's'}`
                      : 'No documents to show'}
                </span>
                <label className="pagination-size">
                  <span>Rows per page</span>
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                    {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="icon-btn-sm"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                    title="Previous page"
                  >
                    {CHEVRON_LEFT_ICON}
                  </button>
                  <span className="pagination-page">Page {currentPage} of {totalPages}</span>
                  <button
                    type="button"
                    className="icon-btn-sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
                    title="Next page"
                  >
                    {CHEVRON_RIGHT_ICON}
                  </button>
                </div>
              </div>
              <div className="table-toolbar-actions">
                <div className={`table-search${searchOpen ? ' table-search-open' : ''}`}>
                  {searchOpen && (
                    <input
                      type="search"
                      autoFocus
                      placeholder="Document ID, name, template…"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onBlur={() => { if (!q) setSearchOpen(false); }}
                    />
                  )}
                  <button
                    type="button"
                    className="icon-btn-sm"
                    onClick={() => setSearchOpen((v) => !v)}
                    aria-label="Search documents"
                    title="Search"
                  >
                    {SEARCH_ICON}
                  </button>
                </div>
                <div className="col-filter-wrap">
                  <button
                    type="button"
                    className="icon-btn-sm"
                    onClick={() => setColumnsMenuOpen((v) => !v)}
                    aria-label="Show or hide columns"
                    title="Columns"
                  >
                    {COLUMNS_ICON}
                  </button>
                  {columnsMenuOpen && (
                    <>
                      <div className="col-filter-pop-overlay" onClick={() => setColumnsMenuOpen(false)} />
                      <div className="col-filter-pop columns-menu">
                        <div className="sec-title" style={{ margin: '0 0 6px' }}>Columns shown</div>
                        {COLUMNS.map((c) => (
                          <label key={c.key} className="columns-menu-row">
                            <input
                              type="checkbox"
                              checked={!hiddenColumns.has(c.key)}
                              disabled={!c.hideable}
                              onChange={() => toggleColumn(c.key)}
                            />
                            <span>{c.label}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="table-scroll table-scroll-tall">
              <table className="cred-table">
                <thead>
                  <tr>
                    {activeColumns.map((c) => <th key={c.key}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visibleDocs.map((doc) => {
                    const cell = {
                      document_id: <td key="document_id" className="strong">{doc.document_id || '—'}</td>,
                      name: <td key="name" title={doc.name}><span className="cell-clip-multi">{doc.name || '—'}</span></td>,
                      template: <td key="template" title={doc.template}><span className="cell-clip-multi">{doc.template || '—'}</span></td>,
                      team: <td key="team" title={doc.team}><span className="cell-clip-multi">{doc.team || '—'}</span></td>,
                    };
                    return (
                      <tr key={doc.document_id || doc.name}>
                        {activeColumns.map((c) => cell[c.key])}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {state.status === 'ok' && visibleDocs.length === 0 && (
                <p className="empty">No documents match{q ? ' this search' : ' the configured team(s)'}.</p>
              )}
              {state.status === 'loading' && <p className="empty">Loading…</p>}
            </div>
          </>
        )}
      </section>
    </>
  );
}
