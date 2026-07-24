import { useState, useEffect, useCallback } from 'react'
import './App.css'

const API_BASE = '/server/welcome/api'

const CRED_TYPES = ['api_key', 'password', 'token', 'ssh_key', 'certificate', 'other']

async function api(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  }
  if (body) options.body = JSON.stringify(body)
  const response = await fetch(`${API_BASE}${path}`, options)
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Unexpected response (${response.status}) — are you logged in?`)
  }
}

function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d) ? String(ts) : d.toLocaleString()
}

export default function App() {
  const [credentials, setCredentials] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  // add form
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState(CRED_TYPES[0])
  const [value, setValue] = useState('')

  // revealed secrets keyed by credential_name
  const [revealed, setRevealed] = useState({})

  const flash = (msg) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 4000)
  }

  const loadCredentials = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api('/credentials')
      if (!result.success) throw new Error(result.error || 'Failed to load credentials')
      setCredentials(result.credentials || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCredentials() }, [loadCredentials])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!name.trim() || !value.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await api('/credentials/add', 'POST', {
        credential_name: name.trim(),
        credential_type: type,
        credential_value: value
      })
      if (!result.success) throw new Error(result.error || 'Failed to add credential')
      flash(`Credential "${result.credential_name}" stored.`)
      setName(''); setValue(''); setType(CRED_TYPES[0]); setShowForm(false)
      await loadCredentials()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleReveal = async (credName) => {
    if (revealed[credName] !== undefined) {
      setRevealed(prev => {
        const next = { ...prev }
        delete next[credName]
        return next
      })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api(`/credentials/${encodeURIComponent(credName)}`)
      if (!result.success) throw new Error(result.error || 'Failed to fetch credential')
      setRevealed(prev => ({ ...prev, [credName]: result.credential.credential_value }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDeactivate = async (cred) => {
    if (!window.confirm(`Deactivate "${cred.credential_name}"? Its secret will be deleted from Secret Manager.`)) return
    setBusy(true)
    setError(null)
    try {
      const result = await api(`/credentials/${cred.ROWID}`, 'DELETE')
      if (!result.success) throw new Error(result.error || 'Failed to deactivate')
      flash(`Credential "${cred.credential_name}" deactivated.`)
      setRevealed(prev => {
        const next = { ...prev }
        delete next[cred.credential_name]
        return next
      })
      await loadCredentials()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const activeCreds = credentials.filter(c => Number(c.is_active) === 1)
  const inactiveCreds = credentials.filter(c => Number(c.is_active) !== 1)

  return (
    <div className="vault">
      <header className="vault-header">
        <div className="vault-brand">
          <span className="vault-glyph" aria-hidden="true">▣</span>
          <div>
            <h1>Credential Vault</h1>
            <p className="vault-sub">WSM Security · AES-256 encrypted · Catalyst DataStore</p>
          </div>
        </div>
        <div className="vault-actions">
          <button className="btn btn-ghost" onClick={loadCredentials} disabled={loading || busy}>
            ⟳ Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm(s => !s)}>
            {showForm ? '× Cancel' : '+ New credential'}
          </button>
          <a className="btn btn-ghost" href="/server/welcome/logout">Sign out</a>
        </div>
      </header>

      {notice && <div className="banner banner-ok" role="status">{notice}</div>}
      {error && <div className="banner banner-err" role="alert">⚠ {error}</div>}

      {showForm && (
        <form className="card add-form" onSubmit={handleAdd}>
          <h2>Store a new credential</h2>
          <div className="form-grid">
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. github_deploy_key"
                required
                maxLength={100}
                autoFocus
              />
            </label>
            <label>
              <span>Type</span>
              <select value={type} onChange={e => setType(e.target.value)}>
                {CRED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="span-full">
              <span>Secret value</span>
              <textarea
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="Encrypted with AES-256-GCM before storage"
                rows={3}
                required
              />
            </label>
          </div>
          <div className="form-foot">
            <span className="hint">Value is AES-256-GCM encrypted in the function; only ciphertext reaches DataStore.</span>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Storing…' : 'Store credential'}
            </button>
          </div>
        </form>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Active credentials</h2>
          <span className="count">{loading ? '…' : activeCreds.length}</span>
        </div>

        {loading ? (
          <p className="empty">Loading vault…</p>
        ) : activeCreds.length === 0 ? (
          <p className="empty">Vault is empty. Store your first credential with “+ New credential”.</p>
        ) : (
          <table className="cred-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Created</th>
                <th>Secret</th>
                <th className="ta-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeCreds.map(cred => (
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
                    <button
                      className="btn btn-small"
                      onClick={() => handleReveal(cred.credential_name)}
                      disabled={busy}
                    >
                      {revealed[cred.credential_name] !== undefined ? 'Hide' : 'Reveal'}
                    </button>
                    <button
                      className="btn btn-small btn-danger"
                      onClick={() => handleDeactivate(cred)}
                      disabled={busy}
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {inactiveCreds.length > 0 && (
        <section className="card card-muted">
          <div className="card-head">
            <h2>Deactivated</h2>
            <span className="count">{inactiveCreds.length}</span>
          </div>
          <table className="cred-table">
            <tbody>
              {inactiveCreds.map(cred => (
                <tr key={cred.ROWID} className="row-inactive">
                  <td className="mono">{cred.credential_name}</td>
                  <td><span className="tag tag-muted">{cred.credential_type}</span></td>
                  <td className="dim">{formatTime(cred.CREATEDTIME)}</td>
                  <td className="dim">secret deleted</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="vault-foot">
        <span>AES-encrypted at rest · owner-scoped access · Catalyst Serverless</span>
      </footer>
    </div>
  )
}
