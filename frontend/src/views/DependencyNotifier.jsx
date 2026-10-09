import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * VM Manager > Dependency Upgrade Notifier — the configuration screen (part 1 of the tool).
 *
 * A row here says: watch THIS release-notes page for a new version of THIS dependency, and announce
 * it on THAT channel. The cron that actually polls and posts is part 2 and reads these same rows;
 * until it ships, "Current version" and "Last checked" stay blank on every row.
 *
 * The type of each link is **detected from the link itself** (GET /api/vm/detect) rather than picked
 * from a dropdown — pasting a `learn.zoho.in` URL is already unambiguous. The select is still there
 * as an override for the cases a hostname can't settle (a Writer doc served off `zohoapis`), and it
 * follows the detection until someone touches it.
 */

const TYPE_LABELS = {
  cliq: 'Cliq',
  learn: 'Learn',
  connect: 'Connect',
  writer: 'Writer',
  internal: 'Internal link',
};

const TYPES = Object.keys(TYPE_LABELS);

/** Connections that exist in connections-registry.js today. `zoho-connect` deliberately does not. */
const REGISTERED = new Set(['zoho-cliq', 'zoho-learn', 'zoho-writer']);

const EMPTY_FORM = {
  name: '',
  release_url: '',
  release_type: '',
  notify_url: '',
  notify_type: '',
  version_pattern: '',
};

/** Host only, for the compact link cell — the full URL is the title/href. */
function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function TypeTag({ type }) {
  if (!type) return null;
  return <span className="tag tag-muted">{TYPE_LABELS[type] || type}</span>;
}

/**
 * A URL field plus the type it resolved to. Detection is debounced against /api/vm/detect so the
 * regex lives in exactly one place (vm-service.js) rather than being mirrored into the browser.
 */
