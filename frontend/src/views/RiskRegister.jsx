import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../lib/api';
import GuidelinesView, { GuidelinesLegend } from './GuidelinesView';

/**
 * Risk Register — first slice of compliancemanager (risk_manager) in the Welcome app.
 *
 * The list comes from the `compliance_risks` DataStore table, filled by "Sync from Creator" (a
 * full pull-and-replace from the real Zoho Creator connection — see risk-service.js), scoped to
 * whichever Creator Team_Name values are configured in Settings › Compliance (ComplianceConfig.jsx,
 * backed by the shared `tool_config` table, no redeploy needed to add a team).
 *
 * Issue/Vulnerability/Threat/Risk/Risk score/Control/Risk treatment/Revised risk score are real
 * columns on every row (populated by syncFromCreator/mapRegisterRecord in risk-service.js — none
 * of them are PII). Opening a risk makes one live call to Creator (GET /api/risks/:riskId/preview)
 * for everything the detail pane shows beyond those columns — C/I/A scores, revised likelihood and
 * impact, ISO/CCM controls, asset, interested parties, need/expectation, owner and the review and
 * approval stamps. The owner/reviewer/approver emails are the reason it is live: they are PII this
 * app's datastore-conventions.md says must never be cached.
 *
 * "Review guidelines" runs the scripted checks against every risk currently in compliance_risks in
 * one call (risk-service.js's reviewGuidelines); "Review selected" runs the per-risk check (POST
 * /api/risks/:riskId/review) for each ticked row; the detail pane's Re-run review does one risk.
 *
 * ── Layout (2026-10-09) ──────────────────────────────────────────────────────────────────────
 * Built to the "WSM Security v5" mockup (design/WSM Security v5.dc.html — see README › Design).
 * Two modes, as in the mockup:
 *
 *   table  the default — select · status · issue · type · team, one scroll pane with a sticky
 *          header whose columns carry their own filter menus. The Status menu also holds the
 *          "Status detail" toggle that prints the review date and guideline result beside the icons.
 *   split  opened by clicking a risk — a narrow list beside a detail pane: eyebrow + headline, a
 *          strip of six measures, then Overview / Treatment / Context / Review tabs. "Rule details"
 *          on a guideline row slides a panel in from the right. "← All risks" returns to table mode.
 *
 * Deliberate departures from the mockup:
 *   · Risk ID and Risk score columns still exist, hidden by default — the Columns menu turns them
 *     back on (the mockup never had them in table mode; these registers carry real values);
 *   · pagination stays. The mockup shows 12 rows and a bare counter; this register is 200+ risks,
 *     so the counter sits beside real page controls;
 *   · the extra per-column filters the old table had (Vulnerability, Threat, Risk, Control,
 *     Revised score, Updated) are kept under the Issue header.
 *
 * Filtering is unchanged: only `q` (search) and pagination go to the server — every column filter
 * matches client-side against whatever page of risks is currently loaded.
 */

/** Fixed set of valid treatment values — mirrors risk-review.js's VALID_TREATMENTS, which is what
 *  the scripted guideline checks (and Creator itself) actually allow. */
const TREATMENT_OPTIONS = ['Risk Modification', 'Risk Retention', 'Risk Avoidance', 'Risk Sharing'];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'ok', label: 'Met' },
  { value: 'fail', label: 'Failed' },
  { value: 'unreviewed', label: 'Not reviewed yet' },
];

const RECENT_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pass', label: 'Yes' },
  { value: 'fail', label: 'No' },
];

const NUMERIC_OPERATORS = [
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
  { value: 'between', label: 'Between' },
  { value: 'notBetween', label: 'Not between' },
];

/**
 * Columns in table mode. `hideable: false` columns can't be turned off from the Columns menu
 * (Select, Status + Issue are what make a row identifiable). `filterType` decides which kind of
 * panel the header's filter menu opens — see columnMatches(). `width` is the mockup's; Status
 * widens when the detail toggle is on (see statusWidth).
 */
const COLUMNS = [
  { key: 'select', label: '', hideable: false, filterType: null, width: '46px' },
  { key: 'status', label: 'Status', hideable: false, filterKey: 'status', filterType: 'status', width: '128px' },
  { key: 'riskid', label: 'Risk ID', hideable: true, filterKey: 'riskid', filterType: 'text', width: '124px' },
  { key: 'issue', label: 'Issue', hideable: false, filterKey: 'issue', filterType: 'text', width: 'minmax(0, 2.1fr)' },
  { key: 'register', label: 'Type', hideable: true, filterKey: 'register', filterType: 'select', width: '84px' },
  { key: 'score', label: 'Risk score', hideable: true, filterKey: 'score', filterType: 'numeric', width: '124px' },
  { key: 'team', label: 'Team', hideable: true, filterKey: 'team', filterType: 'select', width: 'minmax(0, 1.1fr)' },
];

/** Hidden until someone turns them on — the mockup's table has neither. */
const DEFAULT_HIDDEN_COLUMNS = ['riskid', 'score'];

/** Filters with no column of their own. "Reviewed ≤ 1 yr" joins the Status header (the mockup's
 *  pairing); the long-text and numeric extras hang off the Issue header. */
