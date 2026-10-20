import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import HacksawViolations from './HacksawViolations';
import HacksawComponents from './HacksawComponents';

/**
 * Hacksaw › Hacksaw Report — the v7 shape.
 *
 * The v7 design (design/WSM Security v7) gives the Hacksaw group exactly two tools, and this is
 * the second: `violations`, titled "Hacksaw Report", over the categories
 * `viol · mis · sec · vuln · iast` with `comp: false, jars: false`. Vulnerable components is a
 * CATEGORY here, not a nav item of its own — which is why the module has two tabs and not three,
 * and why the standalone Vulnerability Components route is gone.
 *
 * Product and report are owned here and handed to whichever panel the category selects, so
 * switching category keeps the build you are looking at. Each panel still works standalone.
 *
 * v7 subtitles this "scan findings new in WIP vs base", so a base build can be chosen and the
 * screen then shows the DIFF — what this build added, still carries, or fixed — through
 * /api/diffreports. Setting Base to "whole report" falls back to every finding in the build,
 * which is what you want when there is no meaningful predecessor.
 *
 * A scan can come back uncomparable (ZHE403: the BASE never ran it). That is shown as its own
 * state rather than as zero new findings — on a security screen those must not look alike.
 */

const CATEGORIES = [
  { key: 'CODE_VIOLATIONS', label: 'Code violations' },
  { key: 'MISCONFIGURATIONS', label: 'Misconfigurations' },
  { key: 'HARDCODED_SECRETS', label: 'Hardcoded secrets' },
  { key: 'RUNTIME_CODE_VIOLATIONS', label: 'IAST' },
  { key: 'VULNERABLE_COMPONENTS', label: 'Vulnerable components' },
];

