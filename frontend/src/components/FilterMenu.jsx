import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Hacksaw's own ceilings, probed 2026-10-21 — neither is documented and neither error names it:
 * an 11th value answers `ZSE025 ... range of "0-10"`, and FILE is single-valued, answering the
 * same ZSE025 on a second file id. A group may override `max`.
 */
const MAX_PER_KEY = 10;

const summarise = (group, chosen) => {
  if (!chosen.length) return 'All';
  if (chosen.length === 1) {
    return (group.values.find((o) => o.value === chosen[0]) || {}).label || chosen[0];
  }
  return `${chosen.length} selected`;
};

/**
 * Every filter behind one "Filters" button, multi-select throughout.
 *
 * Multi-select because that is what the API does: `filters` is `{ KEY: [v, …] }`, so ERROR plus
 * WARNING, or three rules at once, is one request — the menu used to allow one value per key and
 * throw that away.
 *
 * Two levels rather than a panel of nested dropdowns: the panel lists the keys with what is
 * chosen under each, and picking one swaps the body for that key's searchable values. A nested
 * popover inside a scrolling panel is clipped by it — the trap the new-review modal hit — and a
 * flat panel of ten controls cannot hold 226 assignees anyway.
 *
 * `groups` is [{ key, label, values: [{ value, label, sub, tail }], note }] in display order;
 * `sel` is { KEY: [value, …] }. Values commit on close, not per click: picking four rules should
 * be one reload, not four.
 */
export default function FilterMenu({ groups, sel, count, onChange, onClear, busy }) {
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
  const chosen = (k) => sel[k] || [];
  const needle = q.trim().toLowerCase();
  const values = useMemo(() => {
    if (!group) return [];
    return group.values.filter((v) => !needle || `${v.label} ${v.sub || ''}`.toLowerCase().includes(needle));
  }, [group, needle]);

  const maxFor = (g) => g.max || MAX_PER_KEY;

  const toggle = (g, v) => {
    const cur = chosen(g.key);
    if (cur.includes(v)) { onChange(g.key, cur.filter((x) => x !== v)); return; }
    // A single-valued key replaces rather than refusing — refusing to tick a radio reads as broken.
    if (maxFor(g) === 1) { onChange(g.key, [v]); return; }
    if (cur.length >= maxFor(g)) return;
    onChange(g.key, [...cur, v]);
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
                  <button type="button" className="wsm-hs-clear" onClick={() => onClear()}>Clear all</button>
                )}
              </div>
              <div className="wsm-fm-list">
                {groups.map((g) => (
                  <button key={g.key} type="button" className="wsm-fm-row" onClick={() => { setAt(g.key); setQ(''); }}>
                    <span className="wsm-fm-row-l">{g.label}</span>
                    <span className={`wsm-fm-row-v${chosen(g.key).length ? ' wsm-fm-row-v-on' : ''}`}>
                      {summarise(g, chosen(g.key))}
                    </span>
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
                {chosen(group.key).length > 0 && (
                  <button type="button" className="wsm-hs-clear"
                          onClick={() => onChange(group.key, [])}>Clear</button>
                )}
              </div>
              <input ref={searchRef} type="search" className="wsm-ss-q"
                     placeholder={`Search ${group.label.toLowerCase()}…`}
                     value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${group.label}`} />
              {group.note && <p className="hint wsm-fm-note">{group.note}</p>}
              <div className="wsm-fm-list">
                {values.map((v) => {
                  const on = chosen(group.key).includes(v.value);
                  const full = !on && maxFor(group) > 1 && chosen(group.key).length >= maxFor(group);
                  return (
                    <button key={v.value} type="button" role="menuitemcheckbox" aria-checked={on}
                            disabled={full}
                            className={`wsm-ss-opt wsm-fm-opt${on ? ' wsm-ss-opt-on' : ''}`}
                            onClick={() => toggle(group, v.value)}>
                      <span className="wsm-fm-tick" aria-hidden="true">{on ? '✓' : ''}</span>
                      {v.sub && <span className="wsm-ss-sub">{v.sub}</span>}
                      <span className="wsm-fm-opt-l">{v.label}</span>
                      {v.tail && <span className="wsm-fm-opt-n">{v.tail}</span>}
                    </button>
                  );
                })}
                {!values.length && (
                  <p className="hint wsm-ss-none">No match for “{q}” in {group.values.length}.</p>
                )}
              </div>
              {maxFor(group) === 1 ? (
                <p className="hint wsm-fm-note">Hacksaw takes one {group.label.toLowerCase()} at a time.</p>
              ) : chosen(group.key).length >= maxFor(group) && (
                <p className="hint wsm-fm-note">
                  {maxFor(group)} is the most Hacksaw takes for one filter — untick one to pick another.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
