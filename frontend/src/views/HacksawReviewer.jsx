import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { RefreshIcon } from '../lib/icons';
import HacksawReviewDetail from './HacksawReviewDetail';
import SearchSelect from '../components/SearchSelect';

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
  ['draft', 'Draft'],
  ['submitted', 'Pending review'],
  ['closed', 'Closed'],
];

/** The design marks state with a glyph in its own column, not a word. */
const MARK = {
  draft: { glyph: '✎', cls: 'wsm-hsr-m-changes', title: 'Developer is still replying to findings' },
  submitted: { glyph: '⧗', cls: 'wsm-hsr-m-pending', title: 'Waiting on a reviewer' },
  closed: { glyph: '✓', cls: 'wsm-hsr-m-approved', title: 'Closed — every finding accepted' },
};

const SCAN_COLS = [
  ['CODE_VIOLATIONS', 'Code violations'],
  ['MISCONFIGURATIONS', 'Misconfigurations'],
  ['HARDCODED_SECRETS', 'Hardcoded secrets'],
  ['RUNTIME_CODE_VIOLATIONS', 'IAST'],
];

const COLS = '78px minmax(140px, 1.1fr) minmax(150px, 1fr) minmax(170px, 1.2fr) repeat(4, 124px) 116px minmax(150px, 0.9fr)';

const initialsOf = (v) => String(v || '').replace(/@.*/, '').split(/[._\s-]/).filter(Boolean)
  .slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '··';

