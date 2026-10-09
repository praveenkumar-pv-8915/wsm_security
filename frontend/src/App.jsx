import { useCallback, useEffect, useState } from 'react';
import { getTheme, setTheme, toggleTheme } from './lib/theme';
import './App.css';
import AuthGate from './components/AuthGate';
import { api } from './lib/api';
import { signOut } from './lib/catalyst';
import { navigate, useRoute } from './lib/router';
import Connections from './views/Connections';
import ComplianceConfig from './views/ComplianceConfig';
import RiskRegister from './views/RiskRegister';
import DmsDocuments from './views/DmsDocuments';
import DraftRisk from './views/DraftRisk';
import CompareDpias from './views/CompareDpias';
import Ask from './views/Ask';
import DependencyNotifier from './views/DependencyNotifier';

/**
 * App shell — rail, top bar and the route switch. Everything below AuthGate can assume a
 * verified @zohocorp.com session; the server re-verifies it on every request regardless.
 *
 * Layout follows the "WSM Security v5" mockup (design/WSM Security v5.dc.html — see the Design
 * section of README.md): a collapsible rail (236px open, 46px closed) holding the brand block,
 * the grouped nav and the user footer, beside a main column of top bar + content. The rail's
 * Hide/Show sidebar toggle sits at its foot; the closed state keeps only that toggle.
 *
 * Settings is one screen with two tabs (Connections, Compliance) rendered at the top of the
 * content pane, as in the mockup — not a tab row in the top bar.
 *
 * Routing is untouched: still the same flat hash paths in lib/router.js. The rail only lists the
 * sections this app actually has; the mockup's Repository and Hacksaw groups are not built yet.
 */

/** Rail groups. Settings routes live in the footer, not here — see SETTINGS_TABS. */
const GROUPS = [
  {
    key: 'compliance',
    label: 'Compliance Manager',
    items: [
      { path: '/risk-register', label: 'Risk Register' },
      { path: '/dms-documents', label: 'DMS Manager' },
      { path: '/draft-risk', label: 'Draft new risk' },
      { path: '/compare-dpias', label: 'Compare vs. DPIA' },
      { path: '/ask', label: 'Ask' },
    ],
  },
  {
    key: 'vm',
    label: 'VM Manager',
    items: [
      { path: '/dependency-upgrade-notifier', label: 'Dependency Upgrade notifier' },
    ],
  },
];

const SETTINGS_TABS = [
  { path: '/connections', label: 'Connections' },
  { path: '/compliance-config', label: 'Compliance' },
];

const SETTINGS_PATHS = SETTINGS_TABS.map((t) => t.path);

/**
 * Routes that lay out their own panes (full-bleed tables, their own scroll) and so take the
 * content area unpadded and unscrolled. The mockup draws Risk Register, DMS Manager and Settings
 * edge to edge; the remaining views keep the padded, scrolling content pane.
 */
const FLUSH_ROUTES = ['/risk-register', '/dms-documents', ...SETTINGS_PATHS];

/** Breadcrumbs, in the mockup's `Module · Section` form. */
const CRUMBS = {
  '/risk-register': 'Compliance Manager · Risk Register',
  '/dms-documents': 'Compliance Manager · DMS Manager',
  '/draft-risk': 'Compliance Manager · Draft new risk',
  '/compare-dpias': 'Compliance Manager · Compare vs. DPIA',
  '/ask': 'Compliance Manager · Ask',
  '/dependency-upgrade-notifier': 'VM Manager · Dependency Upgrade notifier',
  '/connections': 'Settings',
  '/compliance-config': 'Settings',
};

const RAIL_STORAGE_KEY = 'wsm-security-rail';

function loadRailHidden() {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === 'hidden';
  } catch {
    return false;
  }
}

function saveRailHidden(hidden) {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, hidden ? 'hidden' : 'open');
  } catch {
    /* best-effort persistence only */
  }
}

/**
 * Scrollbars stay invisible until a pane is actually being scrolled.
 *
 * One capture-phase listener on the document rather than a handler per pane: panes mount and
 * unmount with the route, and the detail/table panes are nested, so delegation keeps this to a
 * single subscription. The class is removed 700ms after the last scroll event; timers are held
 * in a WeakMap so an unmounted pane's entry is collectable.
 */