const STATUS_EXTRA_FILTERS = [
  { key: 'recent', label: 'Reviewed ≤ 1 yr', filterKey: 'recent', filterType: 'recent' },
];
const ISSUE_EXTRA_FILTERS = [
  { key: 'treatment', label: 'Treatment', filterKey: 'treatment', filterType: 'select' },
  { key: 'vulnerability', label: 'Vulnerability', filterKey: 'vulnerability', filterType: 'text' },
  { key: 'threat', label: 'Threat', filterKey: 'threat', filterType: 'text' },
  { key: 'title', label: 'Risk', filterKey: 'title', filterType: 'text' },
  { key: 'control', label: 'Control', filterKey: 'control', filterType: 'text' },
  { key: 'revised', label: 'Revised risk score', filterKey: 'revised', filterType: 'numeric' },
  { key: 'updated', label: 'Updated', filterKey: 'updated', filterType: 'text' },
];

const ALL_FILTERS = [...COLUMNS.filter((c) => c.filterType), ...STATUS_EXTRA_FILTERS, ...ISSUE_EXTRA_FILTERS];

const COLUMNS_STORAGE_KEY = 'wsm.riskRegister.hiddenColumns';
const DETAIL_STORAGE_KEY = 'wsm.riskRegister.statusDetail';
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

const DETAIL_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'treatment', label: 'Treatment' },
  { key: 'context', label: 'Context' },
  { key: 'review', label: 'Review' },
];

function loadHiddenColumns() {
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (raw === null) return new Set(DEFAULT_HIDDEN_COLUMNS);
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : DEFAULT_HIDDEN_COLUMNS);
  } catch {
    return new Set(DEFAULT_HIDDEN_COLUMNS);
  }
}

function saveHiddenColumns(hidden) {
  try {
    window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(hidden)));
  } catch {
    /* best-effort only — a column-visibility preference isn't worth failing over */
  }
}

