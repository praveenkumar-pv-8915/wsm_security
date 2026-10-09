import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../lib/api';
import GuidelinesView, { GuidelinesLegend } from './GuidelinesView';

/**
 * Risk Register — first slice of compliancemanager (risk_manager) in the Welcome app.
 *
 * The list comes from the `compliance_risks` DataStore table, filled by "Sync from Creator" (a
 * full pull-and-replace from the real Zoho Creator connection — see risk-service.js), scoped to
 * whichever Creator Team_Name values are configured in Configuration > Compliance (see
 * ComplianceConfig.jsx — backed by the shared `tool_config` table, no redeploy needed to add a team).
 *
 * Issue/Vulnerability/Threat/Risk/Risk score/Control/Risk treatment/Revised risk score are real
 * columns on every row now (populated by syncFromCreator/mapRegisterRecord in risk-service.js —
 * none of them are PII). Opening a risk makes one live call to Creator (GET
 * /api/risks/:riskId/preview) only for "last reviewed by", since that's a reviewer's email and the
 * one field this app's datastore-conventions.md says must never be cached.
 *
 * "Review guidelines" runs the scripted checks against every risk currently loaded from
 * compliance_risks in one call (risk-service.js's reviewGuidelines) — that's the bulk run; the
 * per-row rerun icon in the Status column reruns just one risk.
 *
 * ── Layout (2026-10-05) ──────────────────────────────────────────────────────────────────────
 * Rebuilt to the "WSM Security v3" mockup (claude/wsm-security-v3-mockup.html; see
 * claude/wsm-security-v3-refactor.md). Two modes, as in the mockup:
 *
 *   table  the default — status · issue · registry · score · team, one scroll pane with a sticky
 *          header whose columns carry their own filter menus.
 *   split  opened by clicking a risk — a narrow list beside a detail pane holding the assessment,
 *          the score card, the guideline review and a sticky treatment footer. "← All risks"
 *          returns to table mode.
 *
 * The thirteen-column table it replaces put Vulnerability / Threat / Risk / Control inline, where
 * every one of them truncated to a tooltip. They are full-width prose in the detail pane now.
 *
 * Three deliberate departures from the mockup, each because the mockup had no real data behind it:
 *   · the mockup's row checkboxes and "Review all / N selected" are not here — there is no
 *     bulk-review-a-subset endpoint, only all-risks (POST /api/risks/review) and one risk
 *     (POST /api/risks/:riskId/review), both of which are wired to buttons already;
 *   · a score column stays in table mode. The mockup drops it (score only appears in split mode),
 *     but these registers carry real inherent/revised scores and hiding them behind a click would
 *     lose information the old table showed;
 *   · pagination stays. The mockup shows 12 rows and a bare counter; this register is 211 risks
 *     over 11 pages, so the counter sits beside real page controls.
 * The mockup's score card also has CIA rows and a risk owner; `compliance_risks` has neither
 * field, so those are left out rather than faked.
 *
 * Filtering is unchanged: only `q` (search) and pagination go to the server — every column filter
 * matches client-side against whatever page of risks is currently loaded.
 */

/** Fixed set of valid treatment values — mirrors risk-review.js's VALID_TREATMENTS, which is what
 *  the scripted guideline checks (and Creator itself) actually allow. */
const TREATMENT_OPTIONS = ['Risk Modification', 'Risk Retention', 'Risk Avoidance', 'Risk Sharing'];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'ok', label: 'Passed review' },
  { value: 'fail', label: 'Failed review' },
  { value: 'unreviewed', label: 'Not reviewed yet' },
];

const NUMERIC_OPERATORS = [
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
  { value: 'between', label: 'Between' },
  { value: 'notBetween', label: 'Not between' },
];

/**
 * Columns in table mode. `hideable: false` columns can't be turned off from the Columns menu
 * (Status + Issue are what make a row identifiable now that Risk is the detail headline).
 * `filterType` decides which kind of panel the header's filter menu opens — see columnMatches().
 *
 * Every column the old table had still has a filter here, including the ones that no longer have
 * a cell of their own (Vulnerability, Threat, Risk, Control, Risk treatment, Revised, Updated):
 * they live in `EXTRA_FILTERS` and hang off the Issue header, so filtering on them did not go away
 * with their columns.
 */
const COLUMNS = [
  { key: 'status', label: 'Status', hideable: false, filterKey: 'status', filterType: 'status', width: '128px' },
  { key: 'riskid', label: 'Risk ID', hideable: true, filterKey: 'riskid', filterType: 'text', width: '124px' },
  { key: 'issue', label: 'Issue', hideable: false, filterKey: 'issue', filterType: 'text', width: 'minmax(0, 2.1fr)' },
  { key: 'register', label: 'Registry', hideable: true, filterKey: 'register', filterType: 'select', width: '96px' },
  { key: 'score', label: 'Risk score', hideable: true, filterKey: 'score', filterType: 'numeric', width: '124px' },
  { key: 'team', label: 'Team', hideable: true, filterKey: 'team', filterType: 'select', width: 'minmax(0, 1.1fr)' },
];

/** Filters with no column of their own — rendered inside the Issue header's menu. */
const EXTRA_FILTERS = [
  { key: 'vulnerability', label: 'Vulnerability', filterKey: 'vulnerability', filterType: 'text' },
  { key: 'threat', label: 'Threat', filterKey: 'threat', filterType: 'text' },
  { key: 'title', label: 'Risk', filterKey: 'title', filterType: 'text' },
  { key: 'control', label: 'Control', filterKey: 'control', filterType: 'text' },
  { key: 'treatment', label: 'Risk treatment', filterKey: 'treatment', filterType: 'select' },
  { key: 'revised', label: 'Revised risk score', filterKey: 'revised', filterType: 'numeric' },
  { key: 'updated', label: 'Updated', filterKey: 'updated', filterType: 'text' },
];

