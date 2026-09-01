import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import GuidelinesView from './GuidelinesView';

/**
 * Risk Register — first slice of compliancemanager (risk_manager) in the Welcome app.
 *
 * The list comes from the `compliance_risks` DataStore table, filled by "Sync from Creator" (a
 * full pull-and-replace from the real Zoho Creator connection — see risk-service.js), scoped to
 * whichever Creator Team_Name values are configured in the "Teams synced" panel below (backed by
 * its own `compliance_team_filters` table — editable here, no redeploy needed to add a team).
 *
 * Issue/Vulnerability/Threat/Risk/Risk score/Control/Risk treatment/Revised risk score are real
 * columns on every row now (populated by syncFromCreator/mapRegisterRecord in risk-service.js —
 * none of them are PII). Expanding a row makes one live call to Creator (GET
 * /api/risks/:riskId/preview) only for "last reviewed by", since that's a reviewer's email and the
 * one field this app's datastore-conventions.md says must never be cached.
 *
 * "Draft new risk" and "Compare vs. DPIAs" moved out to their own Compliance Manager sub-tabs
 * (see DraftRisk.jsx/CompareDpias.jsx and App.jsx's GROUPS) — they currently return a clear 501,
 * see claude/compliancemanager-integration-design.md for what's still open.
 *
 * "Review guidelines" already runs the scripted checks against every risk currently loaded from
 * compliance_risks in one call (risk-service.js's reviewGuidelines) — that's the bulk run; the
 * per-row rerun icon in the Status column reruns just one risk.
 *
 * The old Register/Status/Severity/Team filter row above the table was removed (2026-09-01) — the
 * same filtering now lives in each column header's own filter icon (see COLUMNS below), so there's
 * no longer a separate control duplicating what the table header already offers. Register has no
 * column of its own yet, so it has no header filter either; only `q` (the search icon) and
 * pagination still go to the server — every column filter matches client-side against whatever
 * page of risks is currently loaded, same as before.
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

/** Columns shown in the table. `hideable: false` columns can't be turned off from the Columns
 *  menu (Status + Risk are the ones that make a row identifiable). `filterType` decides which kind
 *  of popover the header's filter icon opens — see the header render and columnMatches() below. */
const COLUMNS = [
  { key: 'status', label: 'Status', hideable: false, filterKey: 'status', filterType: 'status' },
  { key: 'team', label: 'Team', hideable: true, filterKey: 'team', filterType: 'select' },
  { key: 'issue', label: 'Issue', hideable: true, filterKey: 'issue', filterType: 'text' },
  { key: 'vulnerability', label: 'Vulnerability', hideable: true, filterKey: 'vulnerability', filterType: 'text' },
  { key: 'threat', label: 'Threat', hideable: true, filterKey: 'threat', filterType: 'text' },
  { key: 'title', label: 'Risk', hideable: false, filterKey: 'title', filterType: 'text' },
  { key: 'score', label: 'Risk score', hideable: true, filterKey: 'score', filterType: 'numeric' },
  { key: 'control', label: 'Control', hideable: true, filterKey: 'control', filterType: 'text' },
  { key: 'treatment', label: 'Risk treatment', hideable: true, filterKey: 'treatment', filterType: 'select' },
  { key: 'revised', label: 'Revised risk score', hideable: true, filterKey: 'revised', filterType: 'numeric' },
  { key: 'updated', label: 'Updated', hideable: true, filterKey: 'updated', filterType: 'text' },
];
const COLUMNS_STORAGE_KEY = 'wsm.riskRegister.hiddenColumns';
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

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

/** One risk + its already-computed guideline-status icon, against one column's filter value.
 *  Dispatches on `col.filterType`; each type stores a different shape in `columnFilters` (plain
 *  string for text/select/status, `{ op, a, b }` for numeric — see numericMatches above). */