function useScrollPanes() {
  useEffect(() => {
    const timers = new WeakMap();
    const onScroll = (event) => {
      const el = event.target;
      if (!el || !el.classList || !el.classList.contains('pane')) return;
      el.classList.add('wsm-scrolling');
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(() => el.classList.remove('wsm-scrolling'), 700));
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);
}

/**
 * Section counts for the rail. Views own their own totals, so each announces one with a
 * `wsm:section-count` event rather than the shell issuing a second request to count what a view
 * has already fetched. Sections that have no count source simply render none, as in the mockup.
 */
function useSectionCounts() {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    const onCount = (event) => {
      const { path: p, count } = event.detail || {};
      if (!p || typeof count !== 'number') return;
      setCounts((prev) => (prev[p] === count ? prev : { ...prev, [p]: count }));
    };
    window.addEventListener('wsm:section-count', onCount);
    return () => window.removeEventListener('wsm:section-count', onCount);
  }, []);
  return counts;
}

/** "Services 8/12" in the top bar while on Settings — announced by the Connections view. */
function useServicesCount() {
  const [services, setServices] = useState(null);
  useEffect(() => {
    const onCount = (event) => {
      const { on, total } = event.detail || {};
      if (typeof on !== 'number' || typeof total !== 'number') return;
      setServices({ on, total });
    };
    window.addEventListener('wsm:services-count', onCount);
    return () => window.removeEventListener('wsm:services-count', onCount);
  }, []);
  return services;
}

const SIDEBAR_HIDE_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
    <path d="M9 4.5v15" />
    <path d="M15.5 10l-2 2 2 2" />
  </svg>
);
const SIDEBAR_SHOW_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
    <path d="M9 4.5v15" />
    <path d="M13.5 10l2 2-2 2" />
  </svg>
);

