import { useCallback, useEffect, useState } from 'react';
import './App.css';
import AuthGate from './components/AuthGate';
import { api } from './lib/api';
import { signOut } from './lib/catalyst';
import { navigate, useRoute } from './lib/router';
import Home from './views/Home';
import Connections from './views/Connections';

/**
 * App shell — header, navigation and the route switch. Everything below AuthGate can assume a
 * verified @zohocorp.com session; the server re-verifies it on every request regardless.
 */

const NAV = [
  { path: '/', label: 'Home' },
  { path: '/connections', label: 'Connections' },
];

function Shell({ user: sessionUser }) {
  const { path } = useRoute();
  const [notice, setNotice] = useState(null);
  const [serverRole, setServerRole] = useState(null);

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

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  return (
    <div className="vault">
      <header className="vault-header">
        <button type="button" className="vault-brand" onClick={() => navigate('/')} title="Home">
          <span className="vault-glyph" aria-hidden="true">▣</span>
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
          <button className="btn btn-ghost" type="button" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        {NAV.map((item) => (
          <button
            key={item.path}
            type="button"
            className={`tab${path === item.path ? ' tab-on' : ''}`}
            aria-current={path === item.path ? 'page' : undefined}
            onClick={() => navigate(item.path)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {notice && <div className="banner banner-ok" role="status">{notice}</div>}

      {path === '/connections' && <Connections user={user} onNotice={onNotice} />}
      {path === '/' && <Home user={user} />}

      <footer className="vault-foot">
        <span>AES-encrypted at rest · owner-scoped access · Catalyst Serverless</span>
      </footer>
    </div>
  );
}

export default function App() {
  return <AuthGate>{(user) => <Shell user={user} />}</AuthGate>;
}