function columnMatches(risk, gsIcon, col, value) {
  if (col.filterType === 'status') {
    return !value || gsIcon === value;
  }
  if (col.filterType === 'numeric') {
    const raw = col.key === 'revised' ? risk.revised_score : risk.inherent_score;
    return numericMatches(raw, value);
  }
  if (col.filterType === 'select') {
    if (!value) return true;
    const field = col.key === 'team' ? risk.team_name : risk.risk_treatment;
    return field === value;
  }
  // text
  if (!value) return true;
  const v = String(value).trim().toLowerCase();
  if (!v) return true;
  const field = {
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
 *  for the filter icon's "active" dot and the toolbar's "N of M" count. */
function isFilterActive(value) {
  if (!value) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'object') return Boolean(value.op);
  return false;
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
    return { icon: 'unreviewed', label: 'Not reviewed yet' };
  }
  const failed = checks.filter(([, result]) => result !== 'pass').length;
  if (failed > 0) {
    return { icon: 'fail', label: `${failed} of ${checks.length} guideline check${checks.length === 1 ? '' : 's'} failed` };
  }
  return { icon: 'ok', label: `Guideline OK — ${checks.length} check${checks.length === 1 ? '' : 's'} passed` };
}

/** A failed rule (e.g. G6) can have more than one finding (risk-review.js's checkRegistryRisk can
 *  push several problems under the same code) — group guideline_findings by rule so the drawer can
 *  show every problem/suggestion behind a failed pill, not just the first one. */
function findingsByRule(findings) {
  const map = {};
  for (const f of findings || []) {
    (map[f.rule] ||= []).push(f);
  }
  return map;
}

/** Inline stroke SVGs — never emoji, per the app's UI design system. */
const STATUS_ICONS = {
  ok: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5 5.5-6" />
    </svg>
  ),
  fail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v6" />
      <path d="M12 16.5h.01" />
    </svg>
  ),
  unreviewed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3">
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
};

const RERUN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);
const FILTER_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5h16l-6 7.5V19l-4 2v-8.5L4 5z" />
  </svg>
);
const SEARCH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);
const COLUMNS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <path d="M15 4v16" />
  </svg>
);
const CHEVRON_LEFT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const CHEVRON_RIGHT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
);
const BOOK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);
// critical/high both read as "severe" (red); medium is amber, low is green — a full traffic-light
// scale. Previously medium and low shared the same muted-gray tag and were indistinguishable.
const SEVERITY_TAG = { critical: 'tag tag-bad', high: 'tag tag-bad', medium: 'tag tag-warn', low: 'tag tag-good' };
// Mirrors risk-service.js's SEVERITY_MAP, so REVISED_RATING (raw Creator text, e.g. "Very High") gets
// the same tag coloring as SEVERITY (already normalized server-side from the same Risk_Rating scale).
const RATING_TO_SEVERITY = { 'Very High': 'critical', High: 'high', Medium: 'medium', Low: 'low', 'Very Low': 'low' };