function loadStatusDetail() {
  try {
    return window.localStorage.getItem(DETAIL_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function saveStatusDetail(on) {
  try {
    window.localStorage.setItem(DETAIL_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* best-effort only */
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

/** One risk + its already-computed status marks, against one filter's value. Dispatches on
 *  `filterType`; each type stores a different shape in `columnFilters` (plain string for
 *  text/select/status/recent, `{ op, a, b }` for numeric — see numericMatches above). */
function columnMatches(risk, marks, col, value) {
  if (col.filterType === 'status') {
    return !value || marks.guide === value;
  }
  if (col.filterType === 'recent') {
    return !value || marks.recent === value;
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
  if (col.filterType === 'recent') {
    const opt = RECENT_FILTER_OPTIONS.find((o) => o.value === value);
    return opt ? `reviewed ${opt.label.toLowerCase()}` : '';
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
    return { icon: 'unreviewed', label: 'Not reviewed yet', short: 'Not reviewed', failed: 0, total: 0 };
  }
  const failedCodes = checks.filter(([, result]) => result !== 'pass').map(([code]) => code);
  if (failedCodes.length > 0) {
    return {
      icon: 'fail',
      label: `${failedCodes.join(', ')} failed`,
      short: `${failedCodes.join(', ')} failed`,
      failed: failedCodes.length,
      total: checks.length,
    };
  }
  return {
    icon: 'ok',
    label: `All ${checks.length} guideline${checks.length === 1 ? '' : 's'} met`,
    short: 'Met',
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

/* ── icons — inline stroke SVGs, never emoji (the app's UI design system) ───────────────────── */

const svgProps = { viewBox: '0 0 24 24', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

/** Calendar with a tick / cross — "reviewed within the last 12 months" and its failure. */
const CALENDAR_OK_ICON = (
  <svg {...svgProps}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="1" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
    <path d="M9 15.5l2 2 4-4" />
  </svg>
);
const CALENDAR_FAIL_ICON = (
  <svg {...svgProps}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="1" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
    <path d="M10 13.5l4 4M14 13.5l-4 4" />
  </svg>
);
/** Clipboard with a tick / cross — "guideline review met" and its failure. */
const CLIPBOARD_OK_ICON = (
  <svg {...svgProps}>
    <rect x="5" y="4" width="14" height="17" rx="1" />
    <path d="M9 2.5h6v3.5H9z" />
    <path d="M9 13.5l2 2 4-4" />
  </svg>
);
const CLIPBOARD_FAIL_ICON = (
  <svg {...svgProps}>
    <rect x="5" y="4" width="14" height="17" rx="1" />
    <path d="M9 2.5h6v3.5H9z" />
    <path d="M10 11.5l4 4M14 11.5l-4 4" />
  </svg>
);
/** Dashed ring — nothing recorded yet. */
const IDLE_ICON = (
  <svg {...svgProps} strokeDasharray="3 3">
    <circle cx="12" cy="12" r="9" />
  </svg>
);
const FUNNEL_ICON = (
  <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true">
    <path d="M3 4h18l-7 8.5V19l-4 2v-8.5z" />
  </svg>
);
const COLUMNS_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" />
    <path d="M9 4v16M15 4v16" />
  </svg>
);
const CHEVRON_LEFT_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const CHEVRON_RIGHT_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

/* ── small presentational pieces ────────────────────────────────────────────────────────────── */

/** The mockup's `bare` status mark: a coloured glyph, no box. `kind` is pass | fail | idle | run. */
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

/** Band pill on its own — the mockup's "High / Medium / Low" tag in the measures strip. */
function BandPill({ band, label }) {
  if (!label) return null;
  return <span className={`wsm-band wsm-band-${band}`}>{label}</span>;
}

/** A measures-strip cell: uppercase label over a value. */
function Kpi({ label, children }) {
  return (
    <div className="wsm-kpi">
      <div className="wsm-label">{label}</div>
      <div className="wsm-kpi-value">{children}</div>
    </div>
  );
}

/** "before → after" pair, the after side in the second accent when it dropped. */
function BeforeAfter({ before, after }) {
  const b = before ?? null;
  const a = after ?? null;
  const dropped = b !== null && a !== null && Number(a) < Number(b);
  return (
    <span className="wsm-ba">
      <span className="wsm-ba-before">{b === null ? '—' : b}</span>
      <span className="wsm-ba-arrow" aria-hidden="true">→</span>
      <span className={`wsm-ba-after${dropped ? ' wsm-ba-after-down' : ''}`}>{a === null ? '—' : a}</span>
    </span>
  );
}

/** A labelled row in the detail tabs: uppercase label on the left, prose on the right. */
function DetailRow({ label, children }) {
  return (
    <div className="wsm-drow">
      <div className="wsm-label wsm-drow-label">{label}</div>
      <div className="wsm-drow-body">{children}</div>
    </div>
  );
}

/** A labelled cell in the detail tabs' auto-fit grids. */
function DetailCell({ label, children }) {
  return (
    <div className="wsm-dcell">
      <div className="wsm-label">{label}</div>
      <div className="wsm-dcell-value">{children}</div>
    </div>
  );
}

/** Dash-prefixed list, or a muted "None recorded". */
function DashList({ items, empty = 'None recorded' }) {
  if (!items || items.length === 0) return <span className="wsm-muted">{empty}</span>;
  return (
    <div className="wsm-dashlist">
      {items.map((t, i) => (
        <div key={i} className="wsm-dashitem"><span aria-hidden="true">–</span><span>{t}</span></div>
      ))}
    </div>
  );
}

/** ISO / CCM control chips; a chip opens to its title underneath. */
function ControlChips({ controls, open, onToggle, empty }) {
  if (!controls || controls.length === 0) return <span className="wsm-muted">{empty}</span>;
  const opened = controls.filter((c) => open[c.id]);
  return (
    <>
      <div className="wsm-chips">
        {controls.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`wsm-ctl${open[c.id] ? ' wsm-ctl-on' : ''}`}
            title={c.title || c.id}
            onClick={() => onToggle(c.id)}
          >
            {c.id.replace(/^CCM /, '')}
          </button>
        ))}
      </div>
      {opened.length > 0 && (
        <div className="wsm-ctl-open-list">
          {opened.map((c) => (
            <div key={c.id} className="wsm-ctl-open">
              <span className="wsm-ctl-open-id">{c.id}</span>
              {c.title && <span className="wsm-ctl-open-title">{c.title}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** The mockup's "Status detail" switch, rendered inside the Status column's filter menu. */
function DetailToggle({ on, onToggle }) {
  return (
    <button
      type="button"
      className={`wsm-detail-toggle${on ? ' wsm-detail-toggle-on' : ''}`}
      onClick={onToggle}
      title={on ? 'Hide the dates and guideline labels — icons only' : 'Show the review date and guideline result beside the icons'}
      aria-pressed={on}
    >
      <span className="wsm-switch" aria-hidden="true"><span className="wsm-switch-knob" /></span>
      Status detail {on ? 'On' : 'Off'}
    </button>
  );
}

/** Column-header filter menu — label, active-value summary, funnel mark, and a 258px panel with
 *  one field per filter, the optional detail switch, and Clear / Apply. */
function FilterMenu({ col, extras, filters, open, onOpen, onClose, onSet, onSetNumeric, onClear, teamOptions, registerOptions, detailToggle }) {
  const cols = [col, ...(extras || [])];
  const anyActive = cols.some((c) => isFilterActive(filters[c.filterKey]));
  const summary = cols.map((c) => filterSummary(c, filters[c.filterKey])).filter(Boolean).join(' · ');

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
          {options.map((opt) => <option key={opt} value={opt}>{c.filterKey === 'register' ? opt.toUpperCase() : opt}</option>)}
        </select>
      );
    }
    if (c.filterType === 'status' || c.filterType === 'recent') {
      const options = c.filterType === 'status' ? STATUS_FILTER_OPTIONS : RECENT_FILTER_OPTIONS;
      return (
        <select value={value || ''} onChange={(e) => onSet(c.filterKey, e.target.value)}>
          {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
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

  const fieldLabel = (c) => (c.filterType === 'status' ? 'Guideline review' : c.label);

  return (
    <div className="wsm-th">
      <button
        type="button"
        className={`wsm-th-btn${open ? ' wsm-th-btn-open' : ''}${anyActive ? ' wsm-th-btn-on' : ''}`}
        onClick={() => (open ? onClose() : onOpen(col.key))}
        aria-expanded={open}
      >
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
                <span className="wsm-filter-label">{fieldLabel(c)}</span>
                {renderInput(c)}
              </label>
            ))}
            {detailToggle}
            <div className="wsm-filter-foot">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => cols.forEach((c) => onClear(c.filterKey))}
                disabled={!anyActive}
              >
                Clear
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>Apply</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── the view ───────────────────────────────────────────────────────────────────────────────── */

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
  const [lastRun, setLastRun] = useState({}); // risk_id -> 'just now' once a rerun finished this session

  // Row selection (table + list modes) — risk_id -> true.
  const [selected, setSelected] = useState({});
  const [reviewingSelected, setReviewingSelected] = useState(false);

  // Guidelines viewer.
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [guidelines, setGuidelines] = useState({ status: 'idle', text: '', error: '' });

  // Column visibility + the Status column's detail switch.
  const [hiddenColumns, setHiddenColumns] = useState(loadHiddenColumns);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [statusDetail, setStatusDetail] = useState(loadStatusDetail);

  // Per-column header filters — value shape depends on filterType (see columnMatches).
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterCol, setOpenFilterCol] = useState(null);

  /** Detail pane: active tab, which guideline rows show their findings, which controls are open,
   *  and the rule whose side panel is out. All reset when another risk is opened. */
  const [detailTab, setDetailTab] = useState('overview');
  const [openCheck, setOpenCheck] = useState(null);
  const [openControls, setOpenControls] = useState({});
  const [openRule, setOpenRule] = useState(null);

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

  useEffect(() => { saveStatusDetail(statusDetail); }, [statusDetail]);

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

  /** Open a risk into split mode. The one live Creator call for the detail pane happens here. */
  const openRisk = (riskId) => {
    setOpenId(riskId);
    setDetailTab('overview');
    setOpenCheck(null);
    setOpenControls({});
    setOpenRule(null);
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

  /** Patch one risk's review result into the loaded page without a reload. */
  const applyReview = (riskId, r) => {
    setState((s) => ({
      ...s,
      risks: s.risks.map((risk) => (
        risk.risk_id === riskId
          ? { ...risk, status: r.status, checks: r.checks, guideline_findings: r.findings }
          : risk
      )),
    }));
    setLastRun((m) => ({ ...m, [riskId]: 'just now' }));
  };

  /** Per-risk rerun of the scripted guideline checks (POST /api/risks/:riskId/review). */
  const rerunGuideline = (event, riskId) => {
    event?.stopPropagation();
    if (rerunning[riskId]) return;
    setRerunning((r) => ({ ...r, [riskId]: true }));
    api(`/risks/${encodeURIComponent(riskId)}/review`, { method: 'POST' })
      .then((r) => applyReview(riskId, r))
      .catch((err) => onNotice?.(err instanceof ApiError ? err.message : 'Guideline rerun failed.'))
      .finally(() => setRerunning((r) => ({ ...r, [riskId]: false })));
  };

  /** The mockup's "Review All" over a selection: the per-risk check, one ticked row at a time. */
  const reviewSelected = async () => {
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (!ids.length || reviewingSelected) return;
    setReviewingSelected(true);
    let failed = 0;
    for (const id of ids) {
      setRerunning((r) => ({ ...r, [id]: true }));
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await api(`/risks/${encodeURIComponent(id)}/review`, { method: 'POST' });
        applyReview(id, r);
      } catch {
        failed += 1;
      } finally {
        setRerunning((r) => ({ ...r, [id]: false }));
      }
    }
    setReviewingSelected(false);
    setSelected({});
    onNotice?.(failed
      ? `Reviewed ${ids.length - failed} of ${ids.length} selected risks — ${failed} failed.`
      : `Reviewed ${ids.length} selected risk${ids.length === 1 ? '' : 's'}.`);
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

  const marksOf = (r) => ({ guide: guidelineStatus(r.checks).icon, recent: recencyMark(r.updated_at) });

  const visibleRisks = useMemo(
    () => state.risks.filter((r) => {
      const marks = marksOf(r);
      return ALL_FILTERS.every((c) => columnMatches(r, marks, c, columnFilters[c.filterKey]));
    }),
    [state.risks, columnFilters]
  );

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const selectedCount = selectedIds.length;
  const allSelected = visibleRisks.length > 0 && visibleRisks.every((r) => selected[r.risk_id]);
  const toggleSelect = (riskId) => setSelected((p) => ({ ...p, [riskId]: !p[riskId] }));
  const toggleAll = () => setSelected((p) => {
    const next = { ...p };
    visibleRisks.forEach((r) => { next[r.risk_id] = !allSelected; });
    return next;
  });

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
        ? `${rangeStart}–${rangeEnd} of ${state.total} shown`
        : 'No risks';

  /* ── top bar ─────────────────────────────────────────────────────────────────────────────── */

  const topBar = (
    <>
      {splitMode && (
        <button type="button" className="btn" onClick={() => setOpenId(null)}>← All risks</button>
      )}

      <input
        type="search"
        className="wsm-search"
        placeholder="Search issue, threat, control, team"
        aria-label="Search risks"
        value={filters.q}
        onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })}
      />

      <div className="wsm-top-right">
        {selectedCount > 0 && (
          <>
            <span className="wsm-selpill">{selectedCount} selected</span>
            <button type="button" className="btn" onClick={reviewSelected} disabled={reviewingSelected || busy}>
              {reviewingSelected ? 'Reviewing…' : 'Review selected'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSelected({})} disabled={reviewingSelected}>
              Clear
            </button>
          </>
        )}

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
                  {COLUMNS.filter((c) => c.key !== 'select').map((c) => (
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

        <button className="btn btn-ghost" onClick={openGuidelines}>View guidelines</button>
        <button className="btn btn-ghost" onClick={reviewGuidelines} disabled={busy}>Review guidelines</button>
        <button className="btn btn-primary" onClick={syncFromCreator} disabled={busy}>Sync from Creator</button>
      </div>
    </>
  );

  /* ── rows ────────────────────────────────────────────────────────────────────────────────── */

  const statusCell = (r, gs, withDetail) => {
    const recent = recencyMark(r.updated_at);
    const recentTitle = recent === 'pass'
      ? `Reviewed within the last 12 months (${r.updated_at})`
      : recent === 'fail'
        ? `Not reviewed in the last 12 months (${r.updated_at})`
        : 'No update date recorded';
    const guideKind = rerunning[r.risk_id] ? 'run' : gs.icon === 'fail' ? 'fail' : gs.icon === 'ok' ? 'pass' : 'idle';
    return (
      <span className="wsm-status-cell">
        <StatusMark
          kind={recent}
          icon={recent === 'pass' ? CALENDAR_OK_ICON : recent === 'fail' ? CALENDAR_FAIL_ICON : IDLE_ICON}
          title={recentTitle}
        />
        {withDetail && <span className="wsm-status-text">{r.updated_at || '—'}</span>}
        <StatusMark
          kind={guideKind}
          icon={guideKind === 'run' ? IDLE_ICON : gs.icon === 'unreviewed' ? IDLE_ICON : gs.icon === 'fail' ? CLIPBOARD_FAIL_ICON : CLIPBOARD_OK_ICON}
          title={rerunning[r.risk_id] ? 'Review in progress' : gs.label}
        />
        {withDetail && (
          <span className={`wsm-status-text${gs.icon === 'fail' ? ' wsm-status-text-fail' : ''}`}>
            {rerunning[r.risk_id] ? 'In progress' : gs.short}
          </span>
        )}
      </span>
    );
  };

  const statusWidth = statusDetail ? '330px' : '128px';
  const tableCols = activeColumns.map((c) => (c.key === 'status' ? statusWidth : c.width)).join(' ');

  const tableView = (
    <div className="pane wsm-table-pane">
      {openFilterCol && <div className="wsm-filter-scrim" onClick={() => setOpenFilterCol(null)} />}
      <div className="wsm-table" style={{ minWidth: '900px' }}>
        <div className="wsm-thead" style={{ gridTemplateColumns: tableCols }}>
          {activeColumns.map((c) => (c.key === 'select' ? (
            <label key="select" className="wsm-th wsm-th-select">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all shown risks" />
            </label>
          ) : (
            <FilterMenu
              key={c.key}
              col={c}
              extras={c.key === 'issue' ? ISSUE_EXTRA_FILTERS : c.key === 'status' ? STATUS_EXTRA_FILTERS : null}
              filters={columnFilters}
              open={openFilterCol === c.key}
              onOpen={setOpenFilterCol}
              onClose={() => setOpenFilterCol(null)}
              onSet={setColumnFilter}
              onSetNumeric={setNumericFilter}
              onClear={clearColumnFilter}
              teamOptions={teamOptions}
              registerOptions={registerOptions}
              detailToggle={c.key === 'status' ? <DetailToggle on={statusDetail} onToggle={() => setStatusDetail((v) => !v)} /> : null}
            />
          )))}
        </div>

        {visibleRisks.map((r, i) => {
          const gs = guidelineStatus(r.checks);
          const cell = {
            select: (
              <label key="select" className="wsm-tcell-select">
                <input
                  type="checkbox"
                  checked={Boolean(selected[r.risk_id])}
                  onChange={() => toggleSelect(r.risk_id)}
                  aria-label={`Select ${r.risk_id}`}
                />
              </label>
            ),
            status: <span key="status">{statusCell(r, gs, statusDetail)}</span>,
            riskid: <span key="riskid" className="wsm-riskid" title={r.risk_id || ''}>{r.risk_id || '—'}</span>,
            issue: (
              <button key="issue" type="button" className="wsm-issue" onClick={() => openRisk(r.risk_id)} title={r.issue || r.title}>
                {r.issue || r.title || '—'}
              </button>
            ),
            register: (
              <span key="register" className="wsm-registry" title={`Risk type · ${(r.register || '').toUpperCase()}`}>
                {(r.register || '—').toUpperCase()}
              </span>
            ),
            score: (
              <span key="score">
                <ScoreBadge
                  score={r.inherent_score}
                  band={bandOf(r.severity)}
                  label={r.inherent_rating || r.severity}
                  title={`Risk score · ${r.inherent_rating || r.severity || 'unrated'}`}
                />
              </span>
            ),
            team: <span key="team" className="wsm-team" title={r.team_name || ''}>{r.team_name || '—'}</span>,
          };
          return (
            <div
              key={r.risk_id}
              data-row="1"
              className={`wsm-trow${selected[r.risk_id] ? ' wsm-trow-selected' : ''}`}
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

  /* ── split mode: list ────────────────────────────────────────────────────────────────────── */

  const listView = (
    <div className="pane wsm-list-pane">
      {visibleRisks.map((r, i) => {
        const gs = guidelineStatus(r.checks);
        const on = openId === r.risk_id;
        return (
          <div
            key={r.risk_id}
            data-row="1"
            className={`wsm-lrow${on ? ' wsm-lrow-on' : ''}`}
            style={{ animation: `wsm-row-a 300ms var(--ease) ${Math.min(i * 28, 340)}ms both` }}
          >
            <label className="wsm-lrow-select">
              <input
                type="checkbox"
                checked={Boolean(selected[r.risk_id])}
                onChange={() => toggleSelect(r.risk_id)}
                aria-label={`Select ${r.risk_id}`}
              />
            </label>
            <button type="button" className="wsm-lrow-btn" onClick={() => openRisk(r.risk_id)} aria-current={on ? 'true' : undefined}>
              <span className="wsm-lrow-title">{r.issue || r.title}</span>
              <span className="wsm-lrow-sub">{r.team_name || '—'}</span>
              <span className="wsm-lrow-chips">
                <span className="tag">{(r.register || '—').toUpperCase()}</span>
                {statusCell(r, gs, false)}
                <ScoreBadge
                  score={r.inherent_score}
                  band={bandOf(r.severity)}
                  label={r.inherent_rating || r.severity}
                  title={`Risk score · ${r.inherent_rating || r.severity || 'unrated'}`}
                />
              </span>
            </button>
          </div>
        );
      })}
      {visibleRisks.length === 0 && <p className="wsm-empty">No risks match this search or filter.</p>}
    </div>
  );

  /* ── split mode: detail pane ─────────────────────────────────────────────────────────────── */

  const detailView = (() => {
    if (!active) return null;
    const r = active;
    const gs = guidelineStatus(r.checks);
    const byRule = findingsByRule(r.guideline_findings);
    const checks = sortChecks(r.checks);
    const pv = preview[r.risk_id];
    const live = (pv && pv.status === 'ok' && pv.data) || {};
    const liveLoading = !pv || pv.status === 'loading';
    const liveFailed = pv && pv.status === 'error';
    /** A live value: "…" while the Creator call is in flight, "—" if it failed or is empty. */
    const lv = (value) => (liveLoading ? '…' : (value === null || value === undefined || value === '' ? '—' : value));

    const inherentBand = bandOf(r.severity);
    const revisedBand = bandOf(RATING_TO_SEVERITY[r.revised_rating]);
    const impactBefore = live.impact ?? r.impact ?? null;
    const likelihoodBefore = live.likelihood ?? r.likelihood ?? null;
    const controlsCount = (live.iso_controls?.length || 0) + (live.ccm_controls?.length || 0);
    const running = Boolean(rerunning[r.risk_id]);
    const reviewStamp = running ? '' : `Last run ${lastRun[r.risk_id] || (gs.total ? (r.updated_at || 'unknown') : 'never')}`;

    const toggleControl = (id) => setOpenControls((p) => ({ ...p, [id]: !p[id] }));

    const scoreRows = [];
    if (live.cia && live.revised_cia) {
      ['Confidentiality', 'Integrity', 'Availability'].forEach((n, i) => {
        scoreRows.push({ label: `Impact on ${n}`, before: live.cia[i], after: live.revised_cia[i], strong: false });
      });
      scoreRows.push({ label: 'Total impact (max of C, I, A)', before: impactBefore, after: live.revised_impact, strong: true });
    } else {
      scoreRows.push({ label: 'Impact', before: impactBefore, after: live.revised_impact, strong: true });
    }
    scoreRows.push({ label: 'Likelihood', before: likelihoodBefore, after: live.revised_likelihood, strong: false });
    scoreRows.push({ label: 'Risk score', before: r.inherent_score, after: r.revised_score, strong: true });

    const tabNote = {
      overview: '',
      treatment: liveLoading ? '' : (controlsCount ? String(controlsCount) : ''),
      context: '',
      review: gs.total === 0 ? '' : gs.failed ? `${gs.failed} failed` : '✓',
    };

    const ruleFindings = openRule ? (byRule[openRule] || []) : [];
    const ruleResult = openRule ? (r.checks || []).find(([code]) => code === openRule) : null;
    const rulePass = ruleResult ? ruleResult[1] === 'pass' : false;

    return (
      <>
        <div className="pane wsm-detail" key={r.risk_id}>
          <div className="wsm-detail-head">
            <div className="wsm-eyebrow">
              <span className="wsm-riskid">{r.risk_id || '—'}</span> · {(r.register || '').toUpperCase()} · {r.team_name || '—'}
            </div>
            <h2 className="wsm-headline">{r.issue || r.title}</h2>
          </div>

          <div className="wsm-kpis">
            <Kpi label="Inherent risk">
              <span className="wsm-kpi-score">
                <span className={`wsm-kpi-num wsm-kpi-num-${inherentBand}`}>{r.inherent_score || '—'}</span>
                <BandPill band={inherentBand} label={r.inherent_rating || r.severity} />
              </span>
            </Kpi>
            <Kpi label="After control">
              <span className="wsm-kpi-score">
                <span className={`wsm-kpi-num wsm-kpi-num-${revisedBand}`}>{r.revised_score || '—'}</span>
                <BandPill band={revisedBand} label={r.revised_rating} />
              </span>
            </Kpi>
            <Kpi label={live.cia ? 'Impact · max C, I, A' : 'Impact'}>
              {liveLoading ? '…' : <BeforeAfter before={impactBefore} after={live.revised_impact} />}
            </Kpi>
            <Kpi label="Likelihood">
              {liveLoading ? '…' : <BeforeAfter before={likelihoodBefore} after={live.revised_likelihood} />}
            </Kpi>
            <Kpi label="Treatment">{r.risk_treatment || '—'}</Kpi>
            <Kpi label="Risk owner"><span className="wsm-kpi-owner" title={live.owner || ''}>{lv(live.owner)}</span></Kpi>
          </div>

          <div className="wsm-dtabs" role="tablist" aria-label="Risk detail sections">
            {DETAIL_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={detailTab === t.key}
                className={`wsm-dtab${detailTab === t.key ? ' wsm-dtab-on' : ''}`}
                onClick={() => setDetailTab(t.key)}
              >
                {t.label}
                {tabNote[t.key] && (
                  <span className={`wsm-dtab-note${t.key === 'review' && gs.failed ? ' wsm-dtab-note-fail' : ''}`}>{tabNote[t.key]}</span>
                )}
              </button>
            ))}
          </div>

          <div className="wsm-dbody">
            {liveFailed && (
              <div className="banner banner-err wsm-dbanner" role="status">
                Live detail unavailable — {pv.error}
              </div>
            )}

            {detailTab === 'overview' && (
              <>
                <div className="wsm-dgrid">
                  <DetailCell label="Source of identification">{lv(live.source)}</DetailCell>
                  <DetailCell label="External / internal">{lv(live.issue_type)}</DetailCell>
                  <DetailCell label="Risk type">{(r.register || '—').toUpperCase()}</DetailCell>
                </div>
                {r.issue && r.title && r.issue !== r.title && (
                  <DetailRow label="Issue"><p>{r.issue}</p></DetailRow>
                )}
                <DetailRow label="Risk"><p>{r.title || '—'}</p></DetailRow>
                <DetailRow label="Vulnerability"><p>{r.vulnerability || '—'}</p></DetailRow>
                <DetailRow label="Threat"><p>{r.threat || '—'}</p></DetailRow>
                {live.remarks && <DetailRow label="Remarks"><p>{live.remarks}</p></DetailRow>}
              </>
            )}

            {detailTab === 'treatment' && (
              <>
                <DetailRow label="Description of the control"><p>{r.control || 'No control recorded.'}</p></DetailRow>

                <div className="wsm-dsection">
                  <div className="wsm-label">Scoring · before and after treatment</div>
                  <div className="wsm-scoretable">
                    <div className="wsm-scoretable-head">
                      <span>Measure</span><span>Before</span><span>After</span>
                    </div>
                    {scoreRows.map((row) => {
                      const dropped = row.before != null && row.after != null && Number(row.after) < Number(row.before);
                      return (
                        <div key={row.label} className={`wsm-scoretable-row${row.strong ? ' wsm-scoretable-row-strong' : ''}`}>
                          <span>{row.label}</span>
                          <span>{row.before ?? (liveLoading ? '…' : '—')}</span>
                          <span className={`wsm-scoretable-after${dropped || row.strong ? ' wsm-scoretable-after-down' : ''}`}>
                            {row.after ?? (liveLoading ? '…' : '—')}
                          </span>
                        </div>
                      );
                    })}
                    <div className="wsm-scoretable-row wsm-scoretable-rating">
                      <span>Risk rating</span>
                      <span><BandPill band={inherentBand} label={r.inherent_rating || r.severity || '—'} /></span>
                      <span><BandPill band={revisedBand} label={r.revised_rating || '—'} /></span>
                    </div>
                  </div>
                </div>

                <div className="wsm-dgrid wsm-dgrid-wide">
                  <div className="wsm-dcell">
                    <div className="wsm-label">ISO controls</div>
                    <div className="wsm-dcell-value">
                      {liveLoading ? '…' : (
                        <ControlChips controls={live.iso_controls} open={openControls} onToggle={toggleControl} empty="None applied" />
                      )}
                    </div>
                  </div>
                  <div className="wsm-dcell">
                    <div className="wsm-label">CCM controls</div>
                    <div className="wsm-dcell-value">
                      {liveLoading ? '…' : (
                        <ControlChips controls={live.ccm_controls} open={openControls} onToggle={toggleControl} empty="None applied" />
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {detailTab === 'context' && (
              <>
                <div className="wsm-dgrid">
                  <DetailCell label="Asset identification no.">
                    {liveLoading ? '…' : <DashList items={live.asset} empty="—" />}
                  </DetailCell>
                  <DetailCell label="Interested parties">
                    {liveLoading ? '…' : <DashList items={live.parties} empty="—" />}
                  </DetailCell>
                  <DetailCell label="Standards & regulation">{lv(live.standards)}</DetailCell>
                </div>
                <DetailRow label="Need">{liveLoading ? '…' : <DashList items={live.need} />}</DetailRow>
                <DetailRow label="Expectation">{liveLoading ? '…' : <DashList items={live.expectation} />}</DetailRow>
                {r.feature && <DetailRow label="Feature"><p>{r.feature}</p></DetailRow>}
              </>
            )}

            {detailTab === 'review' && (
              <>
                <div className="wsm-dgrid wsm-dgrid-review">
                  <DetailCell label="Risk reviewed">
                    <div className="wsm-stamp">{lv(live.last_reviewed_on)}</div>
                    <div className="wsm-stamp-who" title={live.last_reviewed_by || ''}>{liveLoading ? '' : (live.last_reviewed_by || '—')}</div>
                  </DetailCell>
                  <DetailCell label="Risk approved">
                    <div className={`wsm-stamp${!liveLoading && !live.approved_on ? ' wsm-stamp-pending' : ''}`}>
                      {liveLoading ? '…' : (live.approved_on || 'Pending')}
                    </div>
                    <div className="wsm-stamp-who" title={live.approved_by || ''}>
                      {liveLoading ? '' : (live.approved_by || 'Awaiting approver')}
                    </div>
                  </DetailCell>
                  <DetailCell label="Last synced from Creator"><div className="wsm-stamp">{r.updated_at || '—'}</div></DetailCell>
                </div>

                <div className="wsm-guide-region">
                  <div className="wsm-guide-bar">
                    <span className="wsm-label">Guideline review</span>
                    <span className={`wsm-guide-summary${gs.failed ? ' wsm-guide-summary-fail' : ''}`}>
                      {running
                        ? 'Running'
                        : gs.total === 0
                          ? 'Not reviewed yet'
                          : gs.failed
                            ? `${gs.failed} guideline${gs.failed === 1 ? '' : 's'} failed`
                            : 'All guidelines met'}
                    </span>
                    {reviewStamp && <span className="wsm-guide-stamp">{reviewStamp}</span>}
                    <button
                      type="button"
                      className="btn wsm-rerun"
                      onClick={(e) => rerunGuideline(e, r.risk_id)}
                      disabled={running}
                    >
                      {running ? 'Reviewing…' : 'Re-run review'}
                    </button>
                  </div>

                  {gs.total > 0 && (
                    <div className={`wsm-guide-strip${running ? ' wsm-guide-dim' : ''}`} aria-hidden="true">
                      {checks.map(([code, result]) => (
                        <span
                          key={code}
                          title={`${code} · ${result === 'pass' ? 'met' : 'failed'}`}
                          className={result === 'pass' ? 'wsm-seg' : 'wsm-seg wsm-seg-fail'}
                        />
                      ))}
                    </div>
                  )}

                  {running && (
                    <div className="wsm-progress">
                      <div className="wsm-progress-head">
                        <span className="wsm-progress-dot" aria-hidden="true" />
                        <span className="wsm-progress-title">Review in progress</span>
                      </div>
                      <div className="wsm-progress-track"><div className="wsm-progress-fill" /></div>
                      <div className="wsm-progress-note">
                        Checking the entry against the current guideline set. Results below are from the last completed run.
                      </div>
                    </div>
                  )}

                  {gs.total === 0 && !running && (
                    <p className="wsm-empty wsm-empty-tight">No review has run for this risk yet.</p>
                  )}

                  {checks.length > 0 && (
                    <div className={`wsm-guide-list${running ? ' wsm-guide-dim' : ''}`}>
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
                              aria-expanded={isOpen}
                            >
                              <span className={`wsm-guide-glyph${pass ? '' : ' wsm-guide-glyph-fail'}`} title={pass ? 'Met' : 'Failed'}>
                                {pass ? '✓' : '✕'}
                              </span>
                              <span className="wsm-guide-id">{code}</span>
                              <span className="wsm-guide-title">
                                {findings[0]?.problem || (pass ? 'Check passed' : 'Check failed')}
                              </span>
                              <span className={`wsm-guide-count${pass ? '' : ' wsm-guide-count-fail'}`}>
                                {pass ? 'Pass' : `${findings.length || 1} issue${(findings.length || 1) === 1 ? '' : 's'}`}
                              </span>
                              <span className={`wsm-guide-chev${isOpen ? ' wsm-guide-chev-open' : ''}`} aria-hidden="true">›</span>
                            </button>
                            {isOpen && (
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
                                {pass && findings.length === 0 && (
                                  <p className="wsm-finding-sug">Every check under this rule passed.</p>
                                )}
                                <button type="button" className="wsm-more" onClick={() => setOpenRule(code)}>
                                  Rule details ›
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {openRule && (
          <>
            <div className="wsm-sub-scrim" onClick={() => setOpenRule(null)} />
            <aside className="pane wsm-sub" aria-label={`Rule ${openRule}`}>
              <div className="wsm-sub-head">
                <div className="wsm-sub-title-row">
                  <span className={`wsm-sub-glyph${rulePass ? '' : ' wsm-sub-glyph-fail'}`} aria-hidden="true">{rulePass ? '✓' : '✕'}</span>
                  <span className="wsm-sub-id">{openRule}</span>
                  <span className={`wsm-sub-state${rulePass ? '' : ' wsm-sub-state-fail'}`}>{rulePass ? 'Met' : 'Failed'}</span>
                  <button type="button" className="wsm-sub-close" onClick={() => setOpenRule(null)} aria-label="Close rule details">✕</button>
                </div>
                <div className="wsm-sub-title">
                  {ruleFindings[0]?.problem || (rulePass ? 'Every check under this rule passed.' : 'Check failed')}
                </div>
                <div className="wsm-sub-source">Guideline {openRule} · scripted check</div>
              </div>

              <div className="wsm-sub-section">
                <div className="wsm-label">Applied to</div>
                <div className="wsm-sub-text">{r.issue || r.title}</div>
                <div className="wsm-sub-meta">{r.risk_id} · {(r.register || '').toUpperCase()}</div>
              </div>

              <div className="wsm-sub-section">
                <div className="wsm-sub-section-head">
                  <div className="wsm-label">Findings</div>
                  <div className="wsm-sub-count">
                    {ruleFindings.length ? `${ruleFindings.length} open finding${ruleFindings.length === 1 ? '' : 's'}` : 'No open findings'}
                  </div>
                </div>
                <div className="wsm-sub-findings">
                  {ruleFindings.map((f, idx) => (
                    <div key={idx} className={`wsm-sub-finding${rulePass ? '' : ' wsm-sub-finding-fail'}`}>
                      <div className="wsm-sub-finding-text">{f.problem}</div>
                      {f.suggestion && (
                        <div className="wsm-sub-finding-fix"><span>Fix:</span> {f.suggestion}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="wsm-sub-section">
                <div className="wsm-label">Activity</div>
                <div className="wsm-sub-trail">
                  <div className="wsm-sub-trail-row">
                    <span className="wsm-sub-when">{lastRun[r.risk_id] || 'Last review'}</span>
                    <span className="wsm-sub-what">{rulePass ? 'Check passed' : 'Check failed'} on the scripted guideline review</span>
                  </div>
                  <div className="wsm-sub-trail-row">
                    <span className="wsm-sub-when">{r.updated_at || '—'}</span>
                    <span className="wsm-sub-what">Entry last modified in Creator</span>
                  </div>
                </div>
              </div>

              <div className="wsm-sub-section">
                <div className="wsm-label">The rule</div>
                <div className="wsm-sub-text wsm-muted">
                  The full wording of {openRule}, with its origin and whether it is scripted or needs an LLM pass, is in the guideline set.
                </div>
                <button type="button" className="btn wsm-sub-btn" onClick={openGuidelines}>Open the guidelines</button>
              </div>
            </aside>
          </>
        )}
      </>
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
