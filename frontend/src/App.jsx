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
 * Layout follows the "WSM Security v3" mockup (claude/wsm-security-v3-mockup.html): a fixed
 * 236px rail holding the brand block, the grouped nav and the user footer, beside a main
 * column of top bar + scroll pane. The previous two-tier layout (module tab row above a
 * sidebar of that module's sections) is gone — every group is visible in the rail at once,
 * so switching module and section is one click instead of two.
 *
 * Routing is untouched: still the same flat hash paths in lib/router.js.
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

/** Routes that lay out their own panes and so take the content area unpadded and unscrolled. */
const FLUSH_ROUTES = ['/risk-register'];

/** Breadcrumbs, in the mockup's `Module · Section` form. */
const CRUMBS = {
  '/risk-register': 'Compliance Manager · Risk Register',
  '/dms-documents': 'Compliance Manager · DMS Manager',
  '/draft-risk': 'Compliance Manager · Draft new risk',
  '/compare-dpias': 'Compliance Manager · Compare vs. DPIA',
  '/ask': 'Compliance Manager · Ask',
  '/dependency-upgrade-notifier': 'VM Manager · Dependency Upgrade notifier',
  '/connections': 'Settings · Connections',
  '/compliance-config': 'Settings · Compliance',
};

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

function Shell({ user: sessionUser }) {
  const { path } = useRoute();
  const counts = useSectionCounts();
  const [notice, setNotice] = useState(null);
  const [serverRole, setServerRole] = useState(null);
  const [theme, setThemeState] = useState(getTheme);

  useScrollPanes();

  useEffect(() => { setTheme(theme); }, [theme]);

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

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  return (
    <div className="wsm-shell">
      <aside className="wsm-rail pane" aria-label="Sections">
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
      </aside>

      <main className="wsm-main">
        <div className="wsm-top">
          <span className="wsm-crumb">{CRUMBS[path] || 'WSM Security'}</span>

          {inSettings && (
            <div className="wsm-tabs" role="tablist" aria-label="Settings sections">
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
          )}

          {/* Views fill this slot with their own search, counter and actions, so the mockup's
              single top bar stays one row instead of each view growing a toolbar of its own.
              RiskRegister portals into it by id — see the `slot` effect there. */}
          <div id="wsm-top-slot" className="wsm-top-slot" />

          <div className="wsm-top-actions">
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

        {/* Risk Register manages its own full-height panes (list + detail), so it opts out of
            the content pane's padding and scrolling. */}
        <div className={`wsm-content${FLUSH_ROUTES.includes(path) ? ' wsm-content-flush' : ' pane'}`}>
          {notice && <div className="banner banner-ok" role="status">{notice}</div>}

          {path === '/connections' && <Connections user={user} onNotice={onNotice} />}
          {path === '/compliance-config' && <ComplianceConfig onNotice={onNotice} />}
          {path === '/risk-register' && <RiskRegister onNotice={onNotice} />}
          {path === '/dms-documents' && <DmsDocuments />}
          {path === '/draft-risk' && <DraftRisk />}
          {path === '/compare-dpias' && <CompareDpias />}
          {path === '/ask' && <Ask />}
          {path === '/dependency-upgrade-notifier' && <DependencyNotifier onNotice={onNotice} />}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return <AuthGate>{(user) => <Shell user={user} />}</AuthGate>;
}
