import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Credential Vault — the original app, now one view among several.
 *
 * Behaviour is unchanged from the single-page version: list metadata, store a new secret, reveal
 * one on demand, deactivate. Values are AES-256-GCM encrypted inside the function before they reach
 * DataStore, and every row is owner-scoped server-side by `owner_id` — this view can only ever see
 * the caller's own credentials.
 */

const CRED_TYPES = ['api_key', 'password', 'token', 'ssh_key', 'certificate', 'other'];

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return isNaN(d) ? String(ts) : d.toLocaleString();
}

export default function Vault({ onNotice }) {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState(CRED_TYPES[0]);
  const [value, setValue] = useState('');

  // Revealed plaintext, keyed by credential_name. Component state only — never persisted, so it
  // dies with the tab rather than lingering in storage.
  const [revealed, setRevealed] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api('/credentials');
      setCredentials(result.credentials || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim() || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api('/credentials/add', {
        method: 'POST',
        body: { credential_name: name.trim(), credential_type: type, credential_value: value },
      });
      onNotice?.(`Credential "${result.credential_name}" stored.`);
      setName(''); setValue(''); setType(CRED_TYPES[0]); setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async (credName) => {
    if (revealed[credName] !== undefined) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[credName];
        return next;
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api(`/credentials/${encodeURIComponent(credName)}`);
      setRevealed((prev) => ({ ...prev, [credName]: result.credential.credential_value }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async (cred) => {
    if (!window.confirm(`Deactivate "${cred.credential_name}"? Its stored secret is wiped and cannot be recovered.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/credentials/${cred.ROWID}`, { method: 'DELETE' });
      onNotice?.(`Credential "${cred.credential_name}" deactivated.`);
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[cred.credential_name];
        return next;
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const active = credentials.filter((c) => Number(c.is_active) === 1);
  const inactive = credentials.filter((c) => Number(c.is_active) !== 1);

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Credential Vault</h2>
          <p className="view-sub">AES-256-GCM at rest · only you can see your own credentials</p>
        </div>
        <div className="view-actions">
          <button className="btn btn-ghost" onClick={load} disabled={loading || busy}>⟳ Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? '× Cancel' : '+ New credential'}
          </button>
        </div>
      </div>

      {error && <div className="banner banner-err" role="alert">⚠ {error}</div>}

      {showForm && (
        <form className="card add-form" onSubmit={handleAdd}>
          <div className="card-head"><h2>Store a new credential</h2></div>
          <div className="form-grid">
            <label>
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)}
                     placeholder="e.g. github_deploy_key" required maxLength={100} autoFocus />
            </label>
            <label>
              <span>Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {CRED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="span-full">
              <span>Secret value</span>
              <textarea value={value} onChange={(e) => setValue(e.target.value)}
                        placeholder="Encrypted with AES-256-GCM before storage" rows={3} required />
            </label>
          </div>
          <div className="form-foot">
            <span className="hint">Encrypted inside the function — only ciphertext reaches DataStore.</span>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Storing…' : 'Store credential'}
            </button>
          </div>
        </form>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Active credentials</h2>
          <span className="count">{loading ? '…' : active.length}</span>
        </div>

        {loading ? (
          <p className="empty">Loading vault…</p>
        ) : active.length === 0 ? (
          <p className="empty">Vault is empty. Store your first credential with “+ New credential”.</p>
        ) : (
          <div className="table-scroll">
            <table className="cred-table">
              <thead>
                <tr>
                  <th>Name</th><th>Type</th><th>Created</th><th>Secret</th><th className="ta-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map((cred) => (
                  <tr key={cred.ROWID}>
                    <td className="mono strong">{cred.credential_name}</td>
                    <td><span className="tag">{cred.credential_type}</span></td>
                    <td className="dim">{formatTime(cred.CREATEDTIME)}</td>
                    <td className="mono secret-cell">
                      {revealed[cred.credential_name] !== undefined
                        ? <span className="secret-value">{String(revealed[cred.credential_name])}</span>
                        : <span className="masked">••••••••••••</span>}
                    </td>
                    <td className="ta-right">
                      <button className="btn btn-small" onClick={() => handleReveal(cred.credential_name)} disabled={busy}>
                        {revealed[cred.credential_name] !== undefined ? 'Hide' : 'Reveal'}
                      </button>
                      <button className="btn btn-small btn-danger" onClick={() => handleDeactivate(cred)} disabled={busy}>
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {inactive.length > 0 && (
        <section className="card card-muted">
          <div className="card-head">
            <h2>Deactivated</h2>
            <span className="count">{inactive.length}</span>
          </div>
          <div className="table-scroll">
            <table className="cred-table">
              <tbody>
                {inactive.map((cred) => (
                  <tr key={cred.ROWID} className="row-inactive">
                    <td className="mono">{cred.credential_name}</td>
                    <td><span className="tag tag-muted">{cred.credential_type}</span></td>
                    <td className="dim">{formatTime(cred.CREATEDTIME)}</td>
                    <td className="dim">secret deleted</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