const ALL_FILTERS = [...COLUMNS, ...EXTRA_FILTERS];

const COLUMNS_STORAGE_KEY = 'wsm.riskRegister.hiddenColumns';
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

/** Collapsed heights for the detail pane's Show more fields — the mockup's own values. */
const FIELD_COLLAPSED = { issue: '48px', vulnerability: '44px', threat: '44px', control: '48px' };

function loadHiddenColumns() {
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveHiddenColumns(hidden) {
  try {
    window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(hidden)));
  } catch {
    /* best-effort only — a column-visibility preference isn't worth failing over */
  }
}

/** Greater-than/less-than/between/not-between against a column's numeric field. `filter` is
 *  { op, a, b } — `a`/`b` are strings straight out of the number inputs, '' while empty. A filter
 *  with an op selected but no value typed yet doesn't hide anything (mid-typing shouldn't blank
 *  the table); a row with no numeric value at all never matches an active numeric filter. */
function numericMatches(rawValue, filter) {
  if (!filter || !filter.op) return true;
  const num = Number(rawValue);
  if (rawValue === '' || rawValue == null || Number.isNaN(num)) return false;
  const a = filter.a === '' || filter.a == null ? null : Number(filter.a);
  const b = filter.b === '' || filter.b == null ? null : Number(filter.b);
  switch (filter.op) {
    case 'gt':
      return a === null ? true : num > a;
    case 'lt':
      return a === null ? true : num < a;
    case 'between':
      return a === null || b === null ? true : num >= Math.min(a, b) && num <= Math.max(a, b);
    case 'notBetween':
      return a === null || b === null ? true : num < Math.min(a, b) || num > Math.max(a, b);
    default:
      return true;
  }
}

/** One risk + its already-computed guideline-status icon, against one filter's value. Dispatches
 *  on `filterType`; each type stores a different shape in `columnFilters` (plain string for
 *  text/select/status, `{ op, a, b }` for numeric — see numericMatches above). */
function columnMatches(risk, gsIcon, col, value) {
  if (col.filterType === 'status') {
    return !value || gsIcon === value;
  }
  if (col.filterType === 'numeric') {
    const raw = col.filterKey === 'revised' ? risk.revised_score : risk.inherent_score;
    return numericMatches(raw, value);
  }
  if (col.filterType === 'select') {
    if (!value) return true;
    const field = {
      team: risk.team_name,
      treatment: risk.risk_treatment,
      register: risk.register,
    }[col.filterKey];
    return field === value;
  }
  // text
  if (!value) return true;
  const v = String(value).trim().toLowerCase();
  if (!v) return true;
  const field = {
    riskid: risk.risk_id,
    issue: risk.issue,
    vulnerability: risk.vulnerability,
    threat: risk.threat,
    title: risk.title,
    control: risk.control,
    updated: risk.updated_at,
  }[col.filterKey];
  return String(field || '').toLowerCase().includes(v);
}

/** Whether a stored filter value (of whatever shape) is actually doing anything right now — used
 *  for the funnel mark's active state, the header summary and the "N of M" count. */
function isFilterActive(value) {
  if (!value) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'object') return Boolean(value.op);
  return false;
}

/** The mockup prints active filter values next to the column label — `· Log360 Cloud`. */
function filterSummary(col, value) {
  if (!isFilterActive(value)) return '';
  if (col.filterType === 'numeric') {
    const op = NUMERIC_OPERATORS.find((o) => o.value === value.op);
    const range = value.op === 'between' || value.op === 'notBetween';
    const nums = range ? [value.a, value.b].filter((n) => n !== '' && n != null).join('–') : (value.a ?? '');
    return `${op ? op.label.toLowerCase() : value.op}${nums ? ` ${nums}` : ''}`;
  }
  if (col.filterType === 'status') {
    return (STATUS_FILTER_OPTIONS.find((o) => o.value === value) || {}).label || '';
  }
  return String(value);
}

/**
 * The Status column reflects whether GUIDELINE_CHECKS actually has a guideline review result for
 * this risk, not just the REVIEW_STATUS column on its own — mapRegisterRecord sets REVIEW_STATUS
 * to 'ok' on every sync (no review has run yet at that point), and only a "Review guidelines" /
 * per-row rerun (POST /api/risks/review or /api/risks/:riskId/review, see risk-review.js) writes a
 * real result. checks.length is what's honest about "no review has run" vs. an actual pass/fail.
 */
function guidelineStatus(checks) {
  if (!checks || checks.length === 0) {
    return { icon: 'unreviewed', label: 'Not reviewed yet', failed: 0, total: 0 };
  }
  const failed = checks.filter(([, result]) => result !== 'pass').length;
  if (failed > 0) {
    return {
      icon: 'fail',
      label: `${failed} of ${checks.length} guideline check${checks.length === 1 ? '' : 's'} failed`,
      failed,
      total: checks.length,
    };
  }
  return {
    icon: 'ok',
    label: `Guideline OK — ${checks.length} check${checks.length === 1 ? '' : 's'} passed`,
    failed: 0,
    total: checks.length,
  };
}

/** A failed rule (e.g. G6) can have more than one finding (risk-review.js's checkRegistryRisk can
 *  push several problems under the same code) — group guideline_findings by rule so the detail
 *  pane can show every problem/suggestion behind a failed check, not just the first one. */
