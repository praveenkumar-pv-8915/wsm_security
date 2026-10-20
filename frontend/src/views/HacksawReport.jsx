import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { RefreshIcon } from '../lib/icons';

/**
 * Hacksaw › Hacksaw Report — built to the v7 design (design/WSM Security v7.bundled.html).
 *
 * v7 gives the Hacksaw group two tools; this is `violations`, titled "Hacksaw Report", over the
 * categories viol · mis · sec · vuln · iast. Vulnerable components is a CATEGORY here, not a nav
 * item, which is why the module has two tabs and not four.
 *
 * Layout follows the design: a context bar of inline pickers, a tab strip with per-category
 * counts and a blocking total, a filter toolbar with select-all and bulk actions, then findings
 * as cards — severity edge, rule, file, code line, assignee, a decision dropdown and a sync chip.
 *
 * ── Two deliberate adaptations ───────────────────────────────────────────────────────────────
 *
 * **Base build.** The design's subtitle is "scan findings new in WIP vs base", and the base
 * picker is kept from the earlier build: choosing one switches the whole screen to Hacksaw's
 * diff report (new / recurring / fixed). "Whole report" turns the diff off.
 *
 * **No review state here.** Replies, AI verdicts and accept/respond belong to Hacksaw Reviewer and
 * its own tables (decided 2026-10-20). A finding card on this screen shows Hacksaw's own status
 * and its remaining temporary exclusions (the design's "R.T.E 1/3"); it records nothing.
 */

const CATEGORIES = [
  { key: 'CODE_VIOLATIONS', label: 'Code violations' },
  { key: 'MISCONFIGURATIONS', label: 'Misconfigurations' },
  { key: 'HARDCODED_SECRETS', label: 'Hardcoded secrets' },
  { key: 'VULNERABLE_COMPONENTS', label: 'Vulnerable components' },
  { key: 'RUNTIME_CODE_VIOLATIONS', label: 'IAST' },
];

const FILE_TYPES = ['java', 'js', 'python', 'clang'];

const sevClass = (p) => (p === 'ERROR' ? 'wsm-hs-sev-err' : p === 'WARNING' ? 'wsm-hs-sev-warn' : 'wsm-hs-sev-info');
const initialsOf = (email) => String(email || '').replace(/@.*/, '').split(/[._-]/).filter(Boolean).slice(0, 2)
  .map((x) => x[0]).join('').toUpperCase() || '—';

/** An inline "LABEL value ▾" picker, as the design's context bar uses. */
function Picker({ label, value, onChange, options, render = (o) => o, keyOf = (o) => o }) {
  return (
    <label className="wsm-hs-pick">
      <span className="wsm-hs-pick-l">{label}</span>
      <span className="wsm-hs-pick-v">{render(options.find((o) => keyOf(o) === value) ?? value) || '—'}</span>
      <span className="wsm-hs-pick-c" aria-hidden="true">▾</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((o) => <option key={keyOf(o)} value={keyOf(o)}>{render(o)}</option>)}
      </select>
    </label>
  );
}

