import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { RefreshIcon } from '../lib/icons';

/**
 * Hacksaw › Hacksaw Reviewer — the v7 design's `hreview` tool.
 *
 * In the design a review is a record (HSR-1048) raised against a project, assigned to a reviewer,
 * carrying a pending / changes / approved status, and covering repos each pinned to a base build
 * and a WIP build. None of that exists in Hacksaw — it has no notion of a review and this app has
 * no write scopes — so the record lives here, in `tool_config` under TOOL_KEY 'hacksaw_reviews'
 * (hacksaw-review-service.js), and the findings come from Hacksaw's diff report.
 *
 * Adapted from the design in one way worth stating: the design's review spans several repos,
 * because its mock data is organised that way. A review here is one product's WIP build against
 * one base build, which is the unit Hacksaw's diff API actually compares. Several products mean
 * several reviews — the nav count is still "how many are waiting on someone".
 *
 * The findings themselves are not duplicated here: "Review findings" opens Hacksaw Report with
 * this review's product, build and base already selected, which is the same list with the
 * decision controls the design puts on each card.
 */

const STATUS = {
  pending: { label: 'Pending', cls: 'wsm-hs-st-pending' },
  approved: { label: 'Approved', cls: 'wsm-hs-st-approved' },
  changes: { label: 'Changes requested', cls: 'wsm-hs-st-changes' },
};

/** Handed to Hacksaw Report so it opens on this review's build pair. */
export const REVIEW_CONTEXT_KEY = 'wsm.hacksaw.reviewContext';

export default function HacksawReviewer({ onNotice }) {
  const [reviews, setReviews] = useState([]);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const [products, setProducts] = useState([]);
  const [draft, setDraft] = useState({ product: '', label: '', base_label: '' });
  const [reports, setReports] = useState([]);
  const [adding, setAdding] = useState(false);

  const fail = (err, fallback) => setError(err instanceof ApiError ? err.message : fallback);

  const load = useCallback(async () => {
    setStatus('loading'); setError('');
    try {
      const r = await api('/hacksaw/reviews');
      setReviews(r.reviews || []);
      setPending(r.pending || 0);
      setStatus('ok');
      window.dispatchEvent(new CustomEvent('wsm:section-count', {
        detail: { path: '/hacksaw-reviewer', count: r.pending || 0 },
      }));
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
        const wip = (list[0] || {}).label || '';
        setDraft((d) => ({ ...d, label: wip, base_label: (list[1] || {}).label || '' }));
      } catch (err) { if (live) fail(err, 'Could not list reports.'); }
    })();
    return () => { live = false; };
  }, [adding, draft.product]);

  const create = async () => {
    if (!draft.product || !draft.label) return;
    try {
      await api('/hacksaw/reviews', { method: 'POST', body: draft });
      setAdding(false);
      onNotice?.('Review raised.');
      await load();
    } catch (err) { fail(err, 'Could not raise the review.'); }
  };

  const decide = async (review, next) => {
    setBusyId(review.id);
    try {
      await api(`/hacksaw/reviews/${encodeURIComponent(review.id)}`, { method: 'PATCH', body: { status: next } });
      onNotice?.(next === 'approved' ? `${review.id} approved.` : `${review.id} sent back for changes.`);
      await load();
    } catch (err) { fail(err, 'Could not update the review.'); } finally { setBusyId(''); }
  };

  /** Open Hacksaw Report already pointed at this review's build pair. */
  const openFindings = (r) => {
    try {
      sessionStorage.setItem(REVIEW_CONTEXT_KEY, JSON.stringify({
        product: r.product, label: r.label, base_label: r.base_label || '',
      }));
    } catch { /* a private window just means the Report screen opens on its own default */ }
    navigate('/hacksaw-report');
  };

  return (
    <div className="wsm-hs">
      <div className="wsm-hs-ctx">
        <span className="wsm-hs-pick-l">Reviews</span>
        <span className="wsm-hs-sel">{pending} pending</span>
        <span className="wsm-hs-ctx-r">
          <button type="button" className="btn btn-ghost btn-icon" onClick={load} disabled={status === 'loading'}
                  title="Refresh" aria-label="Refresh reviews">
            <RefreshIcon />
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding((a) => !a)}>
            {adding ? 'Cancel' : 'Raise a review'}
          </button>
        </span>
      </div>

      {adding && (
        <div className="wsm-hs-tools">
          <label className="wsm-dms-filter">
            <span className="wsm-label">Product</span>
            <select className="wsm-dms-select-on" value={draft.product}
                    onChange={(e) => setDraft((d) => ({ ...d, product: e.target.value }))}>
              {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
          <label className="wsm-dms-filter">
            <span className="wsm-label">Build under review</span>
            <select className="wsm-dms-select-on" value={draft.label}
                    onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}>
              {reports.map((r) => <option key={r.label} value={r.label}>{r.is_deployed ? '● deployed — ' : ''}{r.label}</option>)}
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

      <div className="wsm-hs-list">
        {reviews.map((r) => {
          const st = STATUS[r.status] || STATUS.pending;
          return (
            <div key={r.id} className={`wsm-hs-card wsm-hs-rev ${st.cls}`}>
              <div className="wsm-hs-card-head">
                <span className="wsm-hs-rule">{r.id}</span>
                <span className={`wsm-hs-sync ${st.cls}`}>{st.label}</span>
                <span className="wsm-hs-card-r">
                  <button type="button" className="btn btn-small" onClick={() => openFindings(r)}>
                    Review findings →
                  </button>
                  <button type="button" className="btn btn-small" disabled={busyId === r.id}
                          onClick={() => decide(r, 'changes')}>
                    Request changes
                  </button>
                  <button type="button" className="btn btn-primary btn-small" disabled={busyId === r.id}
                          onClick={() => decide(r, 'approved')}>
                    Approve
                  </button>
                </span>
              </div>

              <div className="wsm-hs-revmeta">
                <span className="tag tag-muted">{r.product}</span>
                <span className="wsm-hs-path">{r.label}</span>
                {r.base_label && <span className="wsm-hs-revvs">vs {r.base_label}</span>}
              </div>

              <p className="hint">
                Raised {new Date(r.created_at).toLocaleString()}
                {r.decided_at ? ` · decided ${new Date(r.decided_at).toLocaleString()}` : ''}
              </p>
            </div>
          );
        })}

        {status === 'ok' && reviews.length === 0 && (
          <div className="wsm-hs-ok"><span>✓</span>No reviews yet. Raise one against a build to start.</div>
        )}
        {status === 'loading' && <p className="wsm-empty">Loading…</p>}
      </div>
    </div>
  );
}
