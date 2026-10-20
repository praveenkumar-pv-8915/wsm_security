import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { RefreshIcon } from '../lib/icons';

/**
 * Hacksaw › Vulnerability Components — phase 2 of the Hacksaw module
 * (claude/hacksaw-module-design.md). The SCA half: third-party and internal components in a
 * build that carry known CVEs.
 *
 * The screen is ordered around one field. `UPCOMING_BLOCKING_TIME` says when an open component
 * starts failing builds, so the list sorts blocking-now first, then by that deadline, then by
 * vulnerability count — Hacksaw's own order is by none of those. A team's question here is
 * "what breaks my build next, and when", not "what is alphabetically first".
 *
 * Small by nature: 3 components in the deployed report against 1,283 misconfigurations, so there
 * is no paging and no filter bar. CVEs load per component, on expand, rather than up front —
 * that is one request per component and the endpoint is throttled at 50/min.
 *
 * Read-only, like the rest of the module: suppression and assignment need Hacksaw write scopes
 * that were deliberately not granted, so each row links out instead.
 */

const COLS = 'minmax(0, 1.6fr) 96px 150px 104px 110px';

/** Hacksaw gives `YYYY-MM-DD HH:MM:SS`; show the day and how far off it is. */
function blockingIn(ts) {
  if (!ts) return null;
  const at = Date.parse(ts.replace(' ', 'T'));
  if (Number.isNaN(at)) return { day: ts, days: null };
  const days = Math.ceil((at - Date.now()) / 86400000);
  return { day: ts.slice(0, 10), days };
}

/** CVSS bands, using the app's own status tiers rather than new colours. */
const sevClass = (n) => (
  n === null ? 'tag tag-muted' : n >= 9 ? 'tag tag-bad' : n >= 7 ? 'tag tag-bad' : n >= 4 ? 'tag summary-chip-attn' : 'tag tag-muted'
);