export default function HacksawReport({ onNotice }) {
  const [products, setProducts] = useState([]);
  const [product, setProduct] = useState('');
  const [reports, setReports] = useState([]);
  const [label, setLabel] = useState('');
  const [baseLabel, setBaseLabel] = useState('');
  const [diffCategory, setDiffCategory] = useState('NEW');
  const [category, setCategory] = useState('CODE_VIOLATIONS');
  const [fileType, setFileType] = useState('java');

  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState({});
  const [q, setQ] = useState('');
  const [fSev, setFSev] = useState('All');
  const [fHs, setFHs] = useState('All');
  const [blockingOnly, setBlockingOnly] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const diffing = Boolean(baseLabel);
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

  /** Hacksaw Reviewer hands over a build pair; honour it once, then behave normally. */
  const handover = useRef(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('wsm.hacksaw.reviewContext');
      if (raw) {
        handover.current = JSON.parse(raw);
        sessionStorage.removeItem('wsm.hacksaw.reviewContext');
        if (handover.current?.product) setProduct(handover.current.product);
      }
    } catch { /* nothing handed over */ }
  }, []);

  useEffect(() => {
    if (!product) return undefined;
    let live = true;
    setError(''); setReports([]); setLabel(''); setBaseLabel('');
    (async () => {
      try {
        const r = await api(`/hacksaw/reports?product=${encodeURIComponent(product)}&limit=50`);
        if (!live) return;
        const list = r.reports || [];
        setReports(list);
        // The deployed build, not the newest: what is live is what is worth reviewing.
        const over = handover.current;
        const wip = (over?.product === product && over?.label)
          ? over.label
          : (list.find((x) => x.is_deployed) || list[0] || {}).label || '';
        setLabel(wip);
        if (over?.product === product) {
          setBaseLabel(over.base_label || '');
          handover.current = null;
        } else {
          const at = list.findIndex((x) => x.label === wip);
          setBaseLabel(at >= 0 && list[at + 1] ? list[at + 1].label : '');
        }
      } catch (err) { if (live) fail(err, 'Could not list reports.'); }
    })();
    return () => { live = false; };
  }, [product]);

  /* Per-category counts for the tab strip: the diff's scans when diffing, else the report's. */
  useEffect(() => {
    if (!product || !label) { setStats(null); return undefined; }
    let live = true;
    (async () => {
      try {
        const q2 = new URLSearchParams({ product, label });
        if (diffing) { q2.set('base_label', baseLabel); q2.set('diff_type', diffCategory); }
        const r = await api(`/hacksaw/${diffing ? 'diff' : 'report'}?${q2}`);
        if (live) setStats((diffing ? r.diff : r.report) || null);
      } catch { if (live) setStats(null); }
    })();
    return () => { live = false; };
  }, [product, label, baseLabel, diffing, diffCategory]);

  /** One normalised row shape, whatever endpoint produced it. */
  const normalise = useCallback((v, kind) => (kind === 'component'
    ? {
      key: v.key, id: v.id, kind: 'component',
      rule: `${v.name} ${v.version}`, file: v.path, line: null,
      snippet: v.identifier, priority: v.is_blocked ? 'ERROR' : 'WARNING',
      hacksaw_status: v.status, blocked: v.is_blocked, assignee: v.assignee,
      link: null, extra: `${v.vulnerability_count} CVE${v.vulnerability_count === 1 ? '' : 's'}`,
      identifier: v.identifier, rte: null,
    }
    : {
      key: v.key, id: v.id, kind: 'violation',
      rule: v.rule, file: v.file_name, line: v.line_no,
      snippet: v.snippet, priority: v.priority,
      hacksaw_status: v.status, blocked: v.is_blocked, assignee: v.assignee,
      link: v.link, extra: null,
      rte: v.temporary_exclusions_limit ? `${v.temporary_exclusions_left}/${v.temporary_exclusions_limit}` : null,
    }), []);

  const load = useCallback(async () => {
    if (!product || !label) return;
    const mine = ++seq.current;
    setBusy(true); setError(''); setRows([]); setPicked({});
    try {
      let out = [];
      let count = 0;
      if (diffing) {
        const p = new URLSearchParams({
          product, label, base_label: baseLabel, scan: category, diff_category: diffCategory, limit: '50',
        });
        if (category === 'CODE_VIOLATIONS') p.set('file_type', fileType);
        const r = await api(`/hacksaw/diff-violations?${p}`);
        out = (r.violations || []).map((v) => normalise(v, 'violation'));
        count = r.total || 0;
      } else if (category === 'VULNERABLE_COMPONENTS') {
        const r = await api(`/hacksaw/components?product=${encodeURIComponent(product)}&label=${encodeURIComponent(label)}`);
        out = (r.components || []).map((v) => normalise(v, 'component'));
        count = r.total || 0;
      } else {
        const p = new URLSearchParams({ product, label, scan: category, limit: '50' });
        if (category === 'CODE_VIOLATIONS') p.set('file_type', fileType);
        const r = await api(`/hacksaw/violations?${p}`);
        out = (r.violations || []).map((v) => normalise(v, 'violation'));
        count = r.total || 0;
      }
      if (mine !== seq.current) return;
      setRows(out); setTotal(count);
    } catch (err) {
      if (mine !== seq.current) return;
      setRows([]); setTotal(0);
      fail(err, 'Could not load findings.');
      if (err instanceof ApiError && err.status === 429) onNotice?.(err.message);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, [product, label, baseLabel, diffing, diffCategory, category, fileType, normalise, onNotice]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (
      (!needle || [r.rule, r.file, r.snippet].some((x) => String(x || '').toLowerCase().includes(needle)))
      && (fSev === 'All' || r.priority === fSev)
      && (fHs === 'All' || r.hacksaw_status === fHs)
      && (!blockingOnly || r.blocked)
    ));
  }, [rows, q, fSev, fHs, blockingOnly]);

  const pickedKeys = Object.keys(picked).filter((k) => picked[k]);
  const allPicked = shown.length > 0 && shown.every((r) => picked[r.key]);
  const filtersOn = Boolean(q || fSev !== 'All' || fHs !== 'All' || blockingOnly);

  const countFor = useCallback((catKey) => {
    const all = (stats?.scans || []).flatMap((s) => [s, ...(s.subscans || [])]);
    const sc = all.find((s) => s.name === catKey || s.display === catKey);
    if (!sc) return null;
    if (!sc.ran) return sc.uncomparable ? '—' : '·';
    return diffing ? sc.summary.TOTAL : sc.summary.OPEN;
  }, [stats, diffing]);

  const blocking = shown.filter((r) => r.blocked).length;

  return (
    <div className="wsm-hs">
      <div className="wsm-hs-ctx">
        <Picker label="Product" value={product} onChange={setProduct} options={products}
                render={(p) => p.name || p} keyOf={(p) => p.name || p} />
        <Picker label="Report" value={label} onChange={setLabel} options={reports}
                render={(r) => `${r.is_deployed ? '● deployed — ' : ''}${r.label}`} keyOf={(r) => r.label} />
        <Picker label="Base" value={baseLabel} onChange={setBaseLabel}
                options={[{ label: '', name: 'whole report (no diff)' }, ...reports.filter((r) => r.label !== label)]}
                render={(r) => r.name || `${r.is_deployed ? '● deployed — ' : ''}${r.label}`} keyOf={(r) => r.label} />
        {diffing && (
          <Picker label="Diff" value={diffCategory} onChange={setDiffCategory} options={['NEW', 'RECURRING', 'FIXED']} />
        )}
        {category === 'CODE_VIOLATIONS' && (
          <Picker label="Language" value={fileType} onChange={setFileType} options={FILE_TYPES} />
        )}
        <span className="wsm-hs-ctx-r">
          <button type="button" className="btn btn-ghost btn-icon" onClick={load} disabled={busy}
                  title="Refresh from Hacksaw" aria-label="Refresh from Hacksaw">
            <RefreshIcon />
          </button>
          {stats?.report_link && (
            <a className="btn" href={stats.report_link} target="_blank" rel="noopener noreferrer">Open in Hacksaw ↗</a>
          )}
        </span>
      </div>

      <div className="wsm-hs-tabs" role="tablist" aria-label="Scan category">
        {CATEGORIES.map((c) => {
          const n = countFor(c.key);
          return (
            <button key={c.key} type="button" role="tab" aria-selected={category === c.key}
                    className={`wsm-hs-tab${category === c.key ? ' wsm-hs-tab-on' : ''}`}
                    onClick={() => setCategory(c.key)}>
              {c.label}
              {n !== null && <span className="wsm-hs-tabn">{n}</span>}
            </button>
          );
        })}
        <span className="wsm-hs-tabs-r">
          {diffing ? `${total} ${diffCategory.toLowerCase()}` : `${total} finding${total === 1 ? '' : 's'}`}
          {blocking > 0 && <span className="wsm-hs-blk"> ⃠ {blocking} blocking</span>}
        </span>
      </div>

      <div className="wsm-hs-tools">
        <input type="checkbox" aria-label="Select all findings" checked={allPicked}
               onChange={(e) => setPicked(e.target.checked
                 ? Object.fromEntries(shown.map((r) => [r.key, true])) : {})} />
        {pickedKeys.length === 0 ? (
          <>
            <input type="search" className="wsm-search" placeholder="Search file, rule, endpoint"
                   aria-label="Search findings" value={q} onChange={(e) => setQ(e.target.value)} />
            <Picker label="Severity" value={fSev} onChange={setFSev} options={['All', 'ERROR', 'WARNING', 'INFO']} />
            <Picker label="Hacksaw" value={fHs} onChange={setFHs}
                    options={['All', ...Array.from(new Set(rows.map((r) => r.hacksaw_status).filter(Boolean)))]} />
            <label className={`wsm-hs-blkchip${blockingOnly ? ' wsm-chipbtn-on' : ''}`}>
              <input type="checkbox" checked={blockingOnly} onChange={(e) => setBlockingOnly(e.target.checked)} />
              Blocking only
            </label>
            {filtersOn && (
              <button type="button" className="wsm-hs-clear"
                      onClick={() => { setQ(''); setFSev('All'); setFHs('All'); setBlockingOnly(false); }}>
                Clear
              </button>
            )}
          </>
        ) : (
          <>
            <span className="wsm-hs-sel">{pickedKeys.length} selected</span>
            <span className="hint">Decisions are made in Hacksaw Reviewer — this screen records nothing.</span>
            <button type="button" className="wsm-hs-clear" onClick={() => setPicked({})}>Clear selection</button>
          </>
        )}
        <span className="wsm-hs-tools-r">{shown.length} finding{shown.length === 1 ? '' : 's'}</span>
      </div>

      {error && <div className="banner banner-err" role="alert">{error}</div>}

      <div className="wsm-hs-list">
        {shown.map((r) => {
          return (
            <div key={r.key} className={`wsm-hs-card ${sevClass(r.priority)}`}>
              <div className="wsm-hs-card-head">
                <input type="checkbox" aria-label={`Select ${r.rule}`} checked={!!picked[r.key]}
                       onChange={(e) => setPicked((m) => ({ ...m, [r.key]: e.target.checked }))} />
                <span className="wsm-hs-rule">
                  {String(r.rule || '').toUpperCase().replace(/\s+/g, '_')}
                  {r.blocked && <span className="wsm-hs-blkmark" title="Blocking">⃠</span>}
                </span>
                <span className="wsm-hs-card-r">
                  <span className="wsm-hs-who" title={r.assignee || 'Unassigned'}>
                    <span className="wsm-hs-av">{initialsOf(r.assignee)}</span>
                    {r.assignee && r.assignee !== 'UNASSIGNED' ? r.assignee : 'unassigned'}
                  </span>
                  <span className={`wsm-hs-sync${r.hacksaw_status === 'OPEN' ? ' wsm-hs-sync-pending' : ''}`}>
                    {String(r.hacksaw_status || '—').replace(/_/g, ' ').toLowerCase()}
                  </span>
                  {r.rte && <span className="wsm-hs-sync" title="Remaining temporary exclusions">R.T.E {r.rte}</span>}
                </span>
              </div>

              <a className="wsm-hs-path" href={r.link || undefined} target="_blank" rel="noopener noreferrer">
                {r.file}{r.extra ? ` · ${r.extra}` : ''}
              </a>

              {r.snippet && (
                <div className="wsm-hs-code">
                  {r.line !== null && <span className="wsm-hs-ln">{r.line}</span>}
                  <code>{r.snippet}</code>
                </div>
              )}
            </div>
          );
        })}

        {!busy && shown.length === 0 && (
          <div className="wsm-hs-ok"><span>✓</span>{rows.length === 0
            ? `Nothing ${diffing ? diffCategory.toLowerCase() : 'open'} in this scan.`
            : 'No findings match this search or filter.'}</div>
        )}
        {busy && <p className="wsm-empty">Loading…</p>}
      </div>
    </div>
  );
}
