import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { RefreshIcon } from '../lib/icons';

/**
 * Hacksaw › Hacksaw Reviewer — the v7 design's `hreview` tool, as a review queue.
 *
 * Built to the design's table (design/WSM Security v7.bundled.html): a search box and status
 * tabs over a sticky-headed grid of Status · Project · Reviewer · Repos · one column per scan ·
 * Components · Submitted, with the row opening the review.
 *
 * This is NOT the Report screen with different chrome. A review carries things a report never
 * does — an assignee, an approval state, comment threads and an AI verdict per finding — which
 * is why they are separate tabs and separate stores.
 *
 * ── What is real here, and what is waiting on tables ─────────────────────────────────────────
 *
 * Review records live in `tool_config` today. The threads (reviewer comment → developer reply →
 * reviewer response) and the per-finding AI verdict need the three DataStore tables agreed on
 * 2026-10-20 — `hacksaw_review`, `hacksaw_review_comment`, `hacksaw_finding_verdict` — which can
 * only be created in the Catalyst console (datastore-conventions.md: no API, SDK or CLI for
 * table creation). Until they exist this screen shows the queue and the approval actions; the
 * thread and verdict panes attach to the row detail once they do.
 *
 * Counts come from one `fetchdiffstatistics` call per review, which returns every scan at once —
 * deliberately one request per row, because Hacksaw locks an endpoint for 5–10 minutes past 50
 * requests a minute and a queue of reviews is exactly where a fan-out would trip it.
 */

const STATUS_TABS = [
  ['all', 'All'],
  ['pending', 'Pending'],
  ['changes', 'Changes requested'],
  ['approved', 'Approved'],
];

/** The design marks state with a glyph in its own column, not a word. */
const MARK = {
  pending: { glyph: '⧗', cls: 'wsm-hsr-m-pending', title: 'Waiting on a reviewer' },
  changes: { glyph: '✎', cls: 'wsm-hsr-m-changes', title: 'Changes requested before approval' },
  approved: { glyph: '✓', cls: 'wsm-hsr-m-approved', title: 'Approved' },
};

const SCAN_COLS = [
  ['CODE_VIOLATIONS', 'Code violations'],
  ['MISCONFIGURATIONS', 'Misconfigurations'],
  ['HARDCODED_SECRETS', 'Hardcoded secrets'],
  ['RUNTIME_CODE_VIOLATIONS', 'IAST'],
];

const COLS = '56px minmax(140px, 1.1fr) minmax(150px, 1fr) minmax(170px, 1.2fr) repeat(4, 104px) 112px minmax(150px, 0.9fr)';

const initialsOf = (v) => String(v || '').replace(/@.*/, '').split(/[._\s-]/).filter(Boolean)
  .slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '··';

