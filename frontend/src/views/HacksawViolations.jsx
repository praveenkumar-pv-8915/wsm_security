import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { RefreshIcon } from '../lib/icons';

/**
 * Hacksaw › Code Violation Review — phase 1 of the Hacksaw module
 * (claude/hacksaw-module-design.md). Read-only: Hacksaw's write scopes are deliberately not
 * granted, so acting on a finding means following its link out to Hacksaw.
 *
 * Three things about this screen are forced by the API rather than chosen:
 *
 * - **The language selector is mandatory.** `CODE_VIOLATIONS` without a FILE_TYPE is answered
 *   `ZHE164 FILE_TYPE_MANDATORY`, so the selector appears for that scan and only that scan.
 * - **The report defaults to the deployed one, not the newest.** On 20 Oct 2026 the newest report
 *   for Logs360cloud was an unreleased pre-release; the deployed build was four days older. What
 *   is live is what is worth reviewing.
 * - **Nothing fans out.** One product, one report, one scan per view. Hacksaw locks an endpoint
 *   for 5–10 minutes past its limit, so a screen that looped products to build a summary would
 *   lock the whole team out.
 *
 * A scan that has not run shows as "not yet run" rather than as a clean pass — `NOT_YET_GENERATED`
 * is why a report's overall status can read INDETERMINATE.
 *
 * Phase-1 departure from the design doc: findings expand in place rather than opening the v3
 * split-mode detail pane. The pane arrives with the review decision control in phase 4, when
 * there is something to put in it beyond the snippet.
 */

const SCANS = [
  { key: 'CODE_VIOLATIONS', label: 'Code violations' },
  { key: 'MISCONFIGURATIONS', label: 'Misconfigurations' },
  { key: 'HARDCODED_SECRETS', label: 'Hardcoded secrets' },
  { key: 'RUNTIME_CODE_VIOLATIONS', label: 'Runtime code violations' },
];

const FILE_TYPES = ['java', 'js', 'python', 'clang'];
// The priority cell holds a chip, and WARNING is the widest of the three — sized to it so the
// chip never rides over the rule name beside it.
const COLS = '104px minmax(0, 1.4fr) minmax(0, 1.6fr) 104px 120px 86px';

/** ERROR reads as bad, WARNING as attention, INFO as neutral — the register's own vocabulary. */
const priorityClass = (p) => (
  p === 'ERROR' ? 'tag tag-bad' : p === 'WARNING' ? 'summary-chip-attn tag' : 'tag tag-muted'
);