export default function HacksawReport({ onNotice }) {
  const [products, setProducts] = useState([]);
  const [product, setProduct] = useState('');
  const [reports, setReports] = useState([]);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('CODE_VIOLATIONS');
  const [baseLabel, setBaseLabel] = useState('');
  const [diffCategory, setDiffCategory] = useState('NEW');
  const [fileType, setFileType] = useState('java');
  const [diff, setDiff] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [openRow, setOpenRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const fail = (err, fallback) => setError(err instanceof ApiError ? err.message : fallback);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await api('/hacksaw/products');
        if (!live) return;
        setProducts(r.products || []);
        setProduct((p) => p || (r.products || [])[0]?.name || '');
      } catch (err) { if (live) fail(err, 'Could not reach Hacksaw.'); }
    })();
    return () => { live = false; };
  }, []);

  const loadReports = useCallback(async () => {
    if (!product) return;
    setError(''); setReports([]); setLabel('');
    try {
      const r = await api(`/hacksaw/reports?product=${encodeURIComponent(product)}&limit=50`);
      const list = r.reports || [];
      setReports(list);
      // The deployed build, not the newest: what is live is what is worth reviewing.
      const wip = (list.find((x) => x.is_deployed) || list[0] || {}).label || '';
      setLabel(wip);
      // Default base: the build before this one, which is what "new in this build" usually means.
      const at = list.findIndex((x) => x.label === wip);
      setBaseLabel(at >= 0 && list[at + 1] ? list[at + 1].label : '');
    } catch (err) { fail(err, 'Could not list reports.'); }
  }, [product]);

  useEffect(() => { loadReports(); }, [loadReports]);

  const diffing = Boolean(baseLabel);

  /* Diff statistics — the per-scan "how much is new" strip. */
  useEffect(() => {
    if (!product || !label || !baseLabel) { setDiff(null); return undefined; }
    let live = true;
    (async () => {
      try {
        const q = new URLSearchParams({ product, label, base_label: baseLabel, diff_type: diffCategory });
        const r = await api(`/hacksaw/diff?${q}`);
        if (live) setDiff(r.diff || null);
      } catch (err) { if (live) { setDiff(null); fail(err, 'Could not compare the builds.'); } }
    })();
    return () => { live = false; };
  }, [product, label, baseLabel, diffCategory]);

  /* The diff findings themselves. */
  const loadDiffRows = useCallback(async () => {
    if (!product || !label || !baseLabel) return;
    const mine = ++seq.current;
    setBusy(true); setError(''); setOpenRow(null); setRows([]);
    try {
      const q = new URLSearchParams({
        product, label, base_label: baseLabel, scan: category, diff_category: diffCategory, limit: '50',
      });
      if (category === 'CODE_VIOLATIONS') q.set('file_type', fileType);
      const r = await api(`/hacksaw/diff-violations?${q}`);
      if (mine !== seq.current) return;
      setRows(r.violations || []); setTotal(r.total || 0);
    } catch (err) {
      if (mine !== seq.current) return;
      setRows([]); setTotal(0); fail(err, 'Could not load the diff findings.');
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, [product, label, baseLabel, category, diffCategory, fileType]);

  useEffect(() => { if (diffing) loadDiffRows(); }, [diffing, loadDiffRows]);

  const scanStat = (diff?.scans || [])
    .flatMap((x) => [x, ...(x.subscans || [])])
    .find((x) => x.name === category || x.display === category);

  const ready = Boolean(product && label);

  return (
    <div className="wsm-hs-report">
      <div className="wsm-dms-bar">
        <label className="wsm-dms-filter">
          <span className="wsm-label">Product</span>
          <select className="wsm-dms-select-on" value={product} onChange={(e) => setProduct(e.target.value)}>
            {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </label>

        <label className="wsm-dms-filter">
          <span className="wsm-label">Report</span>
          <select className={label ? 'wsm-dms-select-on' : ''} value={label} onChange={(e) => setLabel(e.target.value)}>
            {reports.map((r) => (
              <option key={r.label} value={r.label}>{r.is_deployed ? '● deployed — ' : ''}{r.label}</option>
            ))}
          </select>
        </label>
        <label className="wsm-dms-filter">
          <span className="wsm-label">Base</span>
          <select className={baseLabel ? 'wsm-dms-select-on' : ''} value={baseLabel} onChange={(e) => setBaseLabel(e.target.value)}>
            <option value="">whole report (no diff)</option>
            {reports.filter((r) => r.label !== label).map((r) => (
              <option key={r.label} value={r.label}>{r.is_deployed ? '● deployed — ' : ''}{r.label}</option>
            ))}
          </select>
        </label>

        {diffing && (
          <span className="wsm-hs-diffchips">
            {['NEW', 'RECURRING', 'FIXED'].map((d) => (
              <button
                key={d}
                type="button"
                className={`btn btn-small${diffCategory === d ? ' wsm-chipbtn-on' : ''}`}
                onClick={() => setDiffCategory(d)}
              >
                {d.toLowerCase()}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="wsm-hs-cats" role="tablist" aria-label="Scan category">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={category === c.key}
            className={`btn btn-small${category === c.key ? ' wsm-chipbtn-on' : ''}`}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && <div className="banner banner-err" role="alert">{error}</div>}

      {!ready && !error && <p className="wsm-empty">Loading build…</p>}

      {ready && diffing && (
        <>
          {diff && (
            <div className="wsm-hs-scans">
              {(diff.scans || []).map((sc) => (
                <span
                  key={sc.name}
                  className={`summary-chip${sc.blocking_status === 'BLOCKED' ? ' summary-chip-attn' : ''}`}
                  title={sc.note || ''}
                >
                  {sc.display.replace(/_/g, ' ').toLowerCase()}
                  {' · '}
                  {sc.ran
                    ? `${sc.summary.TOTAL} ${diffCategory.toLowerCase()}`
                    : sc.uncomparable ? 'base never ran it' : sc.status.replace(/_/g, ' ').toLowerCase()}
                </span>
              ))}
            </div>
          )}

          <div className="wsm-dms-bar">
            {category === 'CODE_VIOLATIONS' && (
              <label className="wsm-dms-filter">
                <span className="wsm-label">Language</span>
                <select className="wsm-dms-select-on" value={fileType} onChange={(e) => setFileType(e.target.value)}>
                  {['java', 'js', 'python', 'clang'].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            )}
            <span className="wsm-count wsm-dms-shown">
              {busy ? 'Loading…' : `${total} ${diffCategory.toLowerCase()} vs base`}
            </span>
            {diff?.report_link && (
              <a className="btn btn-ghost" href={diff.report_link} target="_blank" rel="noopener noreferrer">
                Open diff in Hacksaw ↗
              </a>
            )}
          </div>

          {scanStat && scanStat.uncomparable && (
            <div className="banner" role="status">
              The base build never ran this scan, so there is nothing to compare — this is not a
              clean result.
            </div>
          )}

          <div className="pane wsm-dms-pane">
            <div className="wsm-dms-table" key={`d|${product}|${label}|${baseLabel}|${category}|${diffCategory}|${fileType}`}>
              <div className="wsm-dms-head" style={{ gridTemplateColumns: '104px minmax(0, 1.4fr) minmax(0, 1.6fr) 104px 86px' }}>
                <div>Priority</div><div>Rule</div><div>File</div><div>Status</div><div>Line</div>
              </div>
              {rows.map((v, i) => (
                <div key={`${v.id}-${v.type_specific_id}-${i}`}>
                  <div
                    data-row="1"
                    className="wsm-dms-row wsm-hs-row"
                    style={{ gridTemplateColumns: '104px minmax(0, 1.4fr) minmax(0, 1.6fr) 104px 86px' }}
                    onClick={() => setOpenRow(openRow === i ? null : i)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenRow(openRow === i ? null : i); } }}
                  >
                    <div>
                      <span className={`wsm-hs-prio tag ${v.priority === 'ERROR' ? 'tag-bad' : v.priority === 'WARNING' ? 'summary-chip-attn' : 'tag-muted'}`}>
                        {v.priority}
                      </span>
                    </div>
                    <div className="wsm-dms-name">{v.rule}</div>
                    <div className="wsm-dms-muted wsm-hs-file" title={v.file_name}>{v.file_name}</div>
                    <div className="wsm-dms-muted">{v.status === 'OPEN' ? 'Open' : String(v.status).replace(/_/g, ' ').toLowerCase()}</div>
                    <div className="wsm-dms-muted wsm-dms-date">{v.line_no}</div>
                  </div>
                  {openRow === i && (
                    <div className="wsm-hs-detail">
                      <pre className="wsm-hs-snippet">{v.snippet || '(no snippet)'}</pre>
                      <div className="wsm-hs-meta">
                        {v.standards.map((x) => <span key={x} className="tag">{x}</span>)}
                        {v.context && <span className="tag tag-muted">{v.context}</span>}
                        {v.entropy !== null && <span className="tag tag-muted" title="Shannon entropy of the matched secret">entropy {v.entropy}</span>}
                        {v.is_blocked && <span className="tag tag-bad">blocking</span>}
                        {v.link && <a className="btn btn-small" href={v.link} target="_blank" rel="noopener noreferrer">Open in Hacksaw ↗</a>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!busy && rows.length === 0 && (
                <p className="wsm-empty">Nothing {diffCategory.toLowerCase()} in this scan against the base build.</p>
              )}
              {busy && <p className="wsm-empty">Loading…</p>}
            </div>
          </div>
        </>
      )}

      {ready && !diffing && (category === 'VULNERABLE_COMPONENTS'
        ? <HacksawComponents key={`c|${product}|${label}`} onNotice={onNotice} product={product} label={label} />
        : <HacksawViolations key={`v|${product}|${label}|${category}`} onNotice={onNotice} product={product} label={label} initialScan={category} />
      )}
    </div>
  );
}