export default function HacksawReviewer({ onNotice }) {
  const [reviews, setReviews] = useState([]);
  const [counts, setCounts] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState('');

  const [products, setProducts] = useState([]);
  const [reports, setReports] = useState([]);
  const [draft, setDraft] = useState({ product: '', label: '', base_label: '' });
  const [adding, setAdding] = useState(false);

  const fail = (err, fallback) => setError(err instanceof ApiError ? err.message : fallback);

  const load = useCallback(async () => {
    setStatus('loading'); setError('');
    try {
      const r = await api('/hacksaw/reviews');
      const list = r.reviews || [];
      setReviews(list);
      setStatus('ok');
      window.dispatchEvent(new CustomEvent('wsm:section-count', {
        detail: { path: '/hacksaw-reviewer', count: r.pending || 0 },
      }));

      // One diff call per review, sequentially — see the throttle note in the header.
      for (const rev of list) {
        if (!rev.base_label) continue;
        try {
          const p = new URLSearchParams({
            product: rev.product, label: rev.label, base_label: rev.base_label, diff_type: 'NEW',
          });
          const d = await api(`/hacksaw/diff?${p}`);
          const flat = (d.diff?.scans || []).flatMap((s) => [s, ...(s.subscans || [])]);
          const by = {};
          for (const [key] of SCAN_COLS) {
            const sc = flat.find((s) => s.name === key || s.display === key);
            by[key] = sc ? (sc.ran ? sc.summary.TOTAL : (sc.uncomparable ? '—' : '·')) : null;
          }
          const comp = flat.find((s) => s.display === 'VULNERABLE_COMPONENTS');
          by.COMPONENTS = comp && comp.ran ? comp.summary.TOTAL : null;
          setCounts((m) => ({ ...m, [rev.id]: by }));
        } catch { /* a row without counts still lists; the diff may simply not be comparable */ }
      }
    } catch (err) {
      setStatus('error'); fail(err, 'Could not load reviews.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!adding) return undefined;
    let live = true;
    (async () => {
      try {
        const r = await api('/hacksaw/products');
        if (!live) return;
        setProducts(r.products || []);
        setDraft((d) => ({ ...d, product: d.product || (r.products || [])[0]?.name || '' }));
      } catch (err) { if (live) fail(err, 'Could not reach Hacksaw.'); }
    })();
    return () => { live = false; };
  }, [adding]);

  useEffect(() => {
    if (!adding || !draft.product) return undefined;
    let live = true;
    (async () => {
      try {
        const r = await api(`/hacksaw/reports?product=${encodeURIComponent(draft.product)}&limit=50`);
        if (!live) return;
        const list = r.reports || [];
        setReports(list);
        setDraft((d) => ({ ...d, label: (list[0] || {}).label || '', base_label: (list[1] || {}).label || '' }));
      } catch (err) { if (live) fail(err, 'Could not list reports.'); }
    })();
    return () => { live = false; };
  }, [adding, draft.product]);

  const create = async () => {
    if (!draft.product || !draft.label) return;
    try {
      await api('/hacksaw/reviews', { method: 'POST', body: draft });
      setAdding(false); onNotice?.('Review raised.'); await load();
    } catch (err) { fail(err, 'Could not raise the review.'); }
  };

  const decide = async (rev, next) => {
    setBusyId(rev.id);
    try {
      await api(`/hacksaw/reviews/${encodeURIComponent(rev.id)}`, { method: 'PATCH', body: { status: next } });
      onNotice?.(next === 'approved' ? `${rev.id} approved.` : `${rev.id} sent back for changes.`);
      await load();
    } catch (err) { fail(err, 'Could not update the review.'); } finally { setBusyId(''); }
  };

  const claim = async (rev) => {
    try {
      await api(`/hacksaw/reviews/${encodeURIComponent(rev.id)}`, { method: 'PATCH', body: { claim: true } });
      await load();
    } catch (err) { fail(err, 'Could not assign the review.'); }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reviews.filter((r) => (
      (tab === 'all' || (r.status || 'pending') === tab)
      && (!needle || [r.id, r.product, r.label, r.reviewer_name, r.raised_by_name, r.reviewer_id, r.raised_by]
        .some((x) => String(x || '').toLowerCase().includes(needle)))
    ));
  }, [reviews, q, tab]);

  const cell = (v) => (v === null || v === undefined
    ? <span className="wsm-hsr-n0">·</span>
    : v === '—' ? <span className="wsm-hsr-n0" title="The base build never ran this scan">—</span>
      : v === 0 ? <span className="wsm-hsr-n0">0</span>
        : <span className="wsm-hsr-n">{v}</span>);

  return (
    <div className="wsm-hs">
      <div className="wsm-hsr-bar">
        <input type="search" className="wsm-hsr-q" placeholder="Search project, repo, reviewer"
               aria-label="Search reviews" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="wsm-hsr-tabs" role="tablist" aria-label="Review status">
          {STATUS_TABS.map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v}
                    className={`wsm-hsr-tab${tab === v ? ' wsm-hsr-tab-on' : ''}`} onClick={() => setTab(v)}>
              {l}
            </button>
          ))}
        </div>
        <span className="wsm-hsr-shown">{shown.length} of {reviews.length} reviews</span>
        <button type="button" className="btn btn-ghost btn-icon" onClick={load} disabled={status === 'loading'}
                title="Refresh" aria-label="Refresh reviews">
          <RefreshIcon />
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel' : 'Raise a review'}
        </button>
      </div>

      {adding && (
        <div className="wsm-hs-tools">
          <label className="wsm-dms-filter">
            <span className="wsm-label">Project</span>
            <select className="wsm-dms-select-on" value={draft.product}
                    onChange={(e) => setDraft((d) => ({ ...d, product: e.target.value }))}>
              {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
          <label className="wsm-dms-filter">
            <span className="wsm-label">Build</span>
            <select className="wsm-dms-select-on" value={draft.label}
                    onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}>
              {reports.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
            </select>
          </label>
          <label className="wsm-dms-filter">
            <span className="wsm-label">Base</span>
            <select className={draft.base_label ? 'wsm-dms-select-on' : ''} value={draft.base_label}
                    onChange={(e) => setDraft((d) => ({ ...d, base_label: e.target.value }))}>
              <option value="">none</option>
              {reports.filter((r) => r.label !== draft.label).map((r) => (
                <option key={r.label} value={r.label}>{r.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={create}>Raise</button>
        </div>
      )}

      {error && <div className="banner banner-err" role="alert">{error}</div>}

      <div className="pane wsm-hsr-pane">
        <div className="wsm-hsr-grid">
          <div className="wsm-hsr-head" style={{ gridTemplateColumns: COLS }}>
            <div>Status</div>
            <div>Project</div>
            <div>Reviewer</div>
            <div>Repos</div>
            {SCAN_COLS.map(([k, l]) => <div key={k} className="wsm-hsr-num">{l}</div>)}
            <div className="wsm-hsr-num">Components</div>
            <div>Submitted</div>
          </div>

          {shown.map((r) => {
            const st = r.status || 'pending';
            const mk = MARK[st] || MARK.pending;
            const n = counts[r.id] || {};
            const open = openId === r.id;
            return (
              <div key={r.id}>
                <div
                  className="wsm-hsr-row"
                  style={{ gridTemplateColumns: COLS }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(open ? null : r.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(open ? null : r.id); } }}
                >
                  <div><span className={`wsm-hsr-mark ${mk.cls}`} title={mk.title}>{mk.glyph}</span></div>
                  <div className="wsm-hsr-proj">{r.product}<span className="wsm-hsr-id">{r.id}</span></div>
                  <div onClick={(e) => e.stopPropagation()}>
                    {r.reviewer_id ? (
                      <span className="wsm-hsr-rev">
                        <span className="wsm-hs-av">{initialsOf(r.reviewer_name || r.reviewer_id)}</span>
                        <span className="wsm-hsr-revn" title={r.reviewer_name || r.reviewer_id}>
                          {r.reviewer_name || r.reviewer_id}
                        </span>
                      </span>
                    ) : (
                      <button type="button" className="wsm-hsr-assign" onClick={() => claim(r)}>+ Assign</button>
                    )}
                  </div>
                  <div className="wsm-hsr-repos">
                    <span className="wsm-hsr-repo" title={r.label}>{r.label}</span>
                    {r.base_label && <span className="wsm-hsr-vs" title={r.base_label}>vs {r.base_label}</span>}
                  </div>
                  {SCAN_COLS.map(([k]) => <div key={k} className="wsm-hsr-num">{cell(n[k])}</div>)}
                  <div className="wsm-hsr-num">{cell(n.COMPONENTS)}</div>
                  <div className="wsm-hsr-sub">
                    {r.raised_by_name || r.raised_by}
                    <span className="wsm-hsr-at">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                </div>

                {open && (
                  <div className="wsm-hsr-detail">
                    <div className="wsm-hs-card-head">
                      <span className="wsm-hs-rule">{r.id} · {r.product}</span>
                      <span className="wsm-hs-card-r">
                        <button type="button" className="btn btn-small" disabled={busyId === r.id}
                                onClick={() => decide(r, 'changes')}>Request changes</button>
                        <button type="button" className="btn btn-primary btn-small" disabled={busyId === r.id}
                                onClick={() => decide(r, 'approved')}>Approve</button>
                      </span>
                    </div>
                    <p className="hint">
                      {r.base_label
                        ? `${r.label} against ${r.base_label}.`
                        : `${r.label} — no base build, so there is nothing to compare.`}
                    </p>
                    <p className="hint">
                      Comment threads and the per-finding AI verdict attach here once the three
                      review tables exist in the Catalyst console.
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {status === 'ok' && shown.length === 0 && (
            <p className="wsm-empty">
              {reviews.length === 0 ? 'No reviews yet. Raise one against a build to start.' : 'No reviews match this search or filter.'}
            </p>
          )}
          {status === 'loading' && <p className="wsm-empty">Loading…</p>}
        </div>
      </div>
    </div>
  );
}
