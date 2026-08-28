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
 *
 * Re-authenticate is its own action, not a variant of Connect. A stored refresh token keeps
 * refreshing after a service gains a scope, but it carries the grant frozen at consent time, so
 * the new scope 401s and the connection looks broken rather than under-permissioned. Re-auth reuses
 * the stored client id and secret, so nobody has to dig them out of the Zoho console again.
 */

const AUTH_LABEL = {
  oauth: 'OAuth 2.0',
  private_token: 'PRIVATE-TOKEN header',
  pat: 'Personal access token',
};

/**
 * The result of one probe. A non-2xx is shown as prominently as a 2xx — the point of this panel is
 * to tell you which of the two you got, and the response body is what explains why.
 */
function FetchPanel({ service, credential, value, onChange, onRun, busy, result }) {
  const op = service.fetch_operation;
  const params = op.params || [];
  const failed = result && (result.success === false || result.ok === false);

  return (
    <div className="conn-form probe">
      <div className="probe-head">
        <span className="mono probe-op">{op.method} · {op.label}</span>
        <span className="dim">
          {credential.scope_level === 'shared' ? 'team' : 'personal'} credential · {service.default_dc}
        </span>
      </div>
      {op.note && <p className="hint">{op.note}</p>}

      {params.length > 0 && (
        <div className="form-grid">
          {params.map((param) => (
            <label key={param.name}>
              <span>{param.label}{param.required ? '' : ' (optional)'}</span>
              <input
                value={value(param.name)}
                onChange={(e) => onChange(param.name, e.target.value)}
                placeholder={param.placeholder || ''}
              />
            </label>
          ))}
        </div>
      )}

      <div className="form-foot">
        <span className="hint">
          Read-only. The endpoint is fixed in the registry — only these values are yours to set.
        </span>
        <button className="btn btn-primary" type="button" onClick={onRun} disabled={busy}>
          {busy ? 'Running…' : 'Run fetch'}
        </button>
      </div>

      {result && (
        <div className={`probe-result${failed ? ' probe-result-err' : ''}`}>
          <div className="probe-status">
            {result.success === false ? (
              <span className="tag tag-warn">failed</span>
            ) : (
              <>
                <span className={`tag${result.ok ? '' : ' tag-warn'}`}>HTTP {result.status}</span>
                <span className="dim">{result.ms} ms</span>
                {result.truncated && <span className="tag tag-warn">truncated at 256 KB</span>}
              </>
            )}
          </div>
          {result.url && <p className="probe-url mono dim">{result.url}</p>}
          <pre className="probe-body">
            {result.success === false
              ? result.error
              : (result.body !== null && result.body !== undefined
                  ? JSON.stringify(result.body, null, 2)
                  : (result.raw || '(empty response)'))}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function Connections({ user, onNotice }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [openKey, setOpenKey] = useState(null);

  // Fetch-probe state, keyed by service key so two panels never share inputs or results.
  const [probeKey, setProbeKey] = useState(null);
  const [probeInputs, setProbeInputs] = useState({});
  const [probeResult, setProbeResult] = useState({});
  const [probeBusy, setProbeBusy] = useState(null);

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

  const reauthorize = async (service, credential) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api(`/connections/${credential.id}/reauthorize`, { method: 'POST' });
      window.location.assign(result.auth_url);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const probeField = (key, name) => probeInputs[key]?.[name] ?? '';
  const setProbeField = (key, name, val) =>
    setProbeInputs((prev) => ({ ...prev, [key]: { ...prev[key], [name]: val } }));

  const runFetch = async (service, credential) => {
    setProbeBusy(service.key);
    try {
      // A failed probe is a RESULT, not an error — a 401 or 404 from the far end is exactly what
      // this button exists to surface, so it renders in the panel rather than the page banner.
      const result = await api(`/connections/${credential.id}/fetch`, {
        method: 'POST',
        body: { params: probeInputs[service.key] || {} },
      });
      setProbeResult((prev) => ({ ...prev, [service.key]: result }));
    } catch (err) {
      setProbeResult((prev) => ({ ...prev, [service.key]: { success: false, error: err.message } }));
    } finally {
      setProbeBusy(null);
    }
  };

  const toggleProbe = (service, credential) => {
    if (probeKey === service.key) { setProbeKey(null); return; }
    setProbeKey(service.key);
    setOpenKey(null);
    // Nothing to fill in — just run it.
    if ((service.fetch_operation?.params || []).length === 0) runFetch(service, credential);
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
        </div>
      </div>

      {error && <div className="banner banner-err" role="alert">⚠ {error}</div>}

      <section className="card">
        <div className="card-head">
          <h2>Services</h2>
          <span className="count">{loading ? '…' : `${configured}/${connections.length}`}</span>
        </div>

        {loading ? (
          <p className="empty">
            No catalogue returned. If the error above says a table doesn’t exist,
            <code> connection_credentials </code> has to be created in the Catalyst console first —
            there is no API for creating a table. See CONNECTIONS.md for the schema.
          </p>
        ) : connections.length === 0 ? (
          <p className="empty">
            No catalogue returned. If the error above says a table doesn’t exist, the DataStore
            tables have to be created in the Catalyst console first — there is no API for it, and
            “Seed catalogue” only fills tables that already exist. See CONNECTIONS.md for the schema.
          </p>
        ) : (
          <ul className="conn-list">
            {connections.map((service) => {
              const isOpen = openKey === service.key;
              const eff = service.effective;
              const isOAuth = service.auth_type === 'oauth';
              // Re-auth acts on a row this caller may write: their own, or the team one if admin.
              const myOrTeam = service.mine || (user.role === 'admin' ? service.shared : null);
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
                        <>
                          <span className={`tag${eff.expired ? ' tag-warn' : ''}`}>
                            {eff.source === 'user' ? 'personal' : 'team'}{eff.expired ? ' · expired' : ''}
                          </span>
                          {eff.scopes_stale && (
                            <span className="tag tag-warn" title="This service asks for scopes that weren't in the grant you consented to. Re-authenticate to widen it.">
                              scopes changed
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="dim">not configured</span>
                      )}
                    </div>

                    <div className="conn-actions">
                      {/*
                        Only shown when it is the actual fix. Re-authenticate and Reconfigure
                        overlap — Reconfigure opens the form and can do everything this does, plus
                        change the client id/secret or DC. The one case this uniquely serves is a
                        grant that has gone stale or expired, where nothing needs retyping. On a
                        healthy row it would just be a worse Reconfigure, so it stays hidden.
                      */}
                      {isOAuth && myOrTeam && (eff?.scopes_stale || eff?.expired) && (
                        <button
                          className="btn btn-small btn-attn"
                          onClick={() => reauthorize(service, myOrTeam)}
                          disabled={busy}
                          title="Re-run Zoho consent using the stored client id and secret"
                        >
                          ↻ Re-authenticate
                        </button>
                      )}
                      {service.fetch_operation && myOrTeam && (
                        <button
                          className="btn btn-small"
                          onClick={() => toggleProbe(service, myOrTeam)}
                          disabled={busy || probeBusy === service.key}
                          title={`${service.fetch_operation.method} · ${service.fetch_operation.label}`}
                        >
                          {probeBusy === service.key ? '… Fetching' : '⚡ Fetch'}
                        </button>
                      )}
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

                  {probeKey === service.key && service.fetch_operation && (
                    <FetchPanel
                      service={service}
                      credential={myOrTeam}
                      value={(name) => probeField(service.key, name)}
                      onChange={(name, v) => setProbeField(service.key, name, v)}
                      onRun={() => runFetch(service, myOrTeam)}
                      busy={probeBusy === service.key}
                      result={probeResult[service.key]}
                    />
                  )}

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
