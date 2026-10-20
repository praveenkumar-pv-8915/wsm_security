import { useCallback, useEffect, useState } from 'react';
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
 * NOT yet v7: the design frames this as "scan findings new in WIP vs base" — a diff between a
 * work-in-progress build and a base build, via Hacksaw's /api/diffreports. This renders the
 * findings of ONE report. The report picker is the stand-in for the WIP side until the diff is
 * built; see claude/hacksaw-module-design.md.
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
  const [error, setError] = useState('');

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
      setLabel((list.find((x) => x.is_deployed) || list[0] || {}).label || '');
    } catch (err) { fail(err, 'Could not list reports.'); }
  }, [product]);

  useEffect(() => { loadReports(); }, [loadReports]);

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

      {ready && (category === 'VULNERABLE_COMPONENTS'
        ? <HacksawComponents key={`c|${product}|${label}`} onNotice={onNotice} product={product} label={label} />
        : <HacksawViolations key={`v|${product}|${label}|${category}`} onNotice={onNotice} product={product} label={label} initialScan={category} />
      )}
    </div>
  );
}
