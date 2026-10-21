import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * A select with a search box — a native <select> cannot be typed into, and the build dropdowns
 * routinely run to 50 labels that differ only by a date and a counter
 * (`monitor_LOG360_CLOUD_5_22_88_Oct_16_2026_1_Log360Cloud`), which is exactly the case a native
 * list is worst at. Same shape as the native one it replaces: a trigger showing the chosen value,
 * a popover list, click-away and Escape to dismiss.
 */
export default function SearchSelect({ label, value, placeholder, options, disabled, variant, onChange }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [right, setRight] = useState(false);   // align to the trigger's right edge instead
  const [q, setQ] = useState('');
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onAway = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => { document.removeEventListener('mousedown', onAway); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => options.filter((o) => !needle || `${o.label} ${o.sub || ''}`.toLowerCase().includes(needle)),
    [options, needle],
  );
  const current = options.find((o) => o.value === value);

  const pick = (v) => { onChange(v); setOpen(false); setQ(''); };

  return (
    <label className={`wsm-ss ${variant === 'chip' ? 'wsm-ss-chip' : 'wsm-dms-filter'}`} ref={boxRef}>
      <span className={variant === 'chip' ? 'wsm-hs-pick-l' : 'wsm-label'}>{label}</span>
      <div className="wsm-ss-wrap">
        <button type="button" disabled={disabled}
                className={`wsm-ss-trigger${current && value ? ' wsm-dms-select-on' : ''}`}
                aria-haspopup="listbox" aria-expanded={open}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setUp(r.bottom + 330 > window.innerHeight && r.top > 330);
                  setRight(r.left + 340 > window.innerWidth);
                  setOpen((o) => !o);
                }}>
          <span className="wsm-ss-val">{current ? current.label : (placeholder || 'choose…')}</span>
          <span className="wsm-ss-caret" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className={`wsm-ss-pop${up ? ' wsm-ss-pop-up' : ''}${right ? ' wsm-ss-pop-r' : ''}`}
               role="listbox">
            <input ref={inputRef} type="search" className="wsm-ss-q" placeholder="Search…"
                   value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${label}`} />
            <div className="wsm-ss-list">
              {shown.map((o) => (
                <button key={o.value} type="button" role="option" aria-selected={o.value === value}
                        className={`wsm-ss-opt${o.value === value ? ' wsm-ss-opt-on' : ''}`}
                        onClick={() => pick(o.value)} title={o.label}>
                  {o.sub && <span className="wsm-ss-sub">{o.sub}</span>}
                  {o.label}
                </button>
              ))}
              {!shown.length && (
                <p className="hint wsm-ss-none">
                  {options.length ? `No match for “${q}” in ${options.length}.` : 'Nothing to choose from yet.'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </label>
  );
}
