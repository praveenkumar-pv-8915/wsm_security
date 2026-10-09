import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Configuration > Compliance — the team-name allow-list that Risk Register's "Sync from Creator"
 * and DMS Manager's document list both filter on (one shared setting, `tool_config` table,
 * TOOL_KEY = 'Compliance_manager', CONFIG_KEY = 'team_names' — see datastore-conventions.md).
 *
 * Moved here (2026-09-01) from the gear-icon "Risk Register settings" modal — the setting is
 * whole-app, not Risk-Register-specific, so it belongs in Configuration rather than behind a
 * button on one module's toolbar.
 *
 * `/api/team-filters` (GET/POST/DELETE) is the existing endpoint — same one the old modal used,
 * unchanged here.
 */
export default function ComplianceConfig({ onNotice }) {
  const [teams, setTeams] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ok' | 'error'
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setStatus('loading');
    api('/team-filters')
      .then((r) => { setTeams(r.teams || []); setStatus('ok'); })
      .catch((err) => {
        setStatus('error');
        onNotice?.(err instanceof ApiError ? err.message : 'Could not load teams synced.');
      });
  }, [onNotice]);

  useEffect(() => { load(); }, [load]);

  const addTeam = async () => {
    const name = draft.trim();
    if (!name || teams.some((t) => t.team_name === name)) { setDraft(''); return; }
    setBusy(true);
    try {
      await api('/team-filters', { method: 'POST', body: { team_name: name } });
      setDraft('');
      load();
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Adding the team failed.');
    } finally {
      setBusy(false);
    }
  };

  const removeTeam = async (teamName) => {
    setBusy(true);
    try {
      await api(`/team-filters/${encodeURIComponent(teamName)}`, { method: 'DELETE' });
      load();
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Removing the team failed.');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTeam(); }
    else if (e.key === 'Backspace' && !draft && teams.length) removeTeam(teams[teams.length - 1].team_name);
  };

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Compliance</h2>
          <p className="view-sub">
            Teams synced · Risk Register and DMS Manager only pull records for the teams listed here
          </p>
        </div>
      </div>

      <section className="card">
        <div className="sec-title">Teams synced</div>

        <div className="tag-input" onClick={() => document.getElementById('compliance-team-input')?.focus()}>
          {teams.map((t) => (
            <span key={t.team_name} className="tag tag-muted">
              {t.team_name}
              <button
                type="button"
                onClick={() => removeTeam(t.team_name)}
                disabled={busy}
                aria-label={`Remove ${t.team_name}`}
                style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            id="compliance-team-input"
            type="text"
            className="tag-input-field"
            placeholder={teams.length ? 'Add another team…' : 'Exact Zoho Creator Team_Name…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={addTeam}
            disabled={busy}
          />
        </div>

        {status === 'ok' && !teams.length && (
          <p className="hint" style={{ marginTop: 8 }}>No teams configured yet — type a team name and press Enter.</p>
        )}

        <p className="hint" style={{ marginTop: 10 }}>
          Press Enter to add a team. Sync from Creator only pulls records for the teams listed
          here — add or remove one, then click Sync from Creator to pick it up, no redeploy needed.
        </p>
      </section>
    </>
  );
}