function LinkField({ id, label, hint, url, type, onUrl, onType }) {
  const [detected, setDetected] = useState(null);
  const [error, setError] = useState('');
  const touchedType = useRef(false);

  useEffect(() => {
    const raw = url.trim();
    if (!raw) { setDetected(null); setError(''); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api(`/vm/detect?url=${encodeURIComponent(raw)}`)
        .then((r) => {
          if (cancelled) return;
          setError('');
          setDetected(r);
          if (!touchedType.current) onType(r.type);
        })
        .catch((err) => {
          if (cancelled) return;
          setDetected(null);
          setError(err instanceof ApiError ? err.message : 'Could not read that link.');
        });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [url, onType]);

  const needsConnection = detected && detected.connection_key;
  const unregistered = needsConnection && !REGISTERED.has(detected.connection_key);

  return (
    <>
      <label className="span-full" htmlFor={id}>
        <span>{label}</span>
        <input
          id={id}
          type="url"
          placeholder="https://learn.zoho.in/portal/…/article/release-notes"
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          required
        />
      </label>

      <label htmlFor={`${id}-type`}>
        <span>Type</span>
        <select
          id={`${id}-type`}
          value={type || ''}
          onChange={(e) => { touchedType.current = true; onType(e.target.value); }}
        >
          <option value="" disabled>Paste a link…</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
      </label>

      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <p className="hint" style={{ margin: 0 }}>
          {error && <span className="tag tag-bad">{error}</span>}
          {!error && detected && (
            <>
              {detected.confident ? 'Detected' : 'Assumed'} <strong>{TYPE_LABELS[detected.type]}</strong>
              {' · '}<span className="mono">{detected.host}</span>
              {unregistered && (
                <>
                  {' · '}
                  <span className="tag tag-warn">{detected.connection_key} not configured</span>
                </>
              )}
            </>
          )}
          {!error && !detected && hint}
        </p>
      </div>
    </>
  );
}

export default function DependencyNotifier({ onNotice }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ok' | 'error'
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setStatus('loading');
    api('/vm/dependencies')
      .then((r) => { setRows(r.dependencies || []); setStatus('ok'); setLoadError(''); })
      .catch((err) => {
        setStatus('error');
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the watch list.');
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const setField = useCallback((key, value) => setForm((f) => ({ ...f, [key]: value })), []);
  const setReleaseUrl = useCallback((v) => setField('release_url', v), [setField]);
  const setReleaseType = useCallback((v) => setField('release_type', v), [setField]);
  const setNotifyUrl = useCallback((v) => setField('notify_url', v), [setField]);
  const setNotifyType = useCallback((v) => setField('notify_type', v), [setField]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api('/vm/dependencies', { method: 'POST', body: form });
      setForm(EMPTY_FORM);
      setShowForm(false);
      onNotice?.(`Now watching ${form.name.trim()}.`);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Saving the dependency failed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row) => {
    setBusy(true);
    try {
      await api(`/vm/dependencies/${row.id}`, { method: 'PATCH', body: { is_active: !row.is_active } });
      load();
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Could not change that dependency.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    setBusy(true);
    try {
      await api(`/vm/dependencies/${row.id}`, { method: 'DELETE' });
      onNotice?.(`Stopped watching ${row.name}.`);
      load();
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Could not remove that dependency.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Dependency Upgrade Notifier</h2>
          <p className="view-sub">
            Watch a dependency's release-notes page and announce every new version on a channel
          </p>
        </div>
        <div className="view-actions">
          <button
            type="button"
            className={showForm ? 'btn btn-ghost' : 'btn btn-primary'}
            onClick={() => { setShowForm((s) => !s); setFormError(''); }}
          >
            {showForm ? 'Cancel' : 'Add dependency'}
          </button>
        </div>
      </div>

      {showForm && (
        <section className="card add-form">
          <div className="sec-title">New watched dependency</div>
          <form onSubmit={submit}>
            <div className="form-grid">
              <label className="span-full" htmlFor="dep-name">
                <span>Dependency name</span>
                <input
                  id="dep-name"
                  type="text"
                  placeholder="Stratus Client"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  maxLength={100}
                  required
                />
              </label>

              <LinkField
                id="dep-release"
                label="Release notes page"
                hint="Connect feed, Learn article, Cliq channel, Writer doc or an internal page."
                url={form.release_url}
                type={form.release_type}
                onUrl={setReleaseUrl}
                onType={setReleaseType}
              />

              <LinkField
                id="dep-notify"
                label="Notification channel"
                hint="Where the new-version message is posted — e.g. a Cliq bot webhook."
                url={form.notify_url}
                type={form.notify_type}
                onUrl={setNotifyUrl}
                onType={setNotifyType}
              />

              <label className="span-full" htmlFor="dep-pattern">
                <span>Version pattern (optional)</span>
                <input
                  id="dep-pattern"
                  type="text"
                  className="mono"
                  placeholder="STRATUS[_\s-]*CLIENT[_\s-]+(\d+\.\d+\.\d+)"
                  value={form.version_pattern}
                  onChange={(e) => setField('version_pattern', e.target.value)}
                  maxLength={255}
                />
              </label>
            </div>

            {formError && <div className="banner banner-err" role="alert" style={{ marginTop: 14 }}>{formError}</div>}

            <div className="form-foot">
              <p className="hint">
                Leave the pattern blank to match a plain <span className="mono">1.2.3</span> version.
                Nothing is fetched yet — the scheduled check is the next piece of this tool.
              </p>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Start watching'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Watched dependencies</h2>
          {status === 'ok' && <span className="count">{rows.length}</span>}
        </div>

        {status === 'loading' && <p className="hint">Loading…</p>}
        {status === 'error' && <div className="banner banner-err" role="alert">{loadError}</div>}

        {status === 'ok' && !rows.length && (
          <p className="empty">Nothing is being watched yet — add a dependency to get started.</p>
        )}

        {status === 'ok' && rows.length > 0 && (
          <div className="table-scroll">
            <table className="cred-table">
              <thead>
                <tr>
                  <th>Dependency</th>
                  <th>Release notes</th>
                  <th>Notifies</th>
                  <th>Current version</th>
                  <th>Last checked</th>
                  <th className="ta-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.is_active ? undefined : 'row-inactive'}>
                    <td>
                      <span className="strong">{row.name}</span>
                      <div className="dim mono">{row.key}</div>
                    </td>
                    <td>
                      <TypeTag type={row.release_type} />
                      <div className="dim">
                        <a href={row.release_url} target="_blank" rel="noreferrer" title={row.release_url}>
                          {hostOf(row.release_url)}
                        </a>
                      </div>
                    </td>
                    <td>
                      <TypeTag type={row.notify_type} />
                      <div className="dim" title={row.notify_url}>{hostOf(row.notify_url)}</div>
                    </td>
                    <td className="mono">{row.current_version || <span className="dim">—</span>}</td>
                    <td className="dim">{row.last_checked_at || 'never'}</td>
                    <td className="ta-right">
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => toggleActive(row)}
                        disabled={busy}
                      >
                        {row.is_active ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-small"
                        onClick={() => remove(row)}
                        disabled={busy}
                        style={{ marginLeft: 8 }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="hint" style={{ marginTop: 12 }}>
          Paused rows stay configured but are skipped by the scheduled check.
        </p>
      </section>
    </>
  );
}