function findingsByRule(findings) {
  const map = {};
  for (const f of findings || []) {
    (map[f.rule] ||= []).push(f);
  }
  return map;
}

/** Failures first, then by rule number — the mockup's sortGuides. */
function sortChecks(checks) {
  return [...(checks || [])].sort((a, b) => {
    const aPass = a[1] === 'pass';
    const bPass = b[1] === 'pass';
    if (aPass !== bPass) return aPass ? 1 : -1;
    return String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true });
  });
}

/**
 * Severity band. The mockup derives High/Medium/Low from the score itself (`n >= 6 ? High : n >= 4
 * ? Medium : Low`); these registers carry a real severity from Creator, normalized server-side by
 * risk-service.js's SEVERITY_MAP, so the band comes from that instead of being recomputed.
 */
const SEVERITY_BAND = { critical: 'high', high: 'high', medium: 'medium', low: 'low' };
/** Mirrors risk-service.js's SEVERITY_MAP, so REVISED_RATING (raw Creator text, e.g. "Very High")
 *  bands the same way SEVERITY does. */
const RATING_TO_SEVERITY = { 'Very High': 'critical', High: 'high', Medium: 'medium', Low: 'low', 'Very Low': 'low' };

function bandOf(severity) {
  return SEVERITY_BAND[severity] || 'low';
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The mockup's two status marks say different things: the calendar is "reviewed inside the agreed
 * cadence", the clipboard is "guideline review result". Only the second comes from `checks`, so
 * the first is derived from `updated_at` against a one-year cadence (G10's own window). An
 * unparseable or missing date reads as idle rather than as a failure.
 */
function recencyMark(updatedAt) {
  if (!updatedAt) return 'idle';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return 'idle';
  return Date.now() - t <= YEAR_MS ? 'pass' : 'fail';
}

/** Inline stroke SVGs — never emoji, per the app's UI design system. The two status glyphs are the
 *  mockup's: a calendar tick for "reviewed", a clipboard tick for "guideline checked". */
const CALENDAR_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="1" />
    <path d="M8 3v4M16 3v4M3 10h18" />
    <path d="M8.5 15.5l2.2 2.2 4.3-4.6" />
  </svg>
);
const CLIPBOARD_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 4H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3" />
    <rect x="9" y="2.5" width="6" height="3.5" rx="1" />
    <path d="M8.5 13.5l2.2 2.2 4.3-4.6" />
  </svg>
);
const CLOCK_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3">
    <circle cx="12" cy="12" r="9" />
  </svg>
);
const RERUN_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);
const FUNNEL_ICON = (
  <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor">
    <path d="M3 4h18l-7 8.5V19l-4 2v-8.5z" />
  </svg>
);
const SEARCH_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);
const COLUMNS_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" />
    <path d="M9 4v16M15 4v16" />
  </svg>
);
const CHEVRON_LEFT_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const CHEVRON_RIGHT_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

/** The 20px hairline status box from the mockup's `markBase`, in its default `box` form. */
function StatusMark({ kind, icon, title }) {
  return (
    <span className={`wsm-mark wsm-mark-${kind}`} title={title}>{icon}</span>
  );
}

/** Score + band pill, the mockup's score badge. */
function ScoreBadge({ score, band, label, title }) {
  if (score === '' || score == null) return <span className="wsm-score wsm-score-none">—</span>;
  return (
    <span className={`wsm-score wsm-score-${band}`} title={title}>
      {score}
      {label && <span className="wsm-score-band">{label}</span>}
    </span>
  );
}

/**
 * A detail-pane field: uppercase label, prose, and Show more.
 *
 * The mockup renders Show more unconditionally on these four fields because its copy was written
 * to overflow. Real register entries are often one line, so the control is measured in — it
 * appears only when the text is actually taller than its collapsed band, which keeps short
 * fields from carrying a button that does nothing.
 */
