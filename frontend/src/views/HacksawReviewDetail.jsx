import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * One review, opened from the Hacksaw Reviewer queue.
 *
 * The findings are Hacksaw's diff — everything NEW in each repo's feature build against its base —
 * joined with this review's own state from hacksaw_review_item: the developer's reply and proposed
 * status, the AI verdict on that reply, the thread, and the reviewer's accept / respond.
 *
 * Who sees what is decided by role (hacksaw-review-service.js):
 *   developer (raiser)  → reply box + status per finding; Submit for review once all are replied
 *   reviewer (admin)    → Accept / Respond per finding; Push selected to Hacksaw; Close once all accepted
 *
 * The developer's earlier exclusion reason in Hacksaw (fetchactivities) is loaded on expand only —
 * that endpoint allows 25 calls a minute with a 10-minute lock.
 */

const DEV_STATUSES = ['Open', 'False positive', 'Temporarily excluded', 'Permanently excluded'];
const FILE_TYPES = ['java', 'js', 'python', 'clang'];
const SCANS = [
  ['CODE_VIOLATIONS', 'Code violations'],
  ['MISCONFIGURATIONS', 'Misconfigurations'],
  ['HARDCODED_SECRETS', 'Hardcoded secrets'],
  ['VULNERABLE_COMPONENTS', 'Vulnerable components'],
  ['RUNTIME_CODE_VIOLATIONS', 'IAST'],
];

const sevClass = (p) => (p === 'ERROR' ? 'wsm-hs-sev-err' : p === 'WARNING' ? 'wsm-hs-sev-warn' : 'wsm-hs-sev-info');
const initialsOf = (v) => String(v || '').replace(/@.*/, '').split(/[._\s-]/).filter(Boolean).slice(0, 2)
  .map((x) => x[0]).join('').toUpperCase() || '··';
const who = (p, fallback) => (p?.email || p?.name || fallback || '—');