export default function RiskRegister({ onNotice }) {
  // Only `q` (search) and pagination go to the server now — see the file header comment for why
  // register/status/severity/team lost their old dedicated row.
  const [filters, setFilters] = useState({ q: '', page: 1 });
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [state, setState] = useState({ status: 'loading', risks: [], error: '', total: 0, page: 1, limit: DEFAULT_PAGE_SIZE });
  const [teamOptions, setTeamOptions] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [preview, setPreview] = useState({}); // risk_id -> { status: 'loading'|'ok'|'error', data?, error? }
  const [busy, setBusy] = useState(false);
  const [rerunning, setRerunning] = useState({}); // risk_id -> true while its rerun is in flight

  // Teams synced — the configured Creator Team_Name allow-list (compliance_team_filters table).
  const [teamFilters, setTeamFilters] = useState([]);
  const [newTeam, setNewTeam] = useState('');
  const [teamsBusy, setTeamsBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Guidelines viewer.
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [guidelines, setGuidelines] = useState({ status: 'idle', text: '', error: '' });

  // Column visibility.
  const [hiddenColumns, setHiddenColumns] = useState(loadHiddenColumns);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);

  // Per-column header filters — value shape depends on the column's filterType (see columnMatches).
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterCol, setOpenFilterCol] = useState(null);

  // Search collapsed to an icon on the table header instead of an always-visible field.
  const [searchOpen, setSearchOpen] = useState(false);

  const loadTeamFilters = useCallback(() => {
    api('/team-filters')
      .then((r) => setTeamFilters(r.teams || []))
      .catch((err) => onNotice?.(err instanceof ApiError ? err.message : 'Could not load teams synced.'));
  }, [onNotice]);

  useEffect(() => { loadTeamFilters(); }, [loadTeamFilters]);

  const addTeamFilter = async () => {
    const name = newTeam.trim();
    if (!name) return;
    setTeamsBusy(true);
    try {
      await api('/team-filters', { method: 'POST', body: { team_name: name } });
      setNewTeam('');
      loadTeamFilters();
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Adding the team failed.');
    } finally {
      setTeamsBusy(false);
    }
  };

  const removeTeamFilter = async (teamName) => {
    setTeamsBusy(true);
    try {
      await api(`/team-filters/${encodeURIComponent(teamName)}`, { method: 'DELETE' });
      loadTeamFilters();
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Removing the team failed.');
    } finally {
      setTeamsBusy(false);
    }
  };

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
        // Team dropdown reflects whatever page is currently loaded — same as every other column
        // filter, which only ever sees the current page (see the file header comment).
        const teams = Array.from(new Set(risks.map((x) => x.team_name).filter(Boolean))).sort();
        setTeamOptions(teams);
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

  const toggleRow = (riskId) => {
    const next = openId === riskId ? null : riskId;
    setOpenId(next);
    if (next && !preview[riskId]) {
      setPreview((p) => ({ ...p, [riskId]: { status: 'loading' } }));
      api(`/risks/${encodeURIComponent(riskId)}/preview`)
        .then((r) => setPreview((p) => ({ ...p, [riskId]: { status: 'ok', data: r.preview } })))
        .catch((err) => setPreview((p) => ({
          ...p,
          [riskId]: { status: 'error', error: err instanceof ApiError ? err.message : 'Preview failed.' },
        })));
    }
  };

  /** Status column's per-row rerun icon — reruns just this one risk's scripted guideline checks
   *  (POST /api/risks/:riskId/review) and patches the row in place, without a full-list reload. */
  const rerunGuideline = (event, riskId) => {
    event.stopPropagation(); // don't also toggle the row's expand panel
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

  const visibleRisks = useMemo(
    () => state.risks.filter((r) => {
      const gsIcon = guidelineStatus(r.checks).icon;
      return COLUMNS.every((c) => columnMatches(r, gsIcon, c, columnFilters[c.filterKey]));
    }),
    [state.risks, columnFilters]
  );
  const activeColumns = COLUMNS.filter((c) => !hiddenColumns.has(c.key));
  const hasColumnFilters = Object.values(columnFilters).some(isFilterActive);

  const totalPages = Math.max(1, Math.ceil((state.total || 0) / (state.limit || pageSize)));
  const currentPage = Math.min(state.page || 1, totalPages);
  const rangeStart = state.total === 0 ? 0 : (currentPage - 1) * (state.limit || pageSize) + 1;
  const rangeEnd = Math.min(currentPage * (state.limit || pageSize), state.total);

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Risk Register</h2>
          <p className="view-sub">
            Pulled from the ISMS / PIMS / QMS / BCMS registers, reviewed against the risk guidelines.
          </p>
        </div>
        <div className="view-actions">
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Risk Register settings"
            title="Settings"
          >
            ⚙
          </button>
          <button className="btn btn-ghost" onClick={openGuidelines}>View guidelines</button>
          <button className="btn btn-ghost" onClick={syncFromCreator} disabled={busy}>Sync from Creator</button>
          <button className="btn btn-primary" onClick={reviewGuidelines} disabled={busy}>Review guidelines</button>
        </div>
      </div>

      <section className="card">
        {state.status === 'error' && (
          <div className="banner banner-err" role="status">{state.error}</div>
        )}
        {state.status !== 'error' && (
          <>
            <div className="table-toolbar">
              <div className="pagination-left">
                <span className="table-count">
                  {state.status === 'loading'
                    ? 'Loading…'
                    : hasColumnFilters
                      ? `${visibleRisks.length} of ${state.risks.length} on this page — ${state.total} total`
                      : state.total > 0
                        ? `Showing ${rangeStart}–${rangeEnd} of ${state.total} risk${state.total === 1 ? '' : 's'}`
                        : 'No risks to show'}
                </span>
                <label className="pagination-size">
                  <span>Rows per page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => changePageSize(Number(e.target.value))}
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="icon-btn-sm"
                    onClick={() => setFilters({ ...filters, page: currentPage - 1 })}
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                    title="Previous page"
                  >
                    {CHEVRON_LEFT_ICON}
                  </button>
                  <span className="pagination-page">Page {currentPage} of {totalPages}</span>
                  <button
                    type="button"
                    className="icon-btn-sm"
                    onClick={() => setFilters({ ...filters, page: currentPage + 1 })}
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
                    title="Next page"
                  >
                    {CHEVRON_RIGHT_ICON}
                  </button>
                </div>
              </div>
              <div className="table-toolbar-actions">
                <div className={`table-search${searchOpen ? ' table-search-open' : ''}`}>
                  {searchOpen && (
                    <input
                      type="search"
                      autoFocus
                      placeholder="Risk ID, title…"
                      value={filters.q}
                      onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })}
                      onBlur={() => { if (!filters.q) setSearchOpen(false); }}
                    />
                  )}
                  <button
                    type="button"
                    className="icon-btn-sm"
                    onClick={() => setSearchOpen((v) => !v)}
                    aria-label="Search risks"
                    title="Search"
                  >
                    {SEARCH_ICON}
                  </button>
                </div>
                <div className="col-filter-wrap">
                  <button
                    type="button"
                    className="icon-btn-sm"
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
                        <div className="sec-title" style={{ margin: '0 0 6px' }}>Columns shown</div>
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
              </div>
            </div>

            <div className="table-scroll table-scroll-tall">
              <table className="cred-table risk-table">
                <thead>
                  <tr>
                    {activeColumns.map((c) => (
                      <th key={c.key} title={c.key === 'status' ? 'Guideline review status' : undefined}>
                        <span className="th-label">
                          {c.label}
                          <span className="col-filter-wrap">
                            <button
                              type="button"
                              className={`icon-btn-sm${isFilterActive(columnFilters[c.filterKey]) ? ' icon-btn-active' : ''}`}
                              onClick={() => setOpenFilterCol(openFilterCol === c.key ? null : c.key)}
                              aria-label={`Filter ${c.label}`}
                              title={`Filter ${c.label}`}
                            >
                              {FILTER_ICON}
                            </button>
                            {openFilterCol === c.key && (
                              <>
                                <div className="col-filter-pop-overlay" onClick={() => setOpenFilterCol(null)} />
                                <div className="col-filter-pop">
                                  {c.filterType === 'text' && (
                                    <input
                                      type="text"
                                      autoFocus
                                      placeholder={`Filter ${c.label.toLowerCase()}…`}
                                      value={columnFilters[c.filterKey] || ''}
                                      onChange={(e) => setColumnFilter(c.filterKey, e.target.value)}
                                    />
                                  )}
                                  {c.filterType === 'select' && (
                                    <select
                                      value={columnFilters[c.filterKey] || ''}
                                      onChange={(e) => setColumnFilter(c.filterKey, e.target.value)}
                                    >
                                      <option value="">All</option>
                                      {(c.key === 'team' ? teamOptions : TREATMENT_OPTIONS).map((opt) => (
                                        <option key={opt} value={opt}>{opt}</option>
                                      ))}
                                    </select>
                                  )}
                                  {c.filterType === 'status' && (
                                    <select
                                      value={columnFilters[c.filterKey] || ''}
                                      onChange={(e) => setColumnFilter(c.filterKey, e.target.value)}
                                    >
                                      {STATUS_FILTER_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  )}
                                  {c.filterType === 'numeric' && (() => {
                                    const nf = columnFilters[c.filterKey] || {};
                                    const isRange = nf.op === 'between' || nf.op === 'notBetween';
                                    return (
                                      <>
                                        <select
                                          value={nf.op || ''}
                                          onChange={(e) => setNumericFilter(c.filterKey, { op: e.target.value })}
                                        >
                                          <option value="">Operator…</option>
                                          {NUMERIC_OPERATORS.map((op) => (
                                            <option key={op.value} value={op.value}>{op.label}</option>
                                          ))}
                                        </select>
                                        {nf.op && (
                                          <div className="col-filter-numeric-inputs">
                                            <input
                                              type="number"
                                              placeholder={isRange ? 'Min' : 'Value'}
                                              value={nf.a ?? ''}
                                              onChange={(e) => setNumericFilter(c.filterKey, { a: e.target.value })}
                                            />
                                            {isRange && (
                                              <input
                                                type="number"
                                                placeholder="Max"
                                                value={nf.b ?? ''}
                                                onChange={(e) => setNumericFilter(c.filterKey, { b: e.target.value })}
                                              />
                                            )}
                                          </div>
                                        )}
                                      </>
                                    );
                                  })()}
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-small"
                                    onClick={() => clearColumnFilter(c.filterKey)}
                                    disabled={!isFilterActive(columnFilters[c.filterKey])}
                                  >
                                    Clear
                                  </button>
                                </div>
                              </>
                            )}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRisks.map((r) => {
                    const gs = guidelineStatus(r.checks);
                    const cell = {
                      status: (
                        <td key="status">
                          <span className="status-cell">
                            <span className={`status-icon status-icon-${gs.icon}`} title={gs.label}>
                              {STATUS_ICONS[gs.icon]}
                            </span>
                            <button
                              type="button"
                              className="icon-btn-sm"
                              onClick={(e) => rerunGuideline(e, r.risk_id)}
                              disabled={rerunning[r.risk_id]}
                              title="Rerun guideline review for this risk"
                              aria-label="Rerun guideline review for this risk"
                            >
                              <span className={rerunning[r.risk_id] ? 'spin' : ''}>{RERUN_ICON}</span>
                            </button>
                          </span>
                        </td>
                      ),
                      team: <td key="team" title={r.team_name}><span className="cell-clip-multi">{r.team_name || '—'}</span></td>,
                      issue: <td key="issue" title={r.issue}><span className="cell-clip-multi">{r.issue || '—'}</span></td>,
                      vulnerability: <td key="vulnerability" title={r.vulnerability}><span className="cell-clip-multi">{r.vulnerability || '—'}</span></td>,
                      threat: <td key="threat" title={r.threat}><span className="cell-clip-multi">{r.threat || '—'}</span></td>,
                      title: <td key="title" className="strong" title={r.title}><span className="cell-clip-multi">{r.title}</span></td>,
                      score: (
                        <td key="score" className="ta-right" style={{ whiteSpace: 'normal' }}>
                          <span className={SEVERITY_TAG[r.severity] || 'tag'}>
                            {r.inherent_score || '—'} {r.severity ? `(${r.severity})` : ''}
                          </span>
                        </td>
                      ),
                      control: <td key="control" title={r.control}><span className="cell-clip-multi">{r.control || '—'}</span></td>,
                      treatment: <td key="treatment" title={r.risk_treatment}><span className="cell-clip-multi">{r.risk_treatment || '—'}</span></td>,
                      revised: (
                        <td key="revised" className="ta-right" style={{ whiteSpace: 'normal' }}>
                          <span className={SEVERITY_TAG[RATING_TO_SEVERITY[r.revised_rating]] || 'tag'}>
                            {r.revised_score || '—'} {r.revised_rating ? `(${r.revised_rating})` : ''}
                          </span>
                        </td>
                      ),
                      updated: <td key="updated" className="dim">{r.updated_at}</td>,
                    };
                    return (
                      <tr key={r.risk_id} onClick={() => toggleRow(r.risk_id)} className={openId === r.risk_id ? 'row-on' : ''} style={{ cursor: 'pointer' }}>
                        {activeColumns.map((c) => cell[c.key])}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {state.status === 'ok' && visibleRisks.length === 0 && (
                <p className="empty">No risks match these filters.</p>
              )}
              {state.status === 'loading' && <p className="empty">Loading…</p>}
            </div>
          </>
        )}
      </section>

      {openId && (() => {
        const r = state.risks.find((x) => x.risk_id === openId);
        if (!r) return null;
        const pv = preview[openId];
        const gs = guidelineStatus(r.checks);
        const byRule = findingsByRule(r.guideline_findings);
        return (
          <div className="risk-drawer-backdrop" onClick={() => setOpenId(null)}>
            <aside className="risk-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="risk-drawer-head">
                <div>
                  <h2 className="risk-drawer-title">{r.title}</h2>
                  <p className="hint">{r.risk_id} · {(r.register || '').toUpperCase()}</p>
                </div>
                <button className="modal-close" onClick={() => setOpenId(null)} aria-label="Close" title="Close">×</button>
              </div>

              <dl className="kv">
                <dt>Feature</dt><dd>{r.feature || '—'}</dd>
                <dt>Team</dt><dd>{r.team_name || '—'}</dd>
                <dt>Issue</dt><dd>{r.issue || '—'}</dd>
                <dt>Vulnerability</dt><dd>{r.vulnerability || '—'}</dd>
                <dt>Threat</dt><dd>{r.threat || '—'}</dd>
                <dt>Risk score</dt>
                <dd>
                  <span className={SEVERITY_TAG[r.severity] || 'tag'}>
                    {r.inherent_score || '—'} {r.severity ? `(${r.severity})` : ''}
                  </span>
                </dd>
                <dt>Control</dt><dd>{r.control || '—'}</dd>
                <dt>Risk treatment</dt><dd>{r.risk_treatment || '—'}</dd>
                <dt>Revised risk score</dt>
                <dd>
                  <span className={SEVERITY_TAG[RATING_TO_SEVERITY[r.revised_rating]] || 'tag'}>
                    {r.revised_score || '—'} {r.revised_rating ? `(${r.revised_rating})` : ''}
                  </span>
                </dd>
                <dt>Updated</dt><dd>{r.updated_at || '—'}</dd>
              </dl>

              <div className="sec-title">Last reviewed</div>
              {(!pv || pv.status === 'loading') && <p className="hint">Loading from Creator…</p>}
              {pv?.status === 'error' && <div className="banner banner-err" role="status">{pv.error}</div>}
              {pv?.status === 'ok' && (
                <p className="hint">
                  {pv.data.last_reviewed_on || 'Unknown'}
                  {pv.data.last_reviewed_by ? ` — ${pv.data.last_reviewed_by}` : ''}
                </p>
              )}

              <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Guideline review
                <span className={`status-icon status-icon-${gs.icon}`} title={gs.label}>{STATUS_ICONS[gs.icon]}</span>
                <button
                  type="button"
                  className="icon-btn-sm"
                  onClick={(e) => rerunGuideline(e, r.risk_id)}
                  disabled={rerunning[r.risk_id]}
                  title="Rerun guideline review for this risk"
                  aria-label="Rerun guideline review for this risk"
                >
                  <span className={rerunning[r.risk_id] ? 'spin' : ''}>{RERUN_ICON}</span>
                </button>
              </div>
              {r.checks.length > 0 ? (
                <div className="risk-checks-detail">
                  {r.checks.map(([code, result]) => (
                    <div key={code} className={`risk-check-row ${result === 'pass' ? 'risk-check-pass' : 'risk-check-fail'}`}>
                      <span className={`tag ${result === 'pass' ? 'tag-good' : 'tag-bad'}`}>
                        {code} {result === 'pass' ? '✓' : '✕'}
                      </span>
                      {result !== 'pass' && (byRule[code] || []).map((f, i) => (
                        <div key={i} className="risk-check-finding">
                          <p className="risk-check-problem">{f.problem}</p>
                          {f.suggestion && <p className="hint risk-check-suggestion">Suggestion: {f.suggestion}</p>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="hint">Not reviewed yet — use the rerun icon above.</p>
              )}
            </aside>
          </div>
        );
      })()}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Risk Register settings</h2>
              <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Close" title="Close">×</button>
            </div>

            <div className="sec-title">Teams synced</div>
            <div className="ask-chips">
              {teamFilters.length
                ? teamFilters.map((t) => (
                    <span key={t.team_name} className="tag tag-muted">
                      {t.team_name}
                      <button
                        type="button"
                        onClick={() => removeTeamFilter(t.team_name)}
                        disabled={teamsBusy}
                        aria-label={`Remove ${t.team_name}`}
                        style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                      >
                        ×
                      </button>
                    </span>
                  ))
                : <span className="hint">No teams configured yet — add one below.</span>}
            </div>
            <div className="ask-row" style={{ marginTop: 10 }}>
              <input
                type="text"
                placeholder="Exact Zoho Creator Team_Name…"
                value={newTeam}
                onChange={(e) => setNewTeam(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTeamFilter()}
              />
              <button className="btn btn-ghost" onClick={addTeamFilter} disabled={teamsBusy || !newTeam.trim()}>Add team</button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              Sync from Creator only pulls risks for the teams listed here. Add or remove a team,
              then click Sync from Creator to pick it up — no redeploy needed.
            </p>
          </div>
        </div>
      )}

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
              <div className="guidelines-text"><GuidelinesView text={guidelines.text} /></div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