function Field({ name, label, value, expanded, onToggle, full }) {
  const collapsed = FIELD_COLLAPSED[name];
  const isOpen = Boolean(expanded);
  const bodyRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !collapsed) return undefined;
    const measure = () => {
      // Measured against the collapsed band, so the answer doesn't flip while expanded.
      const limit = parseFloat(collapsed);
      setOverflows(el.scrollHeight > limit + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed, value]);

  return (
    <div className={`wsm-field${full ? ' wsm-field-full' : ''}`}>
      <div className="wsm-label">{label}</div>
      <div ref={bodyRef} className="wsm-field-body" style={{ maxHeight: isOpen ? 'none' : collapsed }}>
        <p>{value || '—'}</p>
      </div>
      {collapsed && value && overflows && (
        <button type="button" className="wsm-more" onClick={() => onToggle(name)}>
          {isOpen ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/** Column-header filter menu — label, active-value summary, funnel mark, and a 258px panel. */
function FilterMenu({ col, extras, filters, open, onOpen, onClose, onSet, onSetNumeric, onClear, teamOptions, registerOptions }) {
  const cols = [col, ...(extras || [])];
  const anyActive = cols.some((c) => isFilterActive(filters[c.filterKey]));
  const summary = filterSummary(col, filters[col.filterKey]);

  const renderInput = (c) => {
    const value = filters[c.filterKey];
    if (c.filterType === 'text') {
      return (
        <input
          type="text"
          placeholder={`Filter ${c.label.toLowerCase()}…`}
          value={value || ''}
          onChange={(e) => onSet(c.filterKey, e.target.value)}
        />
      );
    }
    if (c.filterType === 'select') {
      const options = c.filterKey === 'team' ? teamOptions
        : c.filterKey === 'register' ? registerOptions
          : TREATMENT_OPTIONS;
      return (
        <select value={value || ''} onChange={(e) => onSet(c.filterKey, e.target.value)}>
          <option value="">All</option>
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (c.filterType === 'status') {
      return (
        <select value={value || ''} onChange={(e) => onSet(c.filterKey, e.target.value)}>
          {STATUS_FILTER_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      );
    }
    const nf = value || {};
    const isRange = nf.op === 'between' || nf.op === 'notBetween';
    return (
      <>
        <select value={nf.op || ''} onChange={(e) => onSetNumeric(c.filterKey, { op: e.target.value })}>
          <option value="">Operator…</option>
          {NUMERIC_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
        {nf.op && (
          <div className="col-filter-numeric-inputs">
            <input
              type="number"
              placeholder={isRange ? 'Min' : 'Value'}
              value={nf.a ?? ''}
              onChange={(e) => onSetNumeric(c.filterKey, { a: e.target.value })}
            />
            {isRange && (
              <input
                type="number"
                placeholder="Max"
                value={nf.b ?? ''}
                onChange={(e) => onSetNumeric(c.filterKey, { b: e.target.value })}
              />
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="wsm-th">
      <button type="button" className="wsm-th-btn" onClick={() => (open ? onClose() : onOpen(col.key))}>
        <span className="wsm-th-label">{col.label}</span>
        {summary && <span className="wsm-th-summary">· {summary}</span>}
        <span className={`wsm-th-mark${anyActive ? ' wsm-th-mark-on' : ''}`} aria-hidden="true">{FUNNEL_ICON}</span>
      </button>
      {open && (
        <>
          <div className="col-filter-pop-overlay" onClick={onClose} />
          <div className="col-filter-pop">
            {cols.map((c) => (
              <label key={c.key} className="wsm-filter-field">
                <span className="wsm-filter-label">{c.label}</span>
                {renderInput(c)}
              </label>
            ))}
            <div className="wsm-filter-foot">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => cols.forEach((c) => onClear(c.filterKey))}
                disabled={!anyActive}
              >
                Clear
              </button>
              <button type="button" className="btn" onClick={onClose}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function RiskRegister({ onNotice }) {
  // Only `q` (search) and pagination go to the server — see the file header comment.
  const [filters, setFilters] = useState({ q: '', page: 1 });
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [state, setState] = useState({ status: 'loading', risks: [], error: '', total: 0, page: 1, limit: DEFAULT_PAGE_SIZE });
  const [teamOptions, setTeamOptions] = useState([]);
  const [registerOptions, setRegisterOptions] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [preview, setPreview] = useState({}); // risk_id -> { status: 'loading'|'ok'|'error', data?, error? }
  const [busy, setBusy] = useState(false);
  const [rerunning, setRerunning] = useState({}); // risk_id -> true while its rerun is in flight

  // Guidelines viewer.
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [guidelines, setGuidelines] = useState({ status: 'idle', text: '', error: '' });

  // Column visibility.
  const [hiddenColumns, setHiddenColumns] = useState(loadHiddenColumns);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);

  // Per-column header filters — value shape depends on filterType (see columnMatches).
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterCol, setOpenFilterCol] = useState(null);

  const [searchOpen, setSearchOpen] = useState(false);

  /** Which detail-pane fields are expanded past their collapsed band, and which guideline rows
   *  are showing their findings. Both reset when another risk is opened. */
  const [expandedFields, setExpandedFields] = useState({});
  const [openCheck, setOpenCheck] = useState(null);

  /**
   * The shell's top bar (App.jsx) owns the breadcrumb; the mockup puts this view's search, counter
   * and actions in the same bar. Portalling into the slot the shell renders keeps that one row
   * without the shell having to know anything about risks.
   */
  const [slot, setSlot] = useState(null);
  const slotPoll = useRef(null);
  useEffect(() => {
    const find = () => {
      const el = document.getElementById('wsm-top-slot');
      if (el) { setSlot(el); return true; }
      return false;
    };
    if (!find()) {
      // The slot is a sibling in the same commit, so one more tick is always enough; the interval
      // is only a guard against the view being mounted outside the shell (tests, storybook).
      slotPoll.current = setInterval(() => { if (find()) clearInterval(slotPoll.current); }, 50);
    }
    return () => clearInterval(slotPoll.current);
  }, []);

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    params.set('page', filters.page || 1);
    params.set('limit', pageSize);
    const qs = params.toString();
    api(`/risks${qs ? `?${qs}` : ''}`)
      .then((r) => {
        const risks = r.risks || [];
        setState({
          status: 'ok',
          risks,
          error: '',
          total: r.total ?? risks.length,
          page: r.page ?? (filters.page || 1),
          limit: r.limit ?? pageSize,
        });
        // Dropdowns reflect whatever page is currently loaded — same as every other column filter,
        // which only ever sees the current page (see the file header comment).
        setTeamOptions(Array.from(new Set(risks.map((x) => x.team_name).filter(Boolean))).sort());
        setRegisterOptions(Array.from(new Set(risks.map((x) => x.register).filter(Boolean))).sort());
        // The rail shows a count beside each section (the mockup's nav). The total only exists
        // here, and an event is cheaper than the shell making its own /risks call just to count.
        window.dispatchEvent(new CustomEvent('wsm:section-count', {
          detail: { path: '/risk-register', count: r.total ?? risks.length },
        }));
      })
      .catch((err) => setState({ status: 'error', risks: [], error: err.message, total: 0, page: 1, limit: pageSize }));
  }, [filters, pageSize]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (label, fn, { reloadAlways } = {}) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : `${label} failed.`);
      if (reloadAlways) load(); // reflect whatever the server actually ended up with, not stale state
    } finally {
      setBusy(false);
    }
  };

  const syncFromCreator = () => runAction(
    'Sync from Creator',
    () => api('/risks/sync', { method: 'POST' }).then(load),
    { reloadAlways: true }
  );

  // Scripted guideline review (G6-G10, G19 — see risk-review.js/risk-guidelines.md), run in bulk
  // against every risk currently in compliance_risks in one call. The other rules (G1-G5/G11-
  // G13/G15-G18) need an LLM path this app doesn't have yet, so the summary says so rather than
  // implying every rule was checked.
  const reviewGuidelines = () => runAction(
    'Review guidelines',
    () => api('/risks/review', { method: 'POST' }).then((r) => {
      onNotice?.(
        `Guideline review: ${r.ok} OK, ${r.needs_review} need review (checked ${r.rules_implemented.join(', ')} ` +
        `— ${r.pending_llm_rules.join(', ')} need an LLM path, not run).`
      );
      return load();
    }),
    { reloadAlways: true }
  );

  const openGuidelines = () => {
    setGuidelinesOpen(true);
    if (guidelines.status === 'ok') return; // already fetched this session
    setGuidelines({ status: 'loading', text: '', error: '' });
    api('/risks/guidelines')
      .then((r) => setGuidelines({ status: 'ok', text: r.guidelines || '', error: '' }))
      .catch((err) => setGuidelines({
        status: 'error',
        text: '',
        error: err instanceof ApiError ? err.message : 'Could not load the guidelines.',
      }));
  };

  /** Open a risk into split mode. The one live Creator call for "last reviewed by" happens here. */
  const openRisk = (riskId) => {
    setOpenId(riskId);
    setExpandedFields({});
    setOpenCheck(null);
    if (riskId && !preview[riskId]) {
      setPreview((p) => ({ ...p, [riskId]: { status: 'loading' } }));
      api(`/risks/${encodeURIComponent(riskId)}/preview`)
        .then((r) => setPreview((p) => ({ ...p, [riskId]: { status: 'ok', data: r.preview } })))
        .catch((err) => setPreview((p) => ({
          ...p,
          [riskId]: { status: 'error', error: err instanceof ApiError ? err.message : 'Preview failed.' },
        })));
    }
  };

  /** Per-risk rerun of the scripted guideline checks (POST /api/risks/:riskId/review); patches the
   *  row in place rather than reloading the list. */
  const rerunGuideline = (event, riskId) => {
    event?.stopPropagation();
    if (rerunning[riskId]) return;
    setRerunning((r) => ({ ...r, [riskId]: true }));
    api(`/risks/${encodeURIComponent(riskId)}/review`, { method: 'POST' })
      .then((r) => {
        setState((s) => ({
          ...s,
          risks: s.risks.map((risk) => (
            risk.risk_id === riskId
              ? { ...risk, status: r.status, checks: r.checks, guideline_findings: r.findings }
              : risk
          )),
        }));
      })
      .catch((err) => onNotice?.(err instanceof ApiError ? err.message : 'Guideline rerun failed.'))
      .finally(() => setRerunning((r) => ({ ...r, [riskId]: false })));
  };

  const toggleColumn = (key) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveHiddenColumns(next);
      return next;
    });
  };

  const setColumnFilter = (key, value) => setColumnFilters((prev) => ({ ...prev, [key]: value }));
  const setNumericFilter = (key, patch) => setColumnFilters((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
  const clearColumnFilter = (key) => setColumnFilters((prev) => {
    const next = { ...prev };
    delete next[key];
    return next;
  });

  const changePageSize = (size) => {
    setPageSize(size);
    setFilters((f) => ({ ...f, page: 1 }));
  };

  const toggleField = (name) => setExpandedFields((prev) => ({ ...prev, [name]: !prev[name] }));

  const visibleRisks = useMemo(
    () => state.risks.filter((r) => {
      const gsIcon = guidelineStatus(r.checks).icon;
      return ALL_FILTERS.every((c) => columnMatches(r, gsIcon, c, columnFilters[c.filterKey]));
    }),
    [state.risks, columnFilters]
  );

  const activeColumns = COLUMNS.filter((c) => !hiddenColumns.has(c.key));
  const hasColumnFilters = Object.values(columnFilters).some(isFilterActive);

  const totalPages = Math.max(1, Math.ceil((state.total || 0) / (state.limit || pageSize)));
  const currentPage = Math.min(state.page || 1, totalPages);
  const rangeStart = state.total === 0 ? 0 : (currentPage - 1) * (state.limit || pageSize) + 1;
  const rangeEnd = Math.min(currentPage * (state.limit || pageSize), state.total);

  const active = openId ? state.risks.find((x) => x.risk_id === openId) : null;
  const splitMode = Boolean(active);

  // The open risk can vanish from view when a filter changes or a page loads — fall back to table
  // mode rather than leaving the detail pane showing a row that is no longer in the list.
  useEffect(() => {
    if (openId && !state.risks.some((x) => x.risk_id === openId)) setOpenId(null);
  }, [state.risks, openId]);

  const countLabel = state.status === 'loading'
    ? 'Loading…'
    : hasColumnFilters
      ? `${visibleRisks.length} of ${state.risks.length} shown`
      : state.total > 0
        ? `${rangeStart}–${rangeEnd} of ${state.total} risks`
        : 'No risks';

  /* ── top bar ─────────────────────────────────────────────────────────────────────────────── */

  const topBar = (
    <>
      {splitMode && (
        <button type="button" className="btn btn-ghost" onClick={() => setOpenId(null)}>← All risks</button>
      )}

      <div className={`wsm-search${searchOpen ? ' wsm-search-open' : ''}`}>
        {searchOpen ? (
          <input
            type="search"
            autoFocus
            placeholder="Search risk ID, title…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })}
            onBlur={() => { if (!filters.q) setSearchOpen(false); }}
          />
        ) : (
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSearchOpen(true)} title="Search" aria-label="Search risks">
            {SEARCH_ICON}
          </button>
        )}
      </div>

      <div className="wsm-top-right">
        <div className="wsm-pager">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setFilters({ ...filters, page: currentPage - 1 })}
            disabled={currentPage <= 1}
            aria-label="Previous page"
            title="Previous page"
          >
            {CHEVRON_LEFT_ICON}
          </button>
          <span className="wsm-count">{countLabel}</span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setFilters({ ...filters, page: currentPage + 1 })}
            disabled={currentPage >= totalPages}
            aria-label="Next page"
            title="Next page"
          >
            {CHEVRON_RIGHT_ICON}
          </button>
        </div>

        <label className="wsm-rows">
          <span className="wsm-label">Rows</span>
          <select value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        {!splitMode && (
          <div className="col-filter-wrap">
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => setColumnsMenuOpen((v) => !v)}
              aria-label="Show or hide columns"
              title="Columns"
            >
              {COLUMNS_ICON}
            </button>
            {columnsMenuOpen && (
              <>
                <div className="col-filter-pop-overlay" onClick={() => setColumnsMenuOpen(false)} />
                <div className="col-filter-pop columns-menu">
                  <div className="wsm-filter-label">Columns shown</div>
                  {COLUMNS.map((c) => (
                    <label key={c.key} className="columns-menu-row">
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.has(c.key)}
                        disabled={!c.hideable}
                        onChange={() => toggleColumn(c.key)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <button className="btn" onClick={openGuidelines}>View guidelines</button>
        <button className="btn" onClick={syncFromCreator} disabled={busy}>Sync from Creator</button>
        <button className="btn btn-primary" onClick={reviewGuidelines} disabled={busy}>Review guidelines</button>
      </div>
    </>
  );

  /* ── rows ────────────────────────────────────────────────────────────────────────────────── */

  const statusCell = (r, gs) => (
    <span className="wsm-status-cell">
      <StatusMark
        kind={recencyMark(r.updated_at)}
        icon={r.updated_at ? CALENDAR_ICON : CLOCK_ICON}
        title={r.updated_at ? `Updated ${r.updated_at}` : 'No update date recorded'}
      />
      <StatusMark
        kind={gs.icon === 'fail' ? 'fail' : gs.icon === 'ok' ? 'pass' : 'idle'}
        icon={gs.icon === 'unreviewed' ? CLOCK_ICON : CLIPBOARD_ICON}
        title={gs.label}
      />
      <button
        type="button"
        className="btn btn-ghost btn-icon-sm"
        onClick={(e) => rerunGuideline(e, r.risk_id)}
        disabled={rerunning[r.risk_id]}
        title="Rerun guideline review for this risk"
        aria-label="Rerun guideline review for this risk"
      >
        <span className={rerunning[r.risk_id] ? 'spin' : ''}>{RERUN_ICON}</span>
      </button>
    </span>
  );

  const tableCols = activeColumns.map((c) => c.width).join(' ');

  const tableView = (
    <div className="pane wsm-table-pane">
      <div className="wsm-table" style={{ minWidth: '900px' }}>
        <div className="wsm-thead" style={{ gridTemplateColumns: tableCols }}>
          {activeColumns.map((c) => (
            <FilterMenu
              key={c.key}
              col={c}
              extras={c.key === 'issue' ? EXTRA_FILTERS : null}
              filters={columnFilters}
              open={openFilterCol === c.key}
              onOpen={setOpenFilterCol}
              onClose={() => setOpenFilterCol(null)}
              onSet={setColumnFilter}
              onSetNumeric={setNumericFilter}
              onClear={clearColumnFilter}
              teamOptions={teamOptions}
              registerOptions={registerOptions}
            />
          ))}
        </div>

        {visibleRisks.map((r, i) => {
          const gs = guidelineStatus(r.checks);
          const cell = {
            status: <span key="status">{statusCell(r, gs)}</span>,
            riskid: <span key="riskid" className="wsm-riskid" title={r.risk_id || ''}>{r.risk_id || '—'}</span>,
            issue: (
              <button key="issue" type="button" className="wsm-issue" onClick={() => openRisk(r.risk_id)}>
                {r.issue || r.title || '—'}
              </button>
            ),
            register: <span key="register" className="wsm-registry">{(r.register || '—').toUpperCase()}</span>,
            score: (
              <span key="score">
                <ScoreBadge
                  score={r.inherent_score}
                  band={bandOf(r.severity)}
                  label={r.severity}
                  title={`Risk score · ${r.severity || 'unrated'}`}
                />
              </span>
            ),
            team: <span key="team" className="wsm-team">{r.team_name || '—'}</span>,
          };
          return (
            <div
              key={r.risk_id}
              data-row="1"
              className="wsm-trow"
              style={{
                gridTemplateColumns: tableCols,
                animation: `wsm-row-a 300ms var(--ease) ${Math.min(i * 28, 340)}ms both`,
              }}
            >
              {activeColumns.map((c) => cell[c.key])}
            </div>
          );
        })}
      </div>

      {state.status === 'ok' && visibleRisks.length === 0 && (
        <p className="wsm-empty">No risks match this search or filter.</p>
      )}
      {state.status === 'loading' && <p className="wsm-empty">Loading…</p>}
    </div>
  );

  /* ── split mode ──────────────────────────────────────────────────────────────────────────── */

  const listView = (
    <div className="pane wsm-list-pane">
      {visibleRisks.map((r, i) => {
        const gs = guidelineStatus(r.checks);
        return (
          <button
            key={r.risk_id}
            type="button"
            data-row="1"
            className={`wsm-lrow${openId === r.risk_id ? ' wsm-lrow-on' : ''}`}
            onClick={() => openRisk(r.risk_id)}
            style={{ animation: `wsm-row-a 300ms var(--ease) ${Math.min(i * 28, 340)}ms both` }}
          >
            <span className="wsm-lrow-title">{r.issue || r.title}</span>
            <span className="wsm-lrow-sub"><span className="wsm-riskid">{r.risk_id || '—'}</span> · {r.team_name || '—'}</span>
            <span className="wsm-lrow-chips">
              <span className="tag">{(r.register || '—').toUpperCase()}</span>
              <StatusMark
                kind={gs.icon === 'fail' ? 'fail' : gs.icon === 'ok' ? 'pass' : 'idle'}
                icon={gs.icon === 'unreviewed' ? CLOCK_ICON : CLIPBOARD_ICON}
                title={gs.label}
              />
              <ScoreBadge
                score={r.inherent_score}
                band={bandOf(r.severity)}
                label={r.severity}
                title={`Risk score · ${r.severity || 'unrated'}`}
              />
            </span>
          </button>
        );
      })}
      {visibleRisks.length === 0 && <p className="wsm-empty">No risks match this search or filter.</p>}
    </div>
  );

  const detailView = (() => {
    if (!active) return null;
    const r = active;
    const gs = guidelineStatus(r.checks);
    const byRule = findingsByRule(r.guideline_findings);
    const checks = sortChecks(r.checks);
    const pv = preview[r.risk_id];
    const inherent = Number(r.inherent_score);
    const revised = Number(r.revised_score);
    const hasDelta = !Number.isNaN(inherent) && !Number.isNaN(revised);
    const delta = hasDelta && revised < inherent ? `↓ ${inherent - revised}` : '→ 0';
    const revisedBand = bandOf(RATING_TO_SEVERITY[r.revised_rating]);

    const lastReviewed = !pv || pv.status === 'loading'
      ? 'Loading…'
      : pv.status === 'error'
        ? 'Unavailable'
        : (pv.data?.last_reviewed_on || 'Unknown');

    return (
      <div className="wsm-detail">
        <div className="wsm-detail-head">
          <div className="wsm-eyebrow">
            <span className="wsm-riskid">{r.risk_id || '—'}</span> · {(r.register || '').toUpperCase()} · {r.team_name || '—'}
          </div>
          <h2 className="wsm-headline">{r.title}</h2>
        </div>

        <div className="pane wsm-detail-body">
          <div className="wsm-detail-main">
          <div className="wsm-step">
            <div className="wsm-step-gutter">
              <span className="wsm-step-num">01</span>
              <span className="wsm-step-rule" aria-hidden="true" />
            </div>
            <div className="wsm-step-body">
              <div className="wsm-step-head">
                <span className="wsm-section-h">Assessment</span>
                <span className="wsm-step-caption">What the register records before treatment</span>
              </div>

              <div className="wsm-field-grid">
                <Field name="issue" label="Issue" value={r.issue} expanded={expandedFields.issue} onToggle={toggleField} full />
                <Field name="vulnerability" label="Vulnerability" value={r.vulnerability} expanded={expandedFields.vulnerability} onToggle={toggleField} />
                <Field name="threat" label="Threat" value={r.threat} expanded={expandedFields.threat} onToggle={toggleField} />
              </div>

            </div>
          </div>

          <div className="wsm-step">
            <div className="wsm-step-gutter">
              <span className="wsm-step-num">02</span>
            </div>
            <div className="wsm-step-body">
              <div className="wsm-step-head">
                <span className="wsm-section-h">Control applied</span>
                <span className="wsm-step-caption">{r.feature || 'No feature recorded'}</span>
              </div>
              <div className="wsm-field-grid">
                <Field name="control" label="Control" value={r.control} expanded={expandedFields.control} onToggle={toggleField} full />
              </div>
            </div>
          </div>
          </div>

          <div className="wsm-detail-side">
          <div className="wsm-scorecard">
            <div className="wsm-scorecard-head">
              <span className="wsm-label">Risk score</span>
              <span className="wsm-delta">{delta}</span>
            </div>
            <div className="wsm-scorecard-body">
              <div className="wsm-scorecell" style={{ boxShadow: `inset 0 -2px 0 var(--band-${bandOf(r.severity)})` }}>
                <div className="wsm-label">Inherent</div>
                <div className="wsm-scorenum" style={{ color: `var(--band-${bandOf(r.severity)})` }}>
                  {r.inherent_score || '—'}
                </div>
                {r.severity && <span className={`wsm-band wsm-band-${bandOf(r.severity)}`}>{r.severity}</span>}
              </div>
              <span className="wsm-scorearrow" aria-hidden="true">→</span>
              <div className="wsm-scorecell" style={{ boxShadow: `inset 0 -2px 0 var(--band-${revisedBand})` }}>
                <div className="wsm-label">After control</div>
                <div className="wsm-scorenum" style={{ color: `var(--band-${revisedBand})` }}>
                  {r.revised_score || '—'}
                </div>
                {r.revised_rating && <span className={`wsm-band wsm-band-${revisedBand}`}>{r.revised_rating}</span>}
              </div>
            </div>
          </div>

        <div className="pane wsm-guide-region">
          <div className="wsm-guide-bar">
            <span className="wsm-section-h">Guideline review</span>
            <span className={`wsm-guide-summary${gs.failed ? ' wsm-guide-summary-fail' : ''}`}>
              {gs.total === 0
                ? 'Not reviewed yet'
                : gs.failed
                  ? `${gs.failed} guideline${gs.failed === 1 ? '' : 's'} failed`
                  : `${gs.total} passed`}
            </span>
            <button
              type="button"
              className="btn wsm-rerun"
              onClick={(e) => rerunGuideline(e, r.risk_id)}
              disabled={rerunning[r.risk_id]}
            >
              {rerunning[r.risk_id] ? 'Running…' : 'Re-run review'}
            </button>
          </div>

          {gs.total > 0 && (
            <div className="wsm-guide-strip" aria-hidden="true">
              {checks.map(([code, result]) => (
                <span
                  key={code}
                  title={`${code} · ${result === 'pass' ? 'met' : 'failed'}`}
                  className={result === 'pass' ? 'wsm-seg' : 'wsm-seg wsm-seg-fail'}
                />
              ))}
            </div>
          )}

          {gs.total === 0 && <p className="wsm-empty">No review has run for this risk yet.</p>}

          <div className="wsm-guide-list">
          {checks.map(([code, result]) => {
            const pass = result === 'pass';
            const findings = byRule[code] || [];
            const isOpen = openCheck === code;
            return (
              <div key={code} className={`wsm-guide-row${pass ? '' : ' wsm-guide-row-fail'}`}>
                <button
                  type="button"
                  className="wsm-guide-head"
                  onClick={() => setOpenCheck(isOpen ? null : code)}
                  disabled={pass && findings.length === 0}
                >
                  <span
                    className={`wsm-guide-glyph${pass ? '' : ' wsm-guide-glyph-fail'}`}
                    title={pass ? 'Met' : 'Failed'}
                  >
                    {pass ? '✓' : '✕'}
                  </span>
                  <span className="wsm-guide-id">{code}</span>
                  <span className="wsm-guide-title">
                    {findings[0]?.problem || (pass ? 'Check passed' : 'Check failed')}
                  </span>
                  <span className={`wsm-guide-count${pass ? '' : ' wsm-guide-count-fail'}`}>
                    {pass ? 'Pass' : `${findings.length || 1} issue${(findings.length || 1) === 1 ? '' : 's'}`}
                  </span>
                  <span
                    className={`wsm-guide-chev${isOpen ? ' wsm-guide-chev-open' : ''}`}
                    aria-hidden="true"
                  >
                    ›
                  </span>
                </button>
                {isOpen && findings.length > 0 && (
                  <div className="wsm-guide-findings">
                    {findings.map((f, idx) => (
                      <div key={idx} className="wsm-finding">
                        {/* The collapsed row already shows the first problem — repeating it here
                            would print the same sentence twice. Later findings under the same
                            rule do need their own line. */}
                        {idx > 0 && <p className="wsm-finding-problem">{f.problem}</p>}
                        {f.suggestion && (
                          <>
                            <div className="wsm-finding-label">Suggestion</div>
                            <p className="wsm-finding-sug">{f.suggestion}</p>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
          </div>
        </div>

        <div className="wsm-detail-foot">
          <div className="wsm-foot-cell">
            <div className="wsm-label">Treatment</div>
            <div className="wsm-foot-value">{r.risk_treatment || '—'}</div>
          </div>
          <div className="wsm-foot-cell">
            <div className="wsm-label">Registry</div>
            <div className="wsm-foot-value">{(r.register || '—').toUpperCase()}</div>
          </div>
          <div className="wsm-foot-cell">
            <div className="wsm-label">Last reviewed</div>
            <div className="wsm-foot-value">{lastReviewed}</div>
            {pv?.status === 'ok' && pv.data?.last_reviewed_by && (
              <div className="wsm-foot-sub">{pv.data.last_reviewed_by}</div>
            )}
            {pv?.status === 'error' && <div className="wsm-foot-sub">{pv.error}</div>}
          </div>
        </div>
      </div>
    );
  })();

  /* ── render ──────────────────────────────────────────────────────────────────────────────── */

  if (state.status === 'error') {
    return (
      <div className="wsm-register">
        <div className="wsm-register-error">
          <div className="banner banner-err" role="status">{state.error}</div>
          <button className="btn" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {slot && createPortal(topBar, slot)}

      <div className={`wsm-register${splitMode ? ' wsm-register-split' : ''}`}>
        {splitMode ? (
          <>
            {listView}
            {detailView}
          </>
        ) : tableView}
      </div>

      {guidelinesOpen && (
        <div className="modal-backdrop" onClick={() => setGuidelinesOpen(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Risk guidelines</h2>
              <button className="modal-close" onClick={() => setGuidelinesOpen(false)} aria-label="Close" title="Close">×</button>
            </div>
            {guidelines.status === 'loading' && <p className="hint">Loading…</p>}
            {guidelines.status === 'error' && <div className="banner banner-err" role="status">{guidelines.error}</div>}
            {guidelines.status === 'ok' && (
              <>
                <GuidelinesLegend />
                <div className="guidelines-text"><GuidelinesView text={guidelines.text} /></div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