export default function HacksawViolations({ onNotice, product: fixedProduct, label: fixedLabel, initialScan }) {
  // When Hacksaw Report drives the pickers (v7's two-tab shape), product and report arrive as
  // props and this panel renders findings only. Standalone, it still owns its own pickers.
  const embedded = Boolean(fixedProduct !== undefined);
  const [products, setProducts] = useState([]);
  const [ownProduct, setProduct] = useState('');
  const [reports, setReports] = useState([]);
  const [ownLabel, setLabel] = useState('');
  const product = embedded ? fixedProduct : ownProduct;
  const label = embedded ? fixedLabel : ownLabel;
  const [scan, setScan] = useState(initialScan || 'CODE_VIOLATIONS');
  const [fileType, setFileType] = useState('java');

  const [stats, setStats] = useState(null);
  const [filterKeys, setFilterKeys] = useState({});
  const [picked, setPicked] = useState({});
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const limit = 50;
  const fail = (err, fallback) => setError(err instanceof ApiError ? err.message : fallback);

  /**
   * Changing the scan fires two loads — one for the scan itself, one for the filter reset that
   * follows it — and the slower request can land last. That showed as the count updating to the
   * new scan's total while the rows underneath stayed on the old scan's findings. Every load
   * takes a sequence number and a late response for a superseded one is dropped.
   */
  const seq = useRef(0);

  /* Products — 28 of them for this org; the 3,717-product org list is never fetched. */
  useEffect(() => {
    if (embedded) return undefined;
    let live = true;
    (async () => {
      try {
        const r = await api('/hacksaw/products');
        if (!live) return;
        setProducts(r.products || []);
        setProduct((p) => p || (r.products || [])[0]?.name || '');
      } catch (err) {
        if (live) { fail(err, 'Could not reach Hacksaw.'); setStatus('error'); }
      }
    })();
    return () => { live = false; };
  }, []);

  /* Reports for the chosen product — deployed first, else the newest. */
  useEffect(() => {
    if (embedded || !product) return undefined;
    let live = true;
    setStatus('loading'); setError(''); setReports([]); setLabel('');
    (async () => {
      try {
        const r = await api(`/hacksaw/reports?product=${encodeURIComponent(product)}&limit=50`);
        if (!live) return;
        const list = r.reports || [];
        setReports(list);
        setLabel((list.find((x) => x.is_deployed) || list[0] || {}).label || '');
      } catch (err) {
        if (live) { fail(err, 'Could not list reports.'); setStatus('error'); }
      }
    })();
    return () => { live = false; };
  }, [product]);

  /* Report statistics — the per-scan header strip. */
  useEffect(() => {
    if (!product || !label) return undefined;
    let live = true;
    setStats(null);
    (async () => {
      try {
        const r = await api(`/hacksaw/report?product=${encodeURIComponent(product)}&label=${encodeURIComponent(label)}`);
        if (live) setStats(r.report || null);
      } catch { /* the violations list carries the error; a missing header is not fatal */ }
    })();
    return () => { live = false; };
  }, [product, label]);

  /* Filter vocabulary, from Hacksaw rather than a hardcoded list that drifts. */
  useEffect(() => {
    if (!product || !label) return undefined;
    let live = true;
    setFilterKeys({}); setPicked({});
    (async () => {
      try {
        const q = new URLSearchParams({ product, label, scan });
        if (scan === 'CODE_VIOLATIONS') q.set('file_type', fileType);
        const r = await api(`/hacksaw/violation-filters?${q}`);
        if (live) setFilterKeys(r.filters || {});
      } catch { /* filters are a convenience; the list still loads without them */ }
    })();
    return () => { live = false; };
  }, [product, label, scan, fileType]);

  /**
   * The chosen filters as a stable string.
   *
   * `picked` is reset to a FRESH `{}` whenever the scan changes, and an object literal is a new
   * identity every render — so a hook that depended on `picked` directly re-ran forever, each
   * pass firing another fetch. The symptom was a table holding rows from several responses at
   * once (59 rows in a 50-row page) with the count from a different one again. Hooks below
   * depend on this string, which only changes when the filter values actually do.
   */
  const filtersParam = useMemo(() => {
    const chosen = Object.entries(picked).filter(([, v]) => v);
    return chosen.length ? JSON.stringify(Object.fromEntries(chosen.map(([k, v]) => [k, [v]]))) : '';
  }, [picked]);

  const loadViolations = useCallback(async () => {
    if (!product || !label) return;
    const mine = ++seq.current;
    // Clear the list, don't leave the previous scan's findings on screen under a new count —
    // a half-updated table is worse than an empty one on a security review screen.
    setStatus('loading'); setError(''); setOpen(null); setRows([]);
    try {
      const q = new URLSearchParams({ product, label, scan, page: String(page), limit: String(limit) });
      if (scan === 'CODE_VIOLATIONS') q.set('file_type', fileType);
      if (filtersParam) q.set('filters', filtersParam);
      const r = await api(`/hacksaw/violations?${q}`);
      if (mine !== seq.current) return;
      setRows(r.violations || []);
      setTotal(r.total || 0);
      setStatus('ok');
      window.dispatchEvent(new CustomEvent('wsm:section-count', {
        detail: { path: '/hacksaw-violations', count: r.total || 0 },
      }));
    } catch (err) {
      if (mine !== seq.current) return;
      setRows([]); setTotal(0); setStatus('error');
      fail(err, 'Fetching violations failed.');
      // A 429 is a lock-out, not a blip — say so loudly enough that nobody retries into it.
      if (err instanceof ApiError && err.status === 429) onNotice?.(err.message);
    }
  }, [product, label, scan, fileType, filtersParam, page, onNotice]);

  useEffect(() => { loadViolations(); }, [loadViolations]);
  useEffect(() => { setPage(1); }, [product, label, scan, fileType, filtersParam]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const activeScan = useMemo(
    () => (stats?.scans || []).flatMap((s) => [s, ...(s.subscans || [])]).find((s) => s.name === scan),
    [stats, scan],
  );

  const select = (lbl, value, onChange, options, render = (o) => o) => (
    <label className="wsm-dms-filter">
      <span className="wsm-label">{lbl}</span>
      <select className={value ? 'wsm-dms-select-on' : ''} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={render(o)} value={render(o)}>{render(o)}</option>)}
      </select>
    </label>
  );

  return (
    <div className="wsm-dms">
      <div className="wsm-dms-bar">
        {!embedded && select('Product', product, setProduct, products, (p) => p.name || p)}

        {!embedded && (
          <label className="wsm-dms-filter">
            <span className="wsm-label">Report</span>
            <select className={label ? 'wsm-dms-select-on' : ''} value={label} onChange={(e) => setLabel(e.target.value)}>
              {reports.map((r) => (
                <option key={r.label} value={r.label}>
                  {r.is_deployed ? '● deployed — ' : ''}{r.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {!embedded && (
          <label className="wsm-dms-filter">
            <span className="wsm-label">Scan</span>
            <select className="wsm-dms-select-on" value={scan} onChange={(e) => setScan(e.target.value)}>
              {SCANS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        )}

        {/* Not a convenience — Hacksaw rejects CODE_VIOLATIONS without it. */}
        {scan === 'CODE_VIOLATIONS' && select('Language', fileType, setFileType, FILE_TYPES)}

        <span className="wsm-count wsm-dms-shown">
          {status === 'loading' ? 'Loading…' : `${total} violation${total === 1 ? '' : 's'}`}
        </span>

        {stats?.report_link && (
          <a className="btn btn-ghost" href={stats.report_link} target="_blank" rel="noopener noreferrer">
            Open in Hacksaw ↗
          </a>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={loadViolations}
          disabled={status === 'loading'}
          title="Refresh from Hacksaw"
          aria-label="Refresh from Hacksaw"
        >
          <RefreshIcon />
        </button>
      </div>

      {stats && (
        <div className="wsm-hs-scans">
          {(stats.scans || []).map((s) => (
            <span
              key={s.name}
              className={`summary-chip${s.blocking_status === 'BLOCKED' ? ' summary-chip-attn' : ''}`}
              title={s.ran ? `${s.summary.OPEN} open of ${s.summary.TOTAL}` : 'This scan has not run for this report'}
            >
              {s.display.replace(/_/g, ' ').toLowerCase()}
              {' · '}
              {s.ran ? `${s.summary.OPEN} open` : 'not yet run'}
              {s.ran && s.summary.BLOCKING > 0 ? ` · ${s.summary.BLOCKING} blocking` : ''}
            </span>
          ))}
          {stats.notes && <span className="wsm-hs-note">{stats.notes}</span>}
        </div>
      )}

      {Object.keys(filterKeys).length > 0 && (
        <div className="wsm-dms-bar wsm-hs-filters">
          {['PRIORITY', 'STATUS', 'TYPE', 'TRACKING_STATUS', 'RULE'].filter((k) => filterKeys[k]).map((k) => (
            <label key={k} className="wsm-dms-filter">
              <span className="wsm-label">{k.replace(/_/g, ' ').toLowerCase()}</span>
              <select
                className={picked[k] ? 'wsm-dms-select-on' : ''}
                value={picked[k] || ''}
                onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.value }))}
              >
                <option value="">All</option>
                {filterKeys[k].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}
          {Object.values(picked).some(Boolean) && (
            <button type="button" className="btn" onClick={() => setPicked({})}>Clear filters</button>
          )}
        </div>
      )}

      {error && <div className="banner banner-err" role="alert">{error}</div>}

      {activeScan && !activeScan.ran && !error && (
        <div className="banner" role="status">
          This scan has not run for this report ({activeScan.status.replace(/_/g, ' ').toLowerCase()}),
          so an empty list here is not a clean result.
        </div>
      )}

      <div className="pane wsm-dms-pane">
        {/* Keyed by the query: a scan change is a different list, not an edit of this one. */}
        <div className="wsm-dms-table" key={`${product}|${label}|${scan}|${fileType}`}>
          <div className="wsm-dms-head" style={{ gridTemplateColumns: COLS }}>
            <div>Priority</div>
            <div>Rule</div>
            <div>File</div>
            <div>Status</div>
            <div>Assignee</div>
            <div>Line</div>
          </div>

          {rows.map((v, i) => (
            <div key={v.id}>
              <div
                data-row="1"
                className="wsm-dms-row wsm-hs-row"
                style={{
                  gridTemplateColumns: COLS,
                  animation: `wsm-row-a 300ms var(--ease) ${Math.min(i * 18, 280)}ms both`,
                }}
                onClick={() => setOpen(open === v.id ? null : v.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === v.id ? null : v.id); } }}
              >
                <div><span className={`${priorityClass(v.priority)} wsm-hs-prio`}>{v.priority}</span></div>
                <div className="wsm-dms-name">{v.rule}</div>
                <div className="wsm-dms-muted wsm-hs-file" title={v.file_name}>{v.file_name}</div>
                <div className="wsm-dms-muted">{v.status === 'OPEN' ? 'Open' : v.status.replace(/_/g, ' ').toLowerCase()}</div>
                <div className="wsm-dms-muted">{v.assignee === 'UNASSIGNED' ? '—' : v.assignee || '—'}</div>
                <div className="wsm-dms-muted wsm-dms-date">{v.line_no}</div>
              </div>

              {open === v.id && (
                <div className="wsm-hs-detail">
                  <pre className="wsm-hs-snippet">{v.snippet || '(no snippet)'}</pre>
                  <div className="wsm-hs-meta">
                    {v.standards.map((s) => <span key={s} className="tag">{s}</span>)}
                    {v.owasp_id && <span className="tag">OWASP {v.owasp_id}</span>}
                    {v.context && <span className="tag tag-muted">{v.context}</span>}
                    {v.author && <span className="tag tag-muted">author {v.author}</span>}
                    {v.is_blocked && <span className="tag tag-bad">blocking</span>}
                    {v.link && (
                      <a className="btn btn-small" href={v.link} target="_blank" rel="noopener noreferrer">
                        Open in Hacksaw ↗
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {status === 'ok' && rows.length === 0 && (
            <p className="wsm-empty">No violations match this scan and filter.</p>
          )}
          {status === 'loading' && <p className="wsm-empty">Loading…</p>}
        </div>
      </div>

      {pages > 1 && (
        <div className="wsm-dms-bar wsm-hs-pager">
          <button type="button" className="btn" disabled={page <= 1 || status === 'loading'} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="wsm-count">Page {page} of {pages}</span>
          <button type="button" className="btn" disabled={page >= pages || status === 'loading'} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