export default function HacksawReviewDetail({ reviewKey, onBack, onNotice, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [repoIdx, setRepoIdx] = useState(0);
  const [scan, setScan] = useState('CODE_VIOLATIONS');
  const [fileType, setFileType] = useState('java');
  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [open, setOpen] = useState(null);
  const [draft, setDraft] = useState({});
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState('');
  const [history, setHistory] = useState({});

  const fail = (err, fallback) => setError(err instanceof ApiError ? err.message : fallback);

  const load = useCallback(async () => {
    try {
      const r = await api(`/hacksaw/reviews/${encodeURIComponent(reviewKey)}`);
      setData(r); setError('');
    } catch (err) { fail(err, 'Could not load the review.'); }
  }, [reviewKey]);
  useEffect(() => { load(); }, [load]);

  const review = data?.review;
  const repo = review?.repos?.[repoIdx];
  const role = review?.role || {};

  /* Findings for the selected repo + scan: the diff when the repo has a base, else the whole build. */
  useEffect(() => {
    if (!repo) return undefined;
    let live = true;
    setLoadingRows(true); setRows([]); setOpen(null);
    (async () => {
      try {
        let out = [];
        if (repo.base_label) {
          const p = new URLSearchParams({
            product: repo.product, label: repo.feature_label, base_label: repo.base_label,
            scan, diff_category: 'NEW', limit: '200',
          });
          if (scan === 'CODE_VIOLATIONS') p.set('file_type', fileType);
          const r = await api(`/hacksaw/diff-violations?${p}`);
          out = r.violations || [];
        } else if (scan === 'VULNERABLE_COMPONENTS') {
          const r = await api(`/hacksaw/components?product=${encodeURIComponent(repo.product)}&label=${encodeURIComponent(repo.feature_label)}`);
          out = (r.components || []).map((c) => ({
            key: c.key, id: c.id, rule: `${c.name} ${c.version}`, file_name: c.path, line_no: null,
            snippet: c.identifier, priority: c.is_blocked ? 'ERROR' : 'WARNING', status: c.status,
            is_blocked: c.is_blocked, assignee: c.assignee, link: null, kind: 'component', identifier: c.identifier,
          }));
        } else {
          const p = new URLSearchParams({ product: repo.product, label: repo.feature_label, scan, limit: '200' });
          if (scan === 'CODE_VIOLATIONS') p.set('file_type', fileType);
          const r = await api(`/hacksaw/violations?${p}`);
          out = r.violations || [];
        }
        if (live) setRows(out);
      } catch (err) { if (live) fail(err, 'Could not load findings.'); } finally { if (live) setLoadingRows(false); }
    })();
    return () => { live = false; };
  }, [repo, scan, fileType]);

  const findings = data?.findings || {};
  const threads = data?.threads || {};
  const allKeys = useMemo(() => rows.map((r) => r.key), [rows]);
  const replied = allKeys.filter((k) => (threads[k] || []).some((m) => m.kind === 'reply'));
  const accepted = allKeys.filter((k) => findings[k]?.review_state === 'accepted');
  const pickedKeys = Object.keys(picked).filter((k) => picked[k]);

  const identityOf = (r) => (r.kind === 'component'
    ? { kind: 'component', product: repo.product, identifier: r.identifier, scan, rule: r.rule, file: r.file_name, snippet: r.snippet }
    : { kind: 'violation', product: repo.product, rule: r.rule, file: r.file_name, snippet: r.snippet, scan, line: r.line_no,
        hacksaw_reason: history[r.key]?.find((a) => a.reason)?.reason || null });

  const send = async (r) => {
    const d = draft[r.key] || {};
    const body = String(d.body || '').trim();
    if (!body) return;
    setBusy(r.key);
    try {
      await api(`/hacksaw/reviews/${encodeURIComponent(reviewKey)}/reply`, {
        method: 'POST',
        body: { finding: identityOf(r), finding_key: r.key, body, ...(role.is_developer ? { dev_status: d.dev_status || 'Open' } : {}) },
      });
      setDraft((m) => ({ ...m, [r.key]: { ...d, body: '' } }));
      await load();
    } catch (err) { fail(err, 'Could not post that.'); } finally { setBusy(''); }
  };

  const act = async (path, body, okMsg) => {
    setBusy(path);
    try {
      const r = await api(`/hacksaw/reviews/${encodeURIComponent(reviewKey)}/${path}`, { method: 'POST', body });
      if (okMsg) onNotice?.(okMsg);
      await load(); onChanged?.();
      return r;
    } catch (err) { fail(err, 'That action failed.'); return null; } finally { setBusy(''); }
  };

  const loadHistory = async (r) => {
    if (history[r.key] || r.kind === 'component') return;
    try {
      const h = await api(`/hacksaw/activities?product=${encodeURIComponent(repo.product)}&violation_id=${r.id}&scan=${scan}`);
      setHistory((m) => ({ ...m, [r.key]: h.activities || [] }));
    } catch { setHistory((m) => ({ ...m, [r.key]: [] })); }
  };

  if (!review) {
    return (
      <div className="wsm-hs">
        <div className="wsm-hs-ctx"><button type="button" className="btn btn-small" onClick={onBack}>← Reviews</button></div>
        {error ? <div className="banner banner-err" role="alert">{error}</div> : <p className="wsm-empty">Loading…</p>}
      </div>
    );
  }

  const canSubmit = role.is_developer && review.status === 'draft' && allKeys.length > 0 && replied.length === allKeys.length;
  const canClose = role.is_reviewer && review.status === 'submitted' && allKeys.length > 0 && accepted.length === allKeys.length;

  return (
    <div className="wsm-hs">
      <div className="wsm-hs-ctx">
        <button type="button" className="btn btn-small" onClick={onBack}>← Reviews</button>
        <span className="wsm-hs-rule">{review.key}</span>
        <span className={`wsm-hs-sync wsm-hsr-st-${review.status}`}>{review.status}</span>
        <span className="wsm-hs-who">
          <span className="wsm-hs-av">{initialsOf(who(review.raised_by_person))}</span>
          raised by {who(review.raised_by_person, review.raised_by)}
        </span>
        {review.reviewer_id && (
          <span className="wsm-hs-who">· reviewer {who(review.reviewer_person, review.reviewer_id)}</span>
        )}
        <span className="wsm-hs-ctx-r">
          {role.is_developer && review.status === 'draft' && (
            <button type="button" className="btn btn-primary" disabled={!canSubmit || busy === 'submit'}
                    title={canSubmit ? 'Send to the reviewers' : `${allKeys.length - replied.length} finding(s) still need a reply`}
                    onClick={() => act('submit', { finding_keys: allKeys }, 'Submitted for review.')}>
              Submit for review
            </button>
          )}
          {role.is_reviewer && review.status === 'submitted' && (
            <>
              <button type="button" className="btn" disabled={!pickedKeys.length || busy === 'push'}
                      onClick={() => act('push', { finding_keys: pickedKeys }, 'Pushed to Hacksaw.')}>
                Push selected to Hacksaw
              </button>
              <button type="button" className="btn btn-primary" disabled={!canClose || busy === 'close'}
                      title={canClose ? 'Every finding is accepted' : `${allKeys.length - accepted.length} finding(s) not yet accepted`}
                      onClick={() => act('close', { finding_keys: allKeys }, 'Review closed.')}>
                Close review
              </button>
            </>
          )}
          {role.is_reviewer && review.status === 'closed' && (
            <button type="button" className="btn" onClick={() => act('reopen', {}, 'Review reopened.')}>Reopen</button>
          )}
        </span>
      </div>

      {/* Repos of this review, then the scan within the repo. */}
      <div className="wsm-hs-tabs" role="tablist" aria-label="Repo">
        {review.repos.map((rp, i) => (
          <button key={`${rp.product}|${rp.feature_label}`} type="button" role="tab" aria-selected={i === repoIdx}
                  className={`wsm-hs-tab${i === repoIdx ? ' wsm-hs-tab-on' : ''}`} onClick={() => setRepoIdx(i)}
                  title={rp.base_label ? `${rp.feature_label} vs ${rp.base_label}` : rp.feature_label}>
            {rp.product}
          </button>
        ))}
        <span className="wsm-hs-tabs-r">
          {repo?.base_label ? 'new vs base' : 'whole build'} · {replied.length}/{allKeys.length} replied · {accepted.length}/{allKeys.length} accepted
        </span>
      </div>
      <div className="wsm-hs-cats">
        {SCANS.map(([k, l]) => (
          <button key={k} type="button" className={`btn btn-small${scan === k ? ' wsm-chipbtn-on' : ''}`} onClick={() => setScan(k)}>{l}</button>
        ))}
        {scan === 'CODE_VIOLATIONS' && (
          <select className="wsm-hs-dec" value={fileType} onChange={(e) => setFileType(e.target.value)} aria-label="Language">
            {FILE_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
      </div>

      {error && <div className="banner banner-err" role="alert">{error}</div>}

      <div className="wsm-hs-list">
        {rows.map((r) => {
          const f = findings[r.key];
          const th = threads[r.key] || [];
          const isOpen = open === r.key;
          const d = draft[r.key] || {};
          const state = f?.review_state || (th.length ? 'pending' : 'unreplied');
          return (
            <div key={r.key} className={`wsm-hs-card ${sevClass(r.priority)}`}>
              <div className="wsm-hs-card-head">
                {role.is_reviewer && (
                  <input type="checkbox" aria-label={`Select ${r.rule}`} checked={!!picked[r.key]}
                         onChange={(e) => setPicked((m) => ({ ...m, [r.key]: e.target.checked }))} />
                )}
                <span className="wsm-hs-rule">
                  {String(r.rule || '').toUpperCase().replace(/\s+/g, '_')}
                  {r.is_blocked && <span className="wsm-hs-blkmark" title="Blocking">⃠</span>}
                </span>
                <span className="wsm-hs-card-r">
                  {f?.dev_status && <span className="wsm-hs-sync">{f.dev_status}</span>}
                  <span className={`wsm-hs-sync wsm-hsr-rs-${state}`}>{state}</span>
                  {f?.synced_at && <span className="wsm-hs-sync wsm-hs-sync-synced">⟳ pushed</span>}
                  {f?.ai && (
                    <span className={`wsm-hs-sync wsm-hs-ai-${/true/i.test(f.ai.verdict) ? 'tp' : /false/i.test(f.ai.verdict) ? 'fp' : 'rev'}`}
                          title={f.ai.rationale || ''}>
                      AI · {f.ai.verdict}{f.ai.confidence !== null ? ` ${f.ai.confidence}%` : ''}
                    </span>
                  )}
                  <button type="button" className="btn btn-small" onClick={() => { setOpen(isOpen ? null : r.key); if (!isOpen) loadHistory(r); }}>
                    {isOpen ? 'Hide' : th.length ? `Thread (${th.length})` : 'Reply'}
                  </button>
                </span>
              </div>
              <a className="wsm-hs-path" href={r.link || undefined} target="_blank" rel="noopener noreferrer">{r.file_name}</a>
              {r.snippet && (
                <div className="wsm-hs-code">
                  {r.line_no !== null && r.line_no !== undefined && <span className="wsm-hs-ln">{r.line_no}</span>}
                  <code>{r.snippet}</code>
                </div>
              )}

              {isOpen && (
                <div className="wsm-hs-detail wsm-hsr-thread">
                  {(history[r.key] || []).filter((a) => a.reason).map((a) => (
                    <div key={a.id} className="wsm-hsr-msg wsm-hsr-msg-hacksaw">
                      <span className="wsm-hs-av">{initialsOf(a.by?.name)}</span>
                      <div>
                        <div className="wsm-hsr-msg-h">{a.by?.email || a.by?.name} · in Hacksaw · {a.at} · {a.from_status} → {a.to_status}</div>
                        <div>{a.reason}</div>
                      </div>
                    </div>
                  ))}
                  {th.map((m) => (
                    <div key={m.id} className={`wsm-hsr-msg wsm-hsr-msg-${m.kind}`}>
                      <span className="wsm-hs-av">{initialsOf(who(m.author, m.author_id))}</span>
                      <div>
                        <div className="wsm-hsr-msg-h">{who(m.author, m.author_id)} · {m.kind} · {new Date(m.at).toLocaleString()}</div>
                        <div>{m.body}</div>
                      </div>
                    </div>
                  ))}
                  {f?.ai && (
                    <div className="wsm-hsr-ai">
                      <div className="wsm-hsr-msg-h">AI verdict · {f.ai.verdict}{f.ai.confidence !== null ? ` · ${f.ai.confidence}%` : ''}{f.ai.model ? ` · ${f.ai.model}` : ''}</div>
                      <div>{f.ai.rationale}</div>
                    </div>
                  )}

                  {review.status !== 'closed' && (role.is_developer || role.is_reviewer) && (
                    <div className="wsm-hsr-compose">
                      {role.is_developer && (
                        <select className="wsm-hs-dec" value={d.dev_status || f?.dev_status || 'Open'}
                                onChange={(e) => setDraft((m) => ({ ...m, [r.key]: { ...d, dev_status: e.target.value } }))}
                                aria-label="Proposed status">
                          {DEV_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                      )}
                      <textarea className="wsm-hsr-ta" rows={2}
                                placeholder={role.is_developer ? 'Why this finding is safe, or what you changed…' : 'Respond to the developer…'}
                                value={d.body || ''}
                                onChange={(e) => setDraft((m) => ({ ...m, [r.key]: { ...d, body: e.target.value } }))} />
                      <button type="button" className="btn btn-primary btn-small" disabled={busy === r.key || !(d.body || '').trim()}
                              onClick={() => send(r)}>
                        {role.is_developer ? 'Reply' : 'Respond'}
                      </button>
                      {role.is_reviewer && review.status === 'submitted' && state !== 'accepted' && (
                        <button type="button" className="btn btn-small" disabled={busy === 'accept'}
                                onClick={() => act('accept', { finding_keys: [r.key] })}>
                          Accept
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!loadingRows && rows.length === 0 && (
          <div className="wsm-hs-ok"><span>✓</span>Nothing {repo?.base_label ? 'new' : 'open'} in this scan for {repo?.product}.</div>
        )}
        {loadingRows && <p className="wsm-empty">Loading…</p>}
      </div>
    </div>
  );
}