export default function HacksawComponents({ onNotice, product: fixedProduct, label: fixedLabel }) {
  const embedded = Boolean(fixedProduct !== undefined);
  const [products, setProducts] = useState([]);
  const [ownProduct, setProduct] = useState('');
  const [reports, setReports] = useState([]);
  const [ownLabel, setLabel] = useState('');
  const product = embedded ? fixedProduct : ownProduct;
  const label = embedded ? fixedLabel : ownLabel;

  const [rows, setRows] = useState([]);
  const [blocking, setBlocking] = useState(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const [open, setOpen] = useState(null);
  const [cves, setCves] = useState({});

  const seq = useRef(0);
  const fail = (err, fallback) => setError(err instanceof ApiError ? err.message : fallback);

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
        // The deployed build, not the newest — the same rule the violations screen follows.
        setLabel((list.find((x) => x.is_deployed) || list[0] || {}).label || '');
      } catch (err) {
        if (live) { fail(err, 'Could not list reports.'); setStatus('error'); }
      }
    })();
    return () => { live = false; };
  }, [product]);

  const load = useCallback(async () => {
    if (!product || !label) return;
    const mine = ++seq.current;
    setStatus('loading'); setError(''); setOpen(null); setCves({}); setRows([]);
    try {
      const r = await api(`/hacksaw/components?product=${encodeURIComponent(product)}&label=${encodeURIComponent(label)}`);
      if (mine !== seq.current) return;
      setRows(r.components || []);
      setBlocking(r.blocking || 0);
      setStatus('ok');
      window.dispatchEvent(new CustomEvent('wsm:section-count', {
        detail: { path: '/hacksaw-components', count: (r.components || []).length },
      }));
    } catch (err) {
      if (mine !== seq.current) return;
      setRows([]); setStatus('error');
      fail(err, 'Fetching components failed.');
      if (err instanceof ApiError && err.status === 429) onNotice?.(err.message);
    }
  }, [product, label, onNotice]);

  useEffect(() => { load(); }, [load]);

  /** CVEs are fetched per component on first expand — one throttled request each, not N up front. */
  const toggle = useCallback(async (c) => {
    if (open === c.id) { setOpen(null); return; }
    setOpen(c.id);
    if (cves[c.id]) return;
    setCves((m) => ({ ...m, [c.id]: { loading: true } }));
    try {
      const q = new URLSearchParams({ product, label, component_id: String(c.id) });
      if (c.type) q.set('component_type', c.type);
      const r = await api(`/hacksaw/component-vulnerabilities?${q}`);
      setCves((m) => ({ ...m, [c.id]: { list: r.vulnerabilities || [] } }));
    } catch (err) {
      setCves((m) => ({ ...m, [c.id]: { error: err instanceof ApiError ? err.message : 'Could not load CVEs.' } }));
    }
  }, [open, cves, product, label]);

  return (
    <div className="wsm-dms">
      <div className="wsm-dms-bar">
        {!embedded && (
          <label className="wsm-dms-filter">
            <span className="wsm-label">Product</span>
            <select className="wsm-dms-select-on" value={product} onChange={(e) => setProduct(e.target.value)}>
              {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
        )}

        {!embedded && (
          <label className="wsm-dms-filter">
            <span className="wsm-label">Report</span>
            <select className={label ? 'wsm-dms-select-on' : ''} value={label} onChange={(e) => setLabel(e.target.value)}>
              {reports.map((r) => (
                <option key={r.label} value={r.label}>{r.is_deployed ? '● deployed — ' : ''}{r.label}</option>
              ))}
            </select>
          </label>
        )}

        <span className="wsm-count wsm-dms-shown">
          {status === 'loading'
            ? 'Loading…'
            : `${rows.length} component${rows.length === 1 ? '' : 's'}${blocking ? ` · ${blocking} blocking` : ''}`}
        </span>

        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={load}
          disabled={status === 'loading'}
          title="Refresh from Hacksaw"
          aria-label="Refresh from Hacksaw"
        >
          <RefreshIcon />
        </button>
      </div>

      {error && <div className="banner banner-err" role="alert">{error}</div>}

      <div className="pane wsm-dms-pane">
        <div className="wsm-dms-table" key={`${product}|${label}`}>
          <div className="wsm-dms-head" style={{ gridTemplateColumns: COLS }}>
            <div>Component</div>
            <div>CVEs</div>
            <div>Blocks builds</div>
            <div>Ownership</div>
            <div>Age</div>
          </div>

          {rows.map((c, i) => {
            const b = blockingIn(c.blocking_at);
            const detail = cves[c.id];
            return (
              <div key={c.id}>
                <div
                  data-row="1"
                  className="wsm-dms-row wsm-hs-row"
                  style={{
                    gridTemplateColumns: COLS,
                    animation: `wsm-row-a 300ms var(--ease) ${Math.min(i * 28, 280)}ms both`,
                  }}
                  onClick={() => toggle(c)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c); } }}
                >
                  <div className="wsm-dms-name">
                    {c.name}
                    {c.is_blocked && <span className="tag tag-bad wsm-hs-prio">BLOCKING</span>}
                  </div>
                  <div className="wsm-dms-muted">{c.vulnerability_count}</div>
                  <div className={b && b.days !== null && b.days <= 14 ? 'wsm-hs-soon' : 'wsm-dms-muted'}>
                    {c.is_blocked
                      ? 'already'
                      : b
                      ? `${b.day}${b.days !== null ? ` · ${b.days}d` : ''}`
                      : '—'}
                  </div>
                  <div className="wsm-dms-muted">{c.ownership}</div>
                  <div className="wsm-dms-muted wsm-dms-date">{c.age || '—'}</div>
                </div>

                {open === c.id && (
                  <div className="wsm-hs-detail">
                    <div className="wsm-hs-meta">
                      <span className="tag tag-muted">{c.identifier}</span>
                      {c.context && <span className="tag tag-muted">{c.context}</span>}
                      {c.eol && c.eol !== 'NOT_AVAILABLE' && <span className="tag">EOL {c.eol}</span>}
                      {c.reachable === 'YES' && <span className="tag tag-bad">reachable</span>}
                      <span className="tag tag-muted">confidence {c.confidence}</span>
                    </div>

                    {c.bundled_from.length > 0 && (
                      <p className="hint">Bundled from {c.bundled_from.map((x) => x.name).join(', ')}</p>
                    )}

                    {detail?.loading && <p className="wsm-empty">Loading CVEs…</p>}
                    {detail?.error && <div className="banner banner-err" role="alert">{detail.error}</div>}

                    {detail?.list && (
                      <div className="wsm-hs-cves">
                        {detail.list.map((v) => (
                          <div key={v.auto_id || v.id} className="wsm-hs-cve">
                            <span className={sevClass(v.severity)}>{v.severity ?? '—'}</span>
                            <a href={v.link || undefined} target="_blank" rel="noopener noreferrer" className="mono">{v.id}</a>
                            {v.actively_exploited && <span className="tag tag-bad">actively exploited</span>}
                            {v.cwe && <span className="tag tag-muted">{v.cwe}</span>}
                            {v.exploitability !== null && (
                              <span className="tag tag-muted" title="EPSS — probability of exploitation in the next 30 days">
                                EPSS {v.exploitability}
                              </span>
                            )}
                            <span className="wsm-hs-cve-desc">{v.description}</span>
                          </div>
                        ))}
                        {detail.list.length === 0 && <p className="wsm-empty">No CVE detail returned.</p>}
                      </div>
                    )}

                    {/* Read-only here: acting on a component means doing it in Hacksaw. */}
                    <p className="hint">{c.path}</p>
                  </div>
                )}
              </div>
            );
          })}

          {status === 'ok' && rows.length === 0 && (
            <p className="wsm-empty">No vulnerable components in this report.</p>
          )}
          {status === 'loading' && <p className="wsm-empty">Loading…</p>}
        </div>
      </div>
    </div>
  );
}
