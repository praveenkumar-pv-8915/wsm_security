import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { clearRouteParams } from '../lib/router';

/**
 * Connections — the 11 internal-tool integrations from connections-registry.js.
 *
 * Two credential levels per service: a team `shared` one (admins only) and a personal `user` one.
 * Resolution is user-then-shared, so a personal credential overrides the team's for that person.
 * The backend computes `effective` and this view just reports which one won.
 *
 * No secret ever reaches this component. The API returns metadata only (`toPublic()` in
 * connections-service.js), and OAuth scopes come from the server-side registry — the client sends
 * a service key, never a scope list, so nothing here can widen a grant.
 */

const AUTH_LABEL = {
  oauth: 'OAuth 2.0',
  private_token: 'PRIVATE-TOKEN header',
  pat: 'Personal access token',
};

export default function Connections({ user, onNotice }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [openKey, setOpenKey] = useState(null);

  // Per-service form state, keyed by service key so switching cards doesn't leak values across.
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api('/connections');
      setConnections(result.connections || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The OAuth callback lands the browser back here as
  // /app/#/connections?status=connected&detail=<service> — surface the outcome, then strip the
  // params so a reload doesn't replay a stale banner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const status = params.get('status');
    if (!status) return;
    const detail = params.get('detail') || '';
    if (status === 'connected') {
      onNotice?.(`Connected: ${detail}`);
    } else {
      setError(`Connection failed — ${detail}`);
    }
    clearRouteParams();
  }, [onNotice]);

  const field = (key, name) => form[key]?.[name] ?? '';
  const setField = (key, name, val) =>
    setForm((prev) => ({ ...prev, [key]: { ...prev[key], [name]: val } }));

  const startOAuth = async (service) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api('/connections/oauth/start', {
        method: 'POST',
        body: {
          service_key: service.key,
          dc: field(service.key, 'dc') || service.default_dc,
          client_id: field(service.key, 'client_id').trim(),
          client_secret: field(service.key, 'client_secret'),
          scope_level: field(service.key, 'scope_level') || 'user',
        },
      });
      // Full-page navigation, not a popup — Zoho's consent screen refuses to frame, and the
      // callback needs to land on this origin to set the session cookie.
      window.location.assign(result.auth_url);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const saveToken = async (service) => {
    setBusy(true);
    setError(null);
    try {
      await api('/connections/token', {
        method: 'POST',
        body: {
          service_key: service.key,
          dc: field(service.key, 'dc') || service.default_dc,
          token: field(service.key, 'token'),
          scope_level: field(service.key, 'scope_level') || 'user',
        },
      });
      onNotice?.(`Token stored for ${service.label}.`);
      setForm((prev) => ({ ...prev, [service.key]: {} }));
      setOpenKey(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (service, credential) => {
    const what = credential.scope_level === 'shared' ? 'the team-shared credential' : 'your credential';
    if (!window.confirm(`Revoke ${what} for ${service.label}? It is revoked at Zoho and wiped here.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/connections/${credential.id}`, { method: 'DELETE' });
      onNotice?.(`Revoked ${service.label}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api('/connections/seed', { method: 'POST' });
      onNotice?.(`Catalogue seeded — ${result.connections.inserted} added, ${result.connections.updated} updated.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const configured = connections.filter((c) => c.configured).length;

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Connections</h2>
          <p className="view-sub">
            Internal tool integrations · personal credentials override the team-shared one
          </p>
        </div>
        <div className="view-actions">
          <button className="btn btn-ghost" onClick={load} disabled={loading || busy}>⟳ Refresh</button>
          {user.role === 'admin' && (
            <button className="btn btn-ghost" onClick={seed} disabled={busy} title="Mirror the code catalogue into DataStore">
              ⛁ Seed catalogue
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner banner-err" role="alert">⚠ {error}</div>}

      <section className="card">
        <div className="card-head">
          <h2>Services</h2>
          <span className="count">{loading ? '…' : `${configured}/${connections.length}`}</span>
        </div>

        {loading ? (
          <p className="empty">Loading catalogue…</p>
        ) : connections.length === 0 ? (
          <p className="empty">
            No catalogue returned. If the DataStore tables aren’t created yet, an admin can run “Seed catalogue”.
          </p>
        ) : (
          <ul className="conn-list">
            {connections.map((service) => {
              const isOpen = openKey === service.key;
              const eff = service.effective;
              const isOAuth = service.auth_type === 'oauth';
              return (
                <li key={service.key} className={`conn${service.configured ? ' conn-on' : ''}`}>
                  <div className="conn-main">
                    <div className="conn-id">
                      <span className={`dot${service.configured ? ' dot-on' : ''}`} aria-hidden="true" />
                      <div>
                        <p className="conn-label">{service.label}</p>
                        <p className="conn-key mono">{service.key}</p>
                      </div>
                    </div>

                    <div className="conn-meta">
                      <span className="tag tag-muted">{AUTH_LABEL[service.auth_type] || service.auth_type}</span>
                      {service.scope_count > 0 && <span className="dim">{service.scope_count} scopes</span>}
                      {eff ? (
                        <span className={`tag${eff.expired ? ' tag-warn' : ''}`}>
                          {eff.source === 'user' ? 'personal' : 'team'}{eff.expired ? ' · expired' : ''}
                        </span>
                      ) : (
                        <span className="dim">not configured</span>
                      )}
                    </div>

                    <div className="conn-actions">
                      <button className="btn btn-small" onClick={() => setOpenKey(isOpen ? null : service.key)} disabled={busy}>
                        {isOpen ? 'Close' : (eff ? 'Reconfigure' : 'Connect')}
                      </button>
                      {service.mine && (
                        <button className="btn btn-small btn-danger" onClick={() => revoke(service, service.mine)} disabled={busy}>
                          Revoke mine
                        </button>
                      )}
                      {service.shared && user.role === 'admin' && (
                        <button className="btn btn-small btn-danger" onClick={() => revoke(service, service.shared)} disabled={busy}>
                          Revoke team
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="conn-form">
                      <p className="hint">{service.description}</p>
                      <div className="form-grid">
                        <label>
                          <span>Data centre</span>
                          <select
                            value={field(service.key, 'dc') || service.default_dc}
                            onChange={(e) => setField(service.key, 'dc', e.target.value)}
                          >
                            {service.available_dcs.map((dc) => <option key={dc} value={dc}>{dc}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>Scope</span>
                          <select
                            value={field(service.key, 'scope_level') || 'user'}
                            onChange={(e) => setField(service.key, 'scope_level', e.target.value)}
                          >
                            <option value="user">personal (only me)</option>
                            <option value="shared" disabled={user.role !== 'admin'}>
                              team-shared{user.role !== 'admin' ? ' — admin only' : ''}
                            </option>
                          </select>
                        </label>

                        {isOAuth ? (
                          <>
                            <label>
                              <span>Client ID</span>
                              <input
                                value={field(service.key, 'client_id')}
                                onChange={(e) => setField(service.key, 'client_id', e.target.value)}
                                placeholder="from the Zoho API console"
                                autoComplete="off"
                              />
                            </label>
                            <label>
                              <span>Client secret</span>
                              <input
                                type="password"
                                value={field(service.key, 'client_secret')}
                                onChange={(e) => setField(service.key, 'client_secret', e.target.value)}
                                placeholder="stored encrypted, never returned"
                                autoComplete="new-password"
                              />
                            </label>
                          </>
                        ) : (
                          <label className="span-full">
                            <span>Token</span>
                            <input
                              type="password"
                              value={field(service.key, 'token')}
                              onChange={(e) => setField(service.key, 'token', e.target.value)}
                              placeholder="stored encrypted, never returned"
                              autoComplete="new-password"
                            />
                          </label>
                        )}
                      </div>

                      <div className="form-foot">
                        <span className="hint">
                          {isOAuth
                            ? 'Register the callback URL shown in CONNECTIONS.md against this client before continuing.'
                            : 'Encrypted with AES-256-GCM before it reaches DataStore.'}
                        </span>
                        <button
                          className="btn btn-primary"
                          type="button"
                          disabled={busy}
                          onClick={() => (isOAuth ? startOAuth(service) : saveToken(service))}
                        >
                          {busy ? 'Working…' : (isOAuth ? 'Authorise with Zoho →' : 'Store token')}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
