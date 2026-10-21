import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Every filter behind one "Filters" button.
 *
 * Two levels rather than a panel of nested dropdowns: the panel lists the filter keys with their
 * current values, and picking one swaps the body for that key's searchable value list. A nested
 * popover inside a scrolling panel is clipped by it — the same trap the new-review modal hit —
 * and a flat panel of ten controls does not fit a list of 226 assignees or 27 rules anyway.
 *
 * `groups` is [{ key, label, values: [{ value, label, sub }], note }] in display order; `sel` is
 * { KEY: value } with '' meaning no filter.
 */
export default function FilterMenu({ groups, sel, count, onPick, onClear, busy }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(null);      // the key being edited, or null for the key list
  const [q, setQ] = useState('');
  const boxRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onAway = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (at) { setAt(null); setQ(''); } else setOpen(false);
    };
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onAway); document.removeEventListener('keydown', onKey); };
  }, [open, at]);

  useEffect(() => { if (at) searchRef.current?.focus(); }, [at]);
  useEffect(() => { if (!open) { setAt(null); setQ(''); } }, [open]);

  const group = groups.find((g) => g.key === at);
  const needle = q.trim().toLowerCase();
  const values = useMemo(() => {
    if (!group) return [];
    return group.values.filter((v) => !needle || `${v.label} ${v.sub || ''}`.toLowerCase().includes(needle));
  }, [group, needle]);

  const labelFor = (g) => {
    const v = sel[g.key];
    if (!v) return 'All';
    return (g.values.find((o) => o.value === v) || {}).label || v;
  };

  return (
    <div className="wsm-fm" ref={boxRef}>
      <button type="button" className={`wsm-fm-btn${count ? ' wsm-fm-btn-on' : ''}`}
              aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Filters{count ? <span className="wsm-fm-n">{count}</span> : null}
        <span className="wsm-ss-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="wsm-fm-pop" role="menu">
          {!group ? (
            <>
              <div className="wsm-fm-head">
                <span>Filters</span>
                {count > 0 && (
                  <button type="button" className="wsm-hs-clear"
                          onClick={() => { onClear(); setOpen(false); }}>Clear all</button>
                )}
              </div>
              <div className="wsm-fm-list">
                {groups.map((g) => (
                  <button key={g.key} type="button" className="wsm-fm-row" onClick={() => { setAt(g.key); setQ(''); }}>
                    <span className="wsm-fm-row-l">{g.label}</span>
                    <span className={`wsm-fm-row-v${sel[g.key] ? ' wsm-fm-row-v-on' : ''}`}>{labelFor(g)}</span>
                    <span className="wsm-fm-row-c" aria-hidden="true">›</span>
                  </button>
                ))}
                {!groups.length && (
                  <p className="hint wsm-ss-none">
                    {busy ? 'Loading Hacksaw’s filters…' : 'No filters for this category.'}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="wsm-fm-head">
                <button type="button" className="wsm-fm-back" onClick={() => { setAt(null); setQ(''); }}
                        aria-label="Back to all filters">‹</button>
                <span>{group.label}</span>
              </div>
              <input ref={searchRef} type="search" className="wsm-ss-q" placeholder={`Search ${group.label.toLowerCase()}…`}
                     value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${group.label}`} />
              {group.note && <p className="hint wsm-fm-note">{group.note}</p>}
              <div className="wsm-fm-list">
                {values.map((v) => (
                  <button key={v.value || '__all'} type="button"
                          className={`wsm-ss-opt wsm-fm-opt${sel[group.key] === v.value ? ' wsm-ss-opt-on' : ''}`}
                          onClick={() => { onPick(group.key, v.value); setAt(null); setQ(''); }}>
                    {v.sub && <span className="wsm-ss-sub">{v.sub}</span>}
                    <span className="wsm-fm-opt-l">{v.label}</span>
                    {v.tail && <span className="wsm-fm-opt-n">{v.tail}</span>}
                  </button>
                ))}
                {!values.length && (
                  <p className="hint wsm-ss-none">
                    No match for “{q}” in {group.values.length}.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
