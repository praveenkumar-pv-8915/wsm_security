import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { navigate } from '../lib/router';

/**
 * Signed-in home — the landing surface the app never had.
 *
 * Counts come from the modules themselves and each tile fails independently — `connection_credentials`
 * may not exist in DataStore yet, and a "No such Table" there must not take the whole page down.
 * A tile that can't load says so and stays clickable.
 */

function Tile({ title, blurb, value, hint, state, to, disabled }) {
  const body =
    state === 'loading' ? <span className="tile-value dim">…</span>
    : state === 'error' ? <span className="tile-value tile-value-err">—</span>
    : <span className="tile-value">{value}</span>;

  return (
    <button
      type="button"
      className={`tile${disabled ? ' tile-disabled' : ''}`}
      onClick={() => !disabled && navigate(to)}
      disabled={disabled}
    >
      <span className="tile-head">
        <span className="tile-title">{title}</span>
        {body}
      </span>
      <span className="tile-blurb">{blurb}</span>
      <span className={`tile-hint${state === 'error' ? ' tile-value-err' : ''}`}>{hint}</span>
    </button>
  );
}

export default function Home({ user }) {
  const [conns, setConns] = useState({ state: 'loading', configured: 0, total: 0, hint: '' });

  const load = useCallback(async () => {
    setConns((c) => ({ ...c, state: 'loading' }));
    api('/connections')
      .then((r) => {
        const list = r.connections || [];
        const configured = list.filter((c) => c.configured).length;
        const stale = list.filter((c) => c.effective?.scopes_stale).length;
        setConns({
          state: 'ok',
          configured,
          total: list.length,
          stale,
          hint: stale
            ? `${configured} of ${list.length} connected · ${stale} need re-authentication`
            : `${configured} of ${list.length} services connected`,
        });
      })
      .catch((err) => setConns({ state: 'error', configured: 0, total: 0, hint: err.message }));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Welcome, {user.name.split(' ')[0]}</h2>
          <p className="view-sub">
            WSM Security team workspace
            {user.role === 'admin' && <span className="tag tag-admin">admin</span>}
          </p>
        </div>
        <div className="view-actions">
          <button className="btn btn-ghost" onClick={load}>⟳ Refresh</button>
        </div>
      </div>

      <div className="tiles">
        <Tile
          title="Connections"
          blurb="OAuth and token connections to the team's internal Zoho tools. Secrets are encrypted at rest and never returned."
          value={conns.state === 'ok' ? `${conns.configured}/${conns.total}` : 0}
          hint={conns.hint}
          state={conns.state}
          to="/connections"
        />
        <Tile
          title="Tasks"
          blurb="Team task board — the task_manager API is deployed, the UI is not built yet."
          value="—"
          hint="Coming next"
          state="ok"
          to="/"
          disabled
        />
      </div>

      <section className="card card-muted">
        <div className="card-head"><h2>Signed in as</h2></div>
        <dl className="kv">
          <dt>Name</dt><dd>{user.name}</dd>
          <dt>Email</dt><dd className="mono">{user.email}</dd>
          <dt>Role</dt><dd className="mono">{user.role}</dd>
        </dl>
        <p className="hint">
          Identity comes from your Catalyst session on every request. Nothing about you is stored in
          this app’s database — ownership is keyed to your Catalyst user id, never your email.
        </p>
      </section>
    </>
  );
}
