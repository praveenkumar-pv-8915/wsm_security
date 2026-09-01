import { useCallback, useEffect, useState } from 'react';
import { getTheme, setTheme, toggleTheme } from './lib/theme';
import './App.css';
import AuthGate from './components/AuthGate';
import { api } from './lib/api';
import { signOut } from './lib/catalyst';
import { navigate, useRoute } from './lib/router';
import Connections from './views/Connections';
import RiskRegister from './views/RiskRegister';
import DraftRisk from './views/DraftRisk';
import CompareDpias from './views/CompareDpias';
import Ask from './views/Ask';

/**
 * App shell — header, navigation and the route switch. Everything below AuthGate can assume a
 * verified @zohocorp.com session; the server re-verifies it on every request regardless.
 */

/**
 * Two-tier nav: a top row of module tabs, each opening a left sidebar of the sections that
 * belong to it. Routing is unchanged (still the same flat hash paths in lib/router.js) — this is
 * purely a grouping/presentation layer over the existing routes.
 */
const GROUPS = [
  {
    key: 'compliance',
    label: 'Compliance Manager',
    items: [
      { path: '/risk-register', label: 'Risk Register' },
      { path: '/draft-risk', label: 'Draft new risk' },
      { path: '/compare-dpias', label: 'Compare vs. DPIA' },
      { path: '/ask', label: 'Ask' },
    ],
  },
  {
    key: 'workspace',
    label: 'Configuration',
    items: [
      { path: '/connections', label: 'Connections' },
    ],
  },
];

function Shell({ user: sessionUser }) {
  const { path } = useRoute();
  const [notice, setNotice] = useState(null);
  const [serverRole, setServerRole] = useState(null);
  const [theme, setThemeState] = useState(getTheme);

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

  const activeGroup = GROUPS.find((g) => g.items.some((item) => item.path === path)) || GROUPS[0];

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  return (
    <div className="vault">
      <header className="vault-header">
        <button type="button" className="vault-brand" onClick={() => navigate('/connections')} title="Connections">
          <span className="vault-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />
              <path d="M9.5 12.5l1.8 1.8 3.2-3.6" />
            </svg>
          </span>
          <div>
            <h1>WSM Security</h1>
            <p className="vault-sub">Team workspace · Catalyst Serverless</p>
          </div>
        </button>

        <div className="vault-actions">
          <span className="who" title={user.email}>
            <span className="who-initials" aria-hidden="true">{user.initials}</span>
            <span className="who-name">{user.name}</span>
          </span>
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            onClick={() => setThemeState((t) => toggleTheme(t))}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            aria-label="Toggle color theme"
          >
            {theme === 'light' ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            onClick={() => signOut()}
            title="Sign out"
            aria-label="Sign out"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      <nav className="module-tabs" aria-label="Modules">
        {GROUPS.map((group) => (
          <button
            key={group.key}
            type="button"
            className={`module-tab${activeGroup.key === group.key ? ' module-tab-on' : ''}`}
            aria-current={activeGroup.key === group.key ? 'true' : undefined}
            onClick={() => navigate(group.items[0].path)}
          >
            {group.label}
          </button>
        ))}
      </nav>

      <div className="workspace">
        <aside className="sidebar" aria-label={`${activeGroup.label} sections`}>
          {activeGroup.items.map((item) => (
            <button
              key={item.path}
              type="button"
              className={`sidebar-item${path === item.path ? ' sidebar-item-on' : ''}`}
              aria-current={path === item.path ? 'page' : undefined}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </aside>

        <main className="pane">
          {notice && <div className="banner banner-ok" role="status">{notice}</div>}

          {path === '/connections' && <Connections user={user} onNotice={onNotice} />}
          {path === '/risk-register' && <RiskRegister onNotice={onNotice} />}
          {path === '/draft-risk' && <DraftRisk />}
          {path === '/compare-dpias' && <CompareDpias />}
          {path === '/ask' && <Ask />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return <AuthGate>{(user) => <Shell user={user} />}</AuthGate>;
}
