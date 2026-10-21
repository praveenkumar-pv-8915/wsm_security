import { useEffect, useRef, useState } from 'react';

/**
 * Assign · Change status · Add tag, for the findings currently selected.
 *
 * Every control is gated on what the Hacksaw connection's OAuth grant actually allows, reported
 * by `/api/hacksaw/write-capabilities` — not on hope. A grant that is read-only disables all
 * three and names the scope to add, because a button that 424s is worse than one that explains
 * itself.
 *
 * `caps` is that report; `onRun(kind, payload)` performs one action and resolves when it lands.
 */
export default function BulkActions({ count, caps, people, tags, busy, onRun }) {
  const [open, setOpen] = useState(null);   // 'assign' | 'status' | 'tag'
  const [assignee, setAssignee] = useState('');
  const [status, setStatus] = useState('OPEN');
  const [reason, setReason] = useState('');
  const [todate, setTodate] = useState('');
  const [tag, setTag] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onAway = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(null); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onAway); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const readOnly = caps && !caps.assign && !caps.status_temporary && !caps.status_permanent;
  const why = readOnly
    ? `The Hacksaw connection is read-only. Add ${(caps.missing || []).join(', ')} and reconnect.`
    : '';

  const permanent = status === 'FALSE_POSITIVE' || status === 'PERMANENTLY_EXCLUDED';
  const statusAllowed = permanent ? caps?.status_permanent : caps?.status_temporary;

  const run = async (kind, payload) => {
    await onRun(kind, payload);
    setOpen(null); setReason(''); setTag(''); setAssignee('');
  };

  const trigger = (kind, label, enabled) => (
    <button type="button" className="btn btn-small" disabled={!enabled || busy}
            title={enabled ? '' : (why || 'Not permitted by the current Hacksaw grant')}
            onClick={() => setOpen((o) => (o === kind ? null : kind))}>
      {label}
    </button>
  );

  return (
    <span className="wsm-hs-bulk" ref={boxRef}>
      {trigger('assign', 'Assign', caps?.assign)}
      {trigger('status', 'Change status', caps?.status_temporary || caps?.status_permanent)}
      {trigger('tag', 'Add tag', caps?.tag)}
      {readOnly && <span className="tag tag-bad" title={why}>read-only grant</span>}

      {open === 'assign' && (
        <div className="wsm-fm-pop wsm-hs-bulkpop" role="dialog" aria-label="Assign findings">
          <div className="wsm-fm-head"><span>Assign {count}</span></div>
          <input list="wsm-hs-people" className="wsm-ss-q" placeholder="name@zohocorp.com"
                 value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee" />
          <datalist id="wsm-hs-people">
            {(people || []).map((p) => <option key={p} value={p} />)}
          </datalist>
          <div className="wsm-hs-bulkfoot">
            <button type="button" className="btn btn-small" onClick={() => setOpen(null)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-small" disabled={!assignee.trim() || busy}
                    onClick={() => run('assign', { assignee: assignee.trim() })}>Assign</button>
          </div>
        </div>
      )}

      {open === 'status' && (
        <div className="wsm-fm-pop wsm-hs-bulkpop" role="dialog" aria-label="Change status">
          <div className="wsm-fm-head"><span>Change status · {count}</span></div>
          <label className="wsm-dms-filter">
            <span className="wsm-label">To</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="New status">
              <option value="OPEN">Open</option>
              <option value="TEMPORARILY_EXCLUDED">Temporarily excluded</option>
              <option value="FALSE_POSITIVE">False positive</option>
              <option value="PERMANENTLY_EXCLUDED">Permanently excluded</option>
            </select>
          </label>
          {status === 'TEMPORARILY_EXCLUDED' && (
            <label className="wsm-dms-filter">
              <span className="wsm-label">Until</span>
              <input type="date" value={todate} onChange={(e) => setTodate(e.target.value)} aria-label="Excluded until" />
            </label>
          )}
          <textarea className="wsm-ss-q" rows={3} placeholder="Reason — Hacksaw records this against the change"
                    value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          {!statusAllowed && (
            <p className="hint wsm-fm-note">
              This status needs {permanent ? 'Hacksaw.VIOLATION_PERMANENT_STATUS_CHANGE' : 'Hacksaw.VIOLATION_STATUS_CHANGE'},
              which the connection does not hold.
            </p>
          )}
          <div className="wsm-hs-bulkfoot">
            <button type="button" className="btn btn-small" onClick={() => setOpen(null)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-small"
                    disabled={!reason.trim() || !statusAllowed || busy
                      || (status === 'TEMPORARILY_EXCLUDED' && !todate)}
                    onClick={() => run('status', { to_status: status, reason: reason.trim(), todate })}>
              Push to Hacksaw
            </button>
          </div>
        </div>
      )}

      {open === 'tag' && (
        <div className="wsm-fm-pop wsm-hs-bulkpop" role="dialog" aria-label="Add tag">
          <div className="wsm-fm-head"><span>Add tag · {count}</span></div>
          <input list="wsm-hs-tags" className="wsm-ss-q" placeholder="tag"
                 value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag" />
          <datalist id="wsm-hs-tags">
            {(tags || []).map((t) => <option key={t} value={t} />)}
          </datalist>
          <div className="wsm-hs-bulkfoot">
            <button type="button" className="btn btn-small" onClick={() => setOpen(null)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-small" disabled={!tag.trim() || busy}
                    onClick={() => run('tag', { tags: [tag.trim()] })}>Add tag</button>
          </div>
        </div>
      )}
    </span>
  );
}
