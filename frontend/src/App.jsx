import { useCallback, useEffect, useState } from 'react';
import './App.css';
import AuthGate from './components/AuthGate';
import { signOut } from './lib/catalyst';
import { navigate, useRoute } from './lib/router';
import Home from './views/Home';
import Vault from './views/Vault';
import Connections from './views/Connections';

/**
 * App shell — header, navigation and the route switch. Everything below AuthGate can assume a
 * verified @zohocorp.com session; the server re-verifies it on every request regardless.
 */

const NAV = [
  { path: '/', label: 'Home' },
  { path: '/vault', label: 'Vault' },
  { path: '/connections', label: 'Connections' },
];

function Shell({ user }) {
  const { path } = useRoute();
  const [notice, setNotice] = useState(null);

  const onNotice = useCallback((message) => setNotice(message), []);

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

      {path === '/vault' && <Vault onNotice={onNotice} />}
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