export default function HacksawReviewer({ onNotice }) {
  const [reviews, setReviews] = useState([]);
  const [counts, setCounts] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');

  const [products, setProducts] = useState([]);
  const [reportsBy, setReportsBy] = useState({});
  const [repos, setRepos] = useState([]);
  const [adding, setAdding] = useState(false);
  const [openKey, setOpenKey] = useState(null);

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

      // One diff call per repo, sequentially, summed per review — see the throttle note above.
      for (const rev of list) {
        const sum = {};
        for (const rp of rev.repos || []) {
          if (!rp.base_label) continue;
          try {
            const p = new URLSearchParams({
              product: rp.product, label: rp.feature_label, base_label: rp.base_label, diff_type: 'NEW',
            });
            const d = await api(`/hacksaw/diff?${p}`);
            const flat = (d.diff?.scans || []).flatMap((s) => [s, ...(s.subscans || [])]);
            for (const [key] of SCAN_COLS) {
              const sc = flat.find((s) => s.name === key || s.display === key);
              if (!sc) continue;
              if (sc.ran) sum[key] = (typeof sum[key] === 'number' ? sum[key] : 0) + sc.summary.TOTAL;
              else if (sum[key] === undefined) sum[key] = sc.uncomparable ? '—' : '·';
            }
          } catch { /* a repo without counts still lists */ }
          try {
            // Jar deltas — two inventory fetches per pair the first time, then served from tool_state.
            const q2 = new URLSearchParams({ product: rp.product, label: rp.feature_label, base_label: rp.base_label });
            const d2 = await api(`/hacksaw/component-delta?${q2}`);
            const c = sum.DELTA || { added: 0, updated: 0, removed: 0 };
            sum.DELTA = { added: c.added + (d2.added || 0), updated: c.updated + (d2.updated || 0), removed: c.removed + (d2.removed || 0) };
          } catch { /* the column shows a dot */ }
        }
        setCounts((m) => ({ ...m, [rev.key]: sum }));
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
        if (live) setProducts(r.products || []);
      } catch (err) { if (live) fail(err, 'Could not reach Hacksaw.'); }
    })();
    return () => { live = false; };
  }, [adding]);

  const reportsFor = useCallback(async (product) => {
    if (!product || reportsBy[product]) return;
    try {
      const r = await api(`/hacksaw/reports?product=${encodeURIComponent(product)}&limit=50`);
      setReportsBy((m) => ({ ...m, [product]: r.reports || [] }));
    } catch (err) { fail(err, 'Could not list reports.'); }
  }, [reportsBy]);

  const addRepo = () => {
    const product = products[0]?.name || '';
    setRepos((list) => [...list, { product, feature_label: '', base_label: '' }]);
    reportsFor(product);
  };
  const setRepo = (i, patch) => setRepos((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const create = async () => {
    const ready = repos.filter((r) => r.product && r.feature_label);
    if (!ready.length) return;
    try {
      await api('/hacksaw/reviews', { method: 'POST', body: { repos: ready } });
      setAdding(false); setRepos([]);
      onNotice?.('Review created — reply to each finding, then submit it.');
      await load();
    } catch (err) { fail(err, 'Could not create the review.'); }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reviews.filter((r) => (
      (tab === 'all' || (r.status || 'draft') === tab)
      && (!needle || [r.key, r.title, r.reviewer_person?.email, r.reviewer_person?.name, r.raised_by_person?.email,
        r.raised_by_person?.name, ...(r.repos || []).flatMap((p) => [p.product, p.feature_label])]
        .some((x) => String(x || '').toLowerCase().includes(needle)))
    ));
  }, [reviews, q, tab]);

  const cell = (v) => (v === null || v === undefined
    ? <span className="wsm-hsr-n0">·</span>
    : v === '—' ? <span className="wsm-hsr-n0" title="The base build never ran this scan">—</span>
      : v === 0 ? <span className="wsm-hsr-n0">0</span>
        : <span className="wsm-hsr-n">{v}</span>);

  if (openKey) {
    return (
      <HacksawReviewDetail reviewKey={openKey} onBack={() => setOpenKey(null)} onNotice={onNotice} onChanged={load} />
    );
  }

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
        <button type="button" className="btn btn-primary" onClick={() => { setRepos([]); setAdding(true); }}>
          New review
        </button>
      </div>

      {adding && (
        <div className="modal-backdrop" onClick={() => setAdding(false)}>
          <div className="modal modal-lg wsm-hsr-newmodal" role="dialog" aria-modal="true"
               aria-label="New review" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>New review</h2>
              <button type="button" className="modal-close" onClick={() => setAdding(false)}
                      aria-label="Close" title="Close">×</button>
            </div>

            <div className="wsm-hsr-new">
              {repos.map((rp, i) => {
                const reps = reportsBy[rp.product] || [];
                return (
                  <div key={i} className="wsm-hs-tools">
                    <SearchSelect
                      label="Repo" value={rp.product} placeholder="choose a repo…"
                      options={products.map((p) => ({ value: p.name, label: p.name }))}
                      onChange={(v) => { setRepo(i, { product: v, feature_label: '', base_label: '' }); reportsFor(v); }}
                    />
                    <SearchSelect
                      label="Feature build" value={rp.feature_label} disabled={!rp.product}
                      options={reps.map((r) => ({ value: r.label, label: r.label }))}
                      onChange={(v) => setRepo(i, { feature_label: v })}
                    />
                    <SearchSelect
                      label="Base build" value={rp.base_label} placeholder="none (whole build)"
                      disabled={!rp.product}
                      options={[{ value: '', label: 'none (whole build)' },
                        ...reps.filter((r) => r.label !== rp.feature_label)
                          .map((r) => ({ value: r.label, label: r.label, sub: r.is_deployed ? '● deployed' : '' }))]}
                      onChange={(v) => setRepo(i, { base_label: v })}
                    />
                    <button type="button" className="wsm-hs-clear"
                            onClick={() => setRepos((l) => l.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                );
              })}
              {!repos.length && <p className="hint">Add a repo to start the review.</p>}
              <div className="wsm-hs-tools">
                <button type="button" className="btn btn-small" onClick={addRepo} disabled={!products.length}>+ Add repo</button>
                <span className="hint">Each repo compares a feature build against a base build; the review covers them together.</span>
              </div>
            </div>

            <div className="wsm-hsr-newfoot">
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={create}
                      disabled={!repos.some((r) => r.product && r.feature_label)}>
                Create review
              </button>
            </div>
          </div>
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
            {SCAN_COLS.map(([k, l]) => <div key={k} className="wsm-hsr-num" title={l}>{l}</div>)}
            <div className="wsm-hsr-num">Components</div>
            <div>Submitted</div>
          </div>

          {shown.map((r) => {
            const st = r.status || 'draft';
            const mk = MARK[st] || MARK.draft;
            const n = counts[r.key] || {};
            const rev = r.reviewer_person;
            return (
              <div key={r.key}>
                <div
                  className="wsm-hsr-row"
                  style={{ gridTemplateColumns: COLS }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenKey(r.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenKey(r.key); } }}
                >
                  <div><span className={`wsm-hsr-mark ${mk.cls}`} title={mk.title}>{mk.glyph}</span></div>
                  <div className="wsm-hsr-proj">{r.title}<span className="wsm-hsr-id">{r.key}</span></div>
                  <div onClick={(e) => e.stopPropagation()}>
                    {r.reviewer_id ? (
                      <span className="wsm-hsr-rev">
                        <span className="wsm-hs-av">{initialsOf(rev?.name || rev?.email || r.reviewer_id)}</span>
                        <span className="wsm-hsr-revn" title={rev?.email || r.reviewer_id}>{rev?.email || rev?.name || r.reviewer_id}</span>
                      </span>
                    ) : r.role?.is_reviewer && st === 'submitted' ? (
                      <button type="button" className="wsm-hsr-assign" onClick={() => claim(r)}>+ Assign me</button>
                    ) : (
                      <span className="wsm-hsr-n0">—</span>
                    )}
                  </div>
                  <div className="wsm-hsr-repos">
                    {(r.repos || []).map((rp) => (
                      <span key={`${rp.product}|${rp.feature_label}`} className="wsm-hsr-repo"
                            title={rp.base_label ? `${rp.feature_label} vs ${rp.base_label}` : rp.feature_label}>
                        {rp.product}
                      </span>
                    ))}
                  </div>
                  {SCAN_COLS.map(([k]) => <div key={k} className="wsm-hsr-num">{cell(n[k])}</div>)}
                  <div className="wsm-hsr-num wsm-hsr-delta">
                    {n.DELTA ? (
                      <>
                        <span className={n.DELTA.added ? 'wsm-hsr-add' : 'wsm-hsr-n0'}>+{n.DELTA.added}</span>
                        <span className={n.DELTA.updated ? 'wsm-hsr-upd' : 'wsm-hsr-n0'}>~{n.DELTA.updated}</span>
                        <span className={n.DELTA.removed ? 'wsm-hsr-rem' : 'wsm-hsr-n0'}>−{n.DELTA.removed}</span>
                      </>
                    ) : <span className="wsm-hsr-n0">·</span>}
                  </div>
                  <div className="wsm-hsr-sub">
                    {r.raised_by_person?.email || r.raised_by_person?.name || r.raised_by}
                    <span className="wsm-hsr-at">{r.submitted_on ? `submitted ${r.submitted_on}` : (r.created_at ? `created ${String(r.created_at).slice(0, 16)}` : '')}</span>
                  </div>
                </div>

              </div>
            );
          })}

          {status === 'ok' && shown.length === 0 && (
            <p className="wsm-empty">
              {reviews.length === 0 ? 'No reviews yet. Create one from a feature build to start.' : 'No reviews match this search or filter.'}
            </p>
          )}
          {status === 'loading' && <p className="wsm-empty">Loading…</p>}
        </div>
      </div>
    </div>
  );
}