function Shell({ user: sessionUser }) {
  const { path } = useRoute();
  const counts = useSectionCounts();
  const services = useServicesCount();
  const [notice, setNotice] = useState(null);
  const [serverRole, setServerRole] = useState(null);
  const [theme, setThemeState] = useState(getTheme);
  const [railHidden, setRailHidden] = useState(loadRailHidden);

  useScrollPanes();

  useEffect(() => { setTheme(theme); }, [theme]);
  useEffect(() => { saveRailHidden(railHidden); }, [railHidden]);

  const onNotice = useCallback((message) => setNotice(message), []);

  /**
   * Take `role` from the server, not from the browser SDK.
   *
   * AuthGate derives a role from whatever `catalyst.userManagement.getCurrentUser()` returns, but
   * the web SDK does not reliably include `role_details` — when it doesn't, everyone reads as
   * 'member' and admin-only controls silently vanish for actual admins. GET /api/me returns the
   * role the Node SDK resolved server-side, which is the same value requireAdmin enforces on.
   *
   * Non-blocking on purpose: if /api/me is slow or fails, the app still renders with the
   * conservative client-side guess rather than hanging behind a spinner.
   */
  useEffect(() => {
    let cancelled = false;
    api('/me')
      .then((me) => { if (!cancelled && me.role) setServerRole(me.role); })
      .catch(() => { /* keep the client-side guess; the server still enforces */ });
    return () => { cancelled = true; };
  }, []);

  const user = serverRole ? { ...sessionUser, role: serverRole } : sessionUser;

  const inSettings = SETTINGS_PATHS.includes(path);
  const flush = FLUSH_ROUTES.includes(path);

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  const railTitle = railHidden ? 'Show sidebar' : 'Hide sidebar';

  return (
    <div className={`wsm-shell${railHidden ? ' wsm-shell-rail-hidden' : ''}`}>
      <aside className="wsm-rail pane" aria-label="Sections">
        {!railHidden && (
          <>
            <button
              type="button"
              className="wsm-brand"
              onClick={() => navigate('/risk-register')}
              title="Risk Register"
            >
              <span className="wsm-monogram" aria-hidden="true">WS</span>
              <span className="wsm-brand-text">
                <h1 className="wsm-wordmark">WSM Security</h1>
                <p className="wsm-brand-sub">Team workspace</p>
              </span>
            </button>

            <nav className="wsm-nav">
              {GROUPS.map((group) => (
                <div className="wsm-group" key={group.key}>
                  <div className="wsm-group-label">{group.label}</div>
                  {group.items.map((item) => {
                    const on = path === item.path;
                    return (
                      <button
                        key={item.path}
                        type="button"
                        className={`wsm-nav-item${on ? ' wsm-nav-item-on' : ''}`}
                        aria-current={on ? 'page' : undefined}
                        onClick={() => navigate(item.path)}
                      >
                        <span className="wsm-nav-mark" aria-hidden="true" />
                        <span className="wsm-nav-label">{item.label}</span>
                        {typeof counts[item.path] === 'number' && (
                          <span className="wsm-nav-count">{counts[item.path]}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <div className="wsm-rail-foot">
              <span className="wsm-who" title={user.email}>
                <span className="wsm-avatar" aria-hidden="true">{user.initials}</span>
                <span className="wsm-who-name">{user.name}</span>
              </span>
              <div className="wsm-rail-actions">
                <button
                  type="button"
                  className={`wsm-rail-btn${inSettings ? ' wsm-rail-btn-on' : ''}`}
                  onClick={() => navigate('/connections')}
                  aria-current={inSettings ? 'page' : undefined}
                >
                  Settings
                </button>
                <button type="button" className="wsm-rail-btn" onClick={() => signOut()}>
                  Sign out
                </button>
              </div>
            </div>
          </>
        )}

        <button
          type="button"
          className={`wsm-rail-toggle${railHidden ? ' wsm-rail-toggle-closed' : ''}`}
          onClick={() => setRailHidden((h) => !h)}
          title={railTitle}
          aria-label={railTitle}
          aria-expanded={!railHidden}
        >
          {railHidden ? SIDEBAR_SHOW_ICON : SIDEBAR_HIDE_ICON}
          {!railHidden && <span className="wsm-rail-toggle-label">Hide sidebar</span>}
        </button>
      </aside>

      <main className="wsm-main">
        <div className="wsm-top">
          <span className="wsm-crumb">{CRUMBS[path] || 'WSM Security'}</span>

          {/* Views fill this slot with their own search, counter and actions, so the mockup's
              single top bar stays one row instead of each view growing a toolbar of its own.
              RiskRegister portals into it by id — see the `slot` effect there. */}
          <div id="wsm-top-slot" className="wsm-top-slot" />

          <div className="wsm-top-actions">
            {inSettings && services && (
              <span className="wsm-count">Services {services.on}/{services.total}</span>
            )}
            <button
              className="btn btn-ghost btn-icon"
              type="button"
              onClick={() => setThemeState((t) => toggleTheme(t))}
              title={theme === 'light' ? 'Switch to dark ground' : 'Switch to light ground'}
              aria-label="Toggle color theme"
            >
              {theme === 'light' ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Notices float over the content so a full-bleed view's grid never has to make room. */}
        {notice && <div className="wsm-toast banner banner-ok" role="status">{notice}</div>}

        <div className={`wsm-content${flush ? ' wsm-content-flush' : ' pane'}`}>
          {inSettings ? (
            <div className="pane wsm-settings">
              <div className="wsm-settings-tabs" role="tablist" aria-label="Settings sections">
                {SETTINGS_TABS.map((tab) => (
                  <button
                    key={tab.path}
                    type="button"
                    role="tab"
                    aria-selected={path === tab.path}
                    className={`wsm-tab${path === tab.path ? ' wsm-tab-on' : ''}`}
                    onClick={() => navigate(tab.path)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {path === '/connections' && <Connections user={user} onNotice={onNotice} />}
              {path === '/compliance-config' && <ComplianceConfig onNotice={onNotice} />}
            </div>
          ) : (
            <>
              {path === '/risk-register' && <RiskRegister onNotice={onNotice} />}
              {path === '/dms-documents' && <DmsDocuments />}
              {path === '/draft-risk' && <DraftRisk />}
              {path === '/compare-dpias' && <CompareDpias />}
              {path === '/ask' && <Ask />}
              {path === '/dependency-upgrade-notifier' && <DependencyNotifier onNotice={onNotice} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return <AuthGate>{(user) => <Shell user={user} />}</AuthGate>;
}
