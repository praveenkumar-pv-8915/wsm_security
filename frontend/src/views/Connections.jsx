import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { clearRouteParams } from '../lib/router';
import { RefreshIcon, LayersIcon, CloseIcon, PlugIcon, ReauthIcon, BoltIcon, UnplugIcon } from '../lib/icons';

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
 * Bulk configure — one OAuth client, one consent, several services.
 *
 * Consent happens at exactly ONE accounts host, so the data centre is picked first and only
 * services available there can be selected. That is a real constraint, not a UI simplification:
 * Hacksaw lives on accounts.zohocorpcloud.in (`zcc`) while everything else is on accounts.zoho.in
 * (`in`), so it can never share a consent with the rest.
 */
function BulkPanel({ connections, user, value, onChange, onSubmit, busy }) {
  const oauth = connections.filter((c) => c.auth_type === 'oauth');
  const dcs = [...new Set(oauth.flatMap((c) => c.available_dcs))].sort();
  const dc = value.dc || '';
  const eligible = dc ? oauth.filter((c) => c.available_dcs.includes(dc)) : [];
  const chosen = eligible.filter((c) => value.keys.includes(c.key));
  // The union is what actually gets requested — a scope shared by two services is asked for once.
  const scopeCount = new Set(chosen.flatMap((c) => c.scopes)).size;
  const excluded = dc ? oauth.filter((c) => !c.available_dcs.includes(dc)) : [];

  const toggle = (key) =>
    onChange({ ...value, keys: value.keys.includes(key) ? value.keys.filter((k) => k !== key) : [...value.keys, key] });

  return (
    <section className="card bulk">
      <div className="card-head">
        <h2>Bulk configure</h2>
        <span className="count">{chosen.length ? `${chosen.length} selected` : 'pick a DC'}</span>
      </div>
      <p className="hint">
        One client id and secret, one Zoho consent covering every scope the selected services need.
        Register that client once in the API console for this data centre.
      </p>

      <div className="form-grid">
        <label>
          <span>Data centre</span>
          <select value={dc} onChange={(e) => onChange({ ...value, dc: e.target.value, keys: [] })}>
            <option value="">— select —</option>
            {dcs.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label>
          <span>Scope</span>
          <select value={value.scope_level} onChange={(e) => onChange({ ...value, scope_level: e.target.value })}>
            <option value="user">personal (only me)</option>
            <option value="shared" disabled={user.role !== 'admin'}>
              team-shared{user.role !== 'admin' ? ' — admin only' : ''}
            </option>
          </select>
        </label>
      </div>

      {dc && (
        <>
          <ul className="bulk-list">
            {eligible.map((service) => (
              <li key={service.key}>
                <label className="bulk-item">
                  <input type="checkbox" checked={value.keys.includes(service.key)} onChange={() => toggle(service.key)} />
                  <span className="bulk-name">{service.label}</span>
                  <span className="dim">{service.scope_count} scopes</span>
                  {service.configured && <span className="tag tag-muted">already configured</span>}
                </label>
              </li>
            ))}
          </ul>
          {excluded.length > 0 && (
            <p className="hint">
              Not available in <span className="mono">{dc}</span>, so they cannot share this consent:{' '}
              {excluded.map((c) => c.label).join(', ')}. Configure those from their own row.
            </p>
          )}
        </>
      )}

      {chosen.length > 0 && (
        <>
          <div className="form-grid">
            <label>
              <span>Client ID</span>
              <input
                value={value.client_id}
                onChange={(e) => onChange({ ...value, client_id: e.target.value })}
                placeholder="from the Zoho API console"
                autoComplete="off"
              />
            </label>
            <label>
              <span>Client secret</span>
              <input
                type="password"
                value={value.client_secret}
                onChange={(e) => onChange({ ...value, client_secret: e.target.value })}
                placeholder="stored encrypted, never returned"
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="form-foot">
            <span className="hint">
              {chosen.length} services · {scopeCount} scopes in one consent. Re-configuring a service
              replaces its existing credential.
            </span>
            <button
              className="btn btn-primary"
              type="button"
              onClick={onSubmit}
              disabled={busy || !value.client_id.trim() || !value.client_secret}
            >
              {busy ? 'Working…' : 'Authorise all →'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The result of one probe. A non-2xx is shown as prominently as a 2xx — the point of this panel is
 * to tell you which of the two you got, and the response body is what explains why.
 */
function FetchPanel({ service, credential, value, onChange, onRun, busy, result, onClose }) {
  const op = service.fetch_operation;
  const params = op.params || [];
  const failed = result && (result.success === false || result.ok === false);

  return (
    <div className="conn-form probe">
      <div className="probe-head">
        <span className="mono probe-op">{op.method} · {op.label}</span>
        <span className="probe-head-right">
          <span className="dim">
            {credential.scope_level === 'shared' ? 'team' : 'personal'} credential · {service.default_dc}
          </span>
          <button
            type="button"
            className="probe-close"
            onClick={onClose}
            aria-label={`Close ${op.label}`}
            title="Close"
          >
            ×
          </button>
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
  const [scopesKey, setScopesKey] = useState(null);

  // Bulk configure
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState({ dc: '', keys: [], client_id: '', client_secret: '', scope_level: 'user' });

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
      const extraFields = service.extra_config_fields || [];
      const extraConfig = extraFields.length
        ? Object.fromEntries(extraFields.map((f) => [f.name, field(service.key, f.name).trim()]))
        : undefined;
      const result = await api('/connections/oauth/start', {
        method: 'POST',
        body: {
          service_key: service.key,
          dc: field(service.key, 'dc') || service.default_dc,
          client_id: field(service.key, 'client_id').trim(),
          client_secret: field(service.key, 'client_secret'),
          scope_level: field(service.key, 'scope_level') || 'user',
          ...(extraConfig ? { extra_config: extraConfig } : {}),
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

  /**
   * The escape hatch for an OAuth service whose only usable Zoho client is a self client — self
   * clients have no redirect URI, so startOAuth's browser flow can never complete for them. Stores
   * a refresh token you already obtained some other way (e.g. the kit's setup.sh --code path).
   */
  const saveRefreshToken = async (service) => {
    setBusy(true);
    setError(null);
    try {
      const extraFields = service.extra_config_fields || [];
      const extraConfig = extraFields.length
        ? Object.fromEntries(extraFields.map((f) => [f.name, field(service.key, f.name).trim()]))
        : undefined;
      await api('/connections/oauth/refresh-token', {
        method: 'POST',
        body: {
          service_key: service.key,
          dc: field(service.key, 'dc') || service.default_dc,
          client_id: field(service.key, 'client_id').trim(),
          client_secret: field(service.key, 'client_secret'),
          refresh_token: field(service.key, 'refresh_token').trim(),
          scope_level: field(service.key, 'scope_level') || 'user',
          ...(extraConfig ? { extra_config: extraConfig } : {}),
        },
      });
      onNotice?.(`Connected ${service.label} from a refresh token.`);
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

  const startBulk = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api('/connections/bulk/start', {
        method: 'POST',
        body: {
          service_keys: bulk.keys,
          dc: bulk.dc,
          client_id: bulk.client_id.trim(),
          client_secret: bulk.client_secret,
          scope_level: bulk.scope_level,
        },
      });
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
  const needsAttention = connections.filter(
    (c) => c.effective && (c.effective.expired || c.effective.scopes_stale)
  ).length;

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
          <button
            className="btn btn-ghost btn-icon"
            onClick={load}
            disabled={loading || busy}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshIcon />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => { setBulkOpen((o) => !o); setOpenKey(null); setProbeKey(null); }}
            disabled={busy}
            title={bulkOpen ? 'Close bulk configure' : 'Bulk configure — one OAuth client, one consent, several services'}
            aria-label={bulkOpen ? 'Close bulk configure' : 'Bulk configure'}
          >
            {bulkOpen ? <CloseIcon /> : <LayersIcon />}
          </button>
        </div>
      </div>

      <div className="conn-summary">
        <div className="summary-chip">
          <span className="summary-value">{connections.length}</span>
          <span className="summary-label">Connections</span>
        </div>
        <div className="summary-chip">
          <span className="summary-value summary-good">{configured}</span>
          <span className="summary-label">Connected</span>
        </div>
        <div className={`summary-chip${needsAttention ? ' summary-chip-attn' : ''}`}>
          <span className="summary-value summary-warn">{needsAttention}</span>
          <span className="summary-label">Needs attention</span>
        </div>
      </div>

      {error && <div className="banner banner-err" role="alert">⚠ {error}</div>}

      {bulkOpen && (
        <BulkPanel
          connections={connections}
          user={user}
          value={bulk}
          onChange={setBulk}
          onSubmit={startBulk}
          busy={busy}
        />
      )}

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
                      {service.scope_count > 0 && (
                        <button
                          type="button"
                          className="scope-toggle"
                          onClick={() => setScopesKey(scopesKey === service.key ? null : service.key)}
                          aria-expanded={scopesKey === service.key}
                          title="Show the exact scopes this service asks for"
                        >
                          {service.scope_count} scopes {scopesKey === service.key ? '▴' : '▾'}
                        </button>
                      )}
                      {eff ? (
                        <>
                          <span className={`tag${eff.expired ? ' tag-warn' : ''}`}>
                            {eff.source === 'user' ? 'personal' : 'team'}
                          </span>
                          {eff.scopes_stale && (
                            <span className="tag tag-warn" title="This service asks for scopes that weren't in the grant you consented to. Re-authenticate to widen it.">
                              scopes changed
                            </span>
                          )}
                          {eff.extra_config?.portal_id && (
                            <span className="tag tag-muted mono" title="Saved portal_id for this connection">
                              portal: {eff.extra_config.portal_id}
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
                          className="btn btn-small btn-attn btn-icon-sm"
                          onClick={() => reauthorize(service, myOrTeam)}
                          disabled={busy}
                          title="Re-authenticate — re-run Zoho consent using the stored client id and secret"
                          aria-label="Re-authenticate"
                        >
                          <ReauthIcon />
                        </button>
                      )}
                      {service.fetch_operation && myOrTeam && (
                        <button
                          className="btn btn-small btn-icon-sm"
                          onClick={() => toggleProbe(service, myOrTeam)}
                          disabled={busy || probeBusy === service.key}
                          title={probeBusy === service.key ? 'Fetching…' : `Fetch — ${service.fetch_operation.method} · ${service.fetch_operation.label}`}
                          aria-label="Fetch"
                        >
                          <BoltIcon />
                        </button>
                      )}
                      {/*
                        Reconfigure was removed as its own action (2026-09-01): once a connection
                        is live, Re-authenticate covers the one case that needs fixing without
                        retyping (a stale/expired grant); anything else goes through Revoke +
                        Connect again. Connect (and Close, while its form is open) is the only
                        state this toggle still needs to render.
                      */}
                      {!eff && (
                        <button
                          className="btn btn-small btn-icon-sm"
                          onClick={() => setOpenKey(isOpen ? null : service.key)}
                          disabled={busy}
                          title={isOpen ? 'Close' : 'Connect'}
                          aria-label={isOpen ? 'Close' : 'Connect'}
                        >
                          {isOpen ? <CloseIcon /> : <PlugIcon />}
                        </button>
                      )}
                      {service.mine && (
                        <button
                          className="btn btn-small btn-danger btn-icon-sm"
                          onClick={() => revoke(service, service.mine)}
                          disabled={busy}
                          title="Revoke my credential"
                          aria-label="Revoke my credential"
                        >
                          <UnplugIcon />
                        </button>
                      )}
                      {service.shared && user.role === 'admin' && (
                        <button
                          className="btn btn-small btn-danger btn-icon-sm"
                          onClick={() => revoke(service, service.shared)}
                          disabled={busy}
                          title="Revoke team credential"
                          aria-label="Revoke team credential"
                        >
                          <UnplugIcon />
                        </button>
                      )}
                    </div>
                  </div>

                  {scopesKey === service.key && (
                    <ul className="scope-list">
                      {service.scopes.map((scope) => <li key={scope} className="mono">{scope}</li>)}
                    </ul>
                  )}

                  {probeKey === service.key && service.fetch_operation && (
                    <FetchPanel
                      service={service}
                      credential={myOrTeam}
                      value={(name) => probeField(service.key, name)}
                      onChange={(name, v) => setProbeField(service.key, name, v)}
                      onRun={() => runFetch(service, myOrTeam)}
                      busy={probeBusy === service.key}
                      result={probeResult[service.key]}
                      onClose={() => setProbeKey(null)}
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
                            {/*
                              A self-client Zoho app has no redirect URI, so the browser consent
                              flow below can never complete for it. This lets someone paste a
                              refresh token they already obtained another way (e.g. the kit's
                              setup.sh --code path) instead of clicking through Zoho.
                            */}
                            <label className="span-full auth-mode-toggle">
                              <input
                                type="checkbox"
                                checked={field(service.key, 'auth_mode') === 'refresh_token'}
                                onChange={(e) =>
                                  setField(service.key, 'auth_mode', e.target.checked ? 'refresh_token' : '')
                                }
                              />
                              <span>I already have a refresh token (self client — no redirect URI to consent through)</span>
                            </label>
                            {field(service.key, 'auth_mode') === 'refresh_token' && (
                              <label className="span-full">
                                <span>Refresh token</span>
                                <input
                                  type="password"
                                  value={field(service.key, 'refresh_token')}
                                  onChange={(e) => setField(service.key, 'refresh_token', e.target.value)}
                                  placeholder="stored encrypted, never returned"
                                  autoComplete="new-password"
                                />
                              </label>
                            )}
                            {/*
                              Non-secret per-connection settings a service declares beyond the OAuth
                              client itself — e.g. PlatformAI's portal_id, which OAuth consent alone
                              doesn't produce (it's assigned separately by platformai@zohocorp.com).
                              Driven entirely by the registry, so this needs no per-service code.
                              Needed in both auth modes, so it's rendered outside the toggle.
                            */}
                            {(service.extra_config_fields || []).map((f) => (
                              <label key={f.name}>
                                <span>{f.label}{f.required ? '' : ' (optional)'}</span>
                                <input
                                  value={field(service.key, f.name)}
                                  onChange={(e) => setField(service.key, f.name, e.target.value)}
                                  placeholder={f.placeholder || ''}
                                  autoComplete="off"
                                  title={f.help || ''}
                                />
                              </label>
                            ))}
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
                        {(() => {
                          const usingRefreshToken = isOAuth && field(service.key, 'auth_mode') === 'refresh_token';
                          return (
                            <>
                              <span className="hint">
                                {usingRefreshToken
                                  ? 'Exchanged once against Zoho to prove it works before anything is stored.'
                                  : isOAuth
                                  ? 'Register the callback URL shown in CONNECTIONS.md against this client before continuing.'
                                  : 'Encrypted with AES-256-GCM before it reaches DataStore.'}
                              </span>
                              <button
                                className="btn btn-primary"
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  usingRefreshToken
                                    ? saveRefreshToken(service)
                                    : isOAuth
                                    ? startOAuth(service)
                                    : saveToken(service)
                                }
                              >
                                {busy
                                  ? 'Working…'
                                  : usingRefreshToken
                                  ? 'Connect from refresh token'
                                  : isOAuth
                                  ? 'Authorise with Zoho →'
                                  : 'Store token'}
                              </button>
                            </>
                          );
                        })()}
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
