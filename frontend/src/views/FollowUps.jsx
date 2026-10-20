import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, AuthError } from '../lib/api';

/**
 * Follow-ups — the chase list.
 *
 * A row is one thing someone is chasing: the task, where its doc/ticket lives, an ETA, the DRI, who
 * gets pinged on Cliq, a status and its evidence. Reminders leave three ways and all three run the
 * same server-side send: the **Remind now** button here, the pre-ETA window, and the overdue
 * repeat — the last two from the daily `followup_reminder_job`.
 *
 * The board is team-wide, like the VM watch list: everyone sees and edits the same rows. Only
 * deleting is narrowed to the person who filed the row (or an admin), because a delete takes the
 * evidence and the reminder history with it.
 *
 * "Notify" is picker-only (2026-10-13 decision). Two live lists back it:
 *
 *   people    GET /api/followups/members  — Cliq's own user directory, `{ id: <zuid>, name }`. A
 *             pick stores the ZUID, which is an opaque id, and the reminder posts straight to it —
 *             no email anywhere in the path. Searched server-side through Cliq's `search` filter,
 *             because the org is larger than any list worth fetching.
 *   channels  GET /api/followups/channels — the Cliq channels the SHARED connection has joined,
 *             which is the credential the cron posts with, so anything pickable is reachable.
 *
 * Nothing is persisted client-side either: both lists are fetched when the form opens, and the
 * member list is fetched once more for the table so a stored `user:<id>` can be shown as a name.
 */

const SCOPES = [
  { key: 'open', label: 'Open' },
  { key: 'mine', label: 'Mine' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

const STATUS_TAG = {
  open: 'tag-muted',
  in_progress: 'tag-good',
  blocked: 'tag-bad',
  done: 'tag-good',
  cancelled: 'tag-muted',
};

const EMPTY_FORM = {
  task: '',
  ref_url: '',
  eta: '',
  dri: '',
  targets: [],
  status: 'open',
  evidence: '',
  remind_before_days: '2',
  overdue_every_days: '1',
};

/** Host only, for the compact link cell — the full URL is the title and the href. */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/**
 * How a target reads in the UI. A channel is its own name; a person is their email, looked up live,
 * because the row itself holds only a ZUID.
 *
 * Email rather than display name: two colleagues share a first name, and "ASHOK" does not say which
 * one was picked. Falls back to the name, then to the bare id — an id on screen means that person
 * no longer resolves in Cliq, which is worth seeing.
 */
const targetText = (t, people) => {
  if (t.type === 'channel') return `#${t.value}`;
  const p = people && people[t.value];
  return (p && (p.email || p.name)) || `user ${t.value} (unresolved)`;
};

const sameTarget = (a, b) => a.type === b.type && String(a.value) === String(b.value);

/**
 * The notify picker: chips for what is chosen, a filtered list to add from.
 *
 * Deliberately not a native <select multiple> — the two lists are different kinds of thing and need
 * a label each, and a person needs to see what they have picked as they pick it.
 */
function TargetPicker({ members, channels, truncated, peopleError, channelError, people, onLearn, selected, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState(null);   // server-side people hits for the current query
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onAway = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onAway);
    return () => document.removeEventListener('mousedown', onAway);
  }, [open]);

  const q = query.trim().toLowerCase();

  /**
   * People are searched on the server, against Cliq's own directory.
   *
   * Not filtered here: the directory is the whole org, so the browser would have to hold all of it
   * to find one person. Cliq's `search` filter matches its own fields, which is what makes the
   * handle people actually know findable — the earlier Catalyst-backed list could not, both because
   * email was stripped from the response and because it only held the five people who had signed
   * into this app. Debounced; Cliq rate-limits this endpoint.
   */
  useEffect(() => {
    if (!q) { setFound(null); setSearchError(''); setSearching(false); return undefined; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api(`/followups/members?q=${encodeURIComponent(q)}`)
        .then((r) => {
          if (cancelled) return;
          const hits = r.members || [];
          setFound(hits);
          setSearchError('');
          // Feed every hit into the shared index. Without this a person picked from a SEARCH is
          // absent from the mount-loaded list, and their chip renders as "USER <zuid>".
          onLearn(hits);
        })
        // Same rule as the mount handler: show what the server said. Swallowing this into an empty
        // list is what made a scope problem look like "nobody by that name".
        .catch((err) => {
          if (cancelled) return;
          setFound([]);
          setSearchError(err instanceof ApiError || err instanceof AuthError
            ? err.message : 'The people search failed.');
        })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q]);

  const options = useMemo(() => {
    const picked = (t) => selected.some((s) => sameTarget(s, t));
    const ch = channels
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.unique_name.toLowerCase().includes(q))
      .map((c) => ({ type: 'channel', value: c.unique_name, label: `#${c.unique_name}`, sub: c.name }))
      .filter((o) => !picked(o));
    // With a query, people come from the server search; without one, from the list loaded on mount.
    const source = q ? (found || []) : members;
    const pe = source
      .map((m) => ({ type: 'user', value: m.id, label: m.email || m.name, sub: m.email ? m.name : '' }))
      .filter((o) => !picked(o));
    return { channels: ch.slice(0, 20), people: pe.slice(0, 20) };
  }, [channels, members, found, q, selected]);

  const add = (o) => { onChange([...selected, { type: o.type, value: o.value }]); setQuery(''); };
  const drop = (t) => onChange(selected.filter((s) => !sameTarget(s, t)));

  const empty = !options.channels.length && !options.people.length;

  /**
   * An empty dropdown has two very different causes and they must not look alike: a query that
   * matched nothing, or a directory that never loaded. Saying how much was searched distinguishes
   * them at a glance — "No match in 13 people · 7 channels" versus "nothing to search".
   */
  const emptyReason = () => {
    if (searching) return 'Searching…';
    if (searchError || peopleError || channelError) return 'See the error above.';
    if (!members.length && !channels.length) {
      return 'The directory is empty — no people and no channels loaded. Check the Zoho Cliq connection in Settings.';
    }
    if (q && !channels.length) return `No match. No channels loaded — check the Zoho Cliq connection in Settings.`;
    if (q) {
      return `No match. Searched Cliq for "${q}" and ${channels.length} channels` +
        `${truncated ? ' (the channel list is capped, so a channel beyond it will not appear)' : ''}.`;
    }
    return 'Everything available is already selected.';
  };

  return (
    <div className="span-full" ref={boxRef}>
      <span style={{ display: 'block', marginBottom: 6 }}>Notify on Cliq</span>

      {selected.length > 0 && (
        <div className="wsm-chips" style={{ marginBottom: 8 }}>
          {selected.map((t) => (
            <button
              key={`${t.type}-${t.value}`}
              type="button"
              className="wsm-chipbtn wsm-chipbtn-on"
              onClick={() => drop(t)}
              title="Remove"
            >
              {targetText(t, people)} ×
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        placeholder={selected.length ? 'Add another channel or person…' : 'Search channels and people…'}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        aria-label="Search notify targets"
      />

      {(peopleError || channelError || searchError) && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {peopleError && <span className="tag tag-bad">People: {peopleError}</span>}
          {channelError && <span className="tag tag-bad">Channels: {channelError}</span>}
          {searchError && !peopleError && <span className="tag tag-bad">Search: {searchError}</span>}
        </div>
      )}

      {open && (
        <div className="card" style={{ marginTop: 6, padding: 8, maxHeight: 240, overflowY: 'auto' }}>
          {empty && <p className="hint" style={{ margin: 4 }}>{emptyReason()}</p>}

          {options.channels.length > 0 && (
            <>
              <div className="sec-title" style={{ margin: '4px 6px' }}>Channels</div>
              {options.channels.map((o) => (
                <button
                  key={`c-${o.value}`}
                  type="button"
                  className="btn btn-ghost btn-small"
                  style={{ display: 'block', width: '100%', textAlign: 'left' }}
                  onClick={() => add(o)}
                >
                  <span className="mono">{o.label}</span>{' '}
                  {o.sub !== o.value && <span className="dim">{o.sub}</span>}
                </button>
              ))}
            </>
          )}

          {options.people.length > 0 && (
            <>
              <div className="sec-title" style={{ margin: '8px 6px 4px' }}>People</div>
              {options.people.map((o) => (
                <button
                  key={`u-${o.value}`}
                  type="button"
                  className="btn btn-ghost btn-small"
                  style={{ display: 'block', width: '100%', textAlign: 'left' }}
                  onClick={() => add(o)}
                >
                  <span className="mono">{o.label}</span>
                  {o.sub && <span className="dim">{'  '}{o.sub}</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <p className="hint" style={{ marginTop: 6 }}>
        People come from Cliq's directory — search by name or handle. Channels are the ones the
        shared Zoho Cliq connection has joined, since a reminder can only reach those.
        {truncated && ' The channel list is capped; a channel beyond the cap will not appear here.'}
      </p>
    </div>
  );
}

/**
 * How a row reads against today, in the same words the Cliq card uses. Purely cosmetic — whether a
 * reminder actually fires is decided server-side in `dueReason`, against an IST day boundary.
 */
function etaNote(row) {
  if (!row.eta) return { text: 'No ETA', tone: 'dim' };
  const day = new Date();
  const todayUtc = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const eta = Date.parse(`${row.eta}T00:00:00Z`);
  if (Number.isNaN(eta)) return { text: row.eta, tone: 'dim' };
  const days = Math.round((eta - todayUtc) / 86400000);
  if (['done', 'cancelled'].includes(row.status)) return { text: row.eta, tone: 'dim' };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: 'bad' };
  if (days === 0) return { text: 'Due today', tone: 'warn' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'warn' };
  if (days <= 7) return { text: `in ${days}d`, tone: 'muted' };
  return { text: row.eta, tone: 'dim' };
}

/** The add/edit form. One component for both — `editing` only changes the verb and the target. */
function FollowUpForm({ editing, form, setField, onSubmit, onCancel, busy, error, directory, people, onLearn }) {
  return (
    <section className="card add-form">
      <div className="sec-title">{editing ? 'Edit follow-up' : 'New follow-up'}</div>
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="span-full" htmlFor="fu-task">
            <span>Task</span>
            <input
              id="fu-task"
              type="text"
              placeholder="Close out the Q3 DPIA review for Log360 Cloud"
              value={form.task}
              onChange={(e) => setField('task', e.target.value)}
              maxLength={500}
              required
            />
          </label>

          <label className="span-full" htmlFor="fu-ref">
            <span>Associated doc / task / project link</span>
            <input
              id="fu-ref"
              type="url"
              placeholder="https://projects.zoho.in/portal/…"
              value={form.ref_url}
              onChange={(e) => setField('ref_url', e.target.value)}
              maxLength={500}
            />
          </label>

          <label htmlFor="fu-eta">
            <span>ETA</span>
            <input
              id="fu-eta"
              type="date"
              value={form.eta}
              onChange={(e) => setField('eta', e.target.value)}
            />
          </label>

          <label htmlFor="fu-dri">
            <span>DRI</span>
            <input
              id="fu-dri"
              type="text"
              placeholder="Who owns this"
              value={form.dri}
              onChange={(e) => setField('dri', e.target.value)}
              maxLength={120}
            />
          </label>

          <label htmlFor="fu-status">
            <span>Status</span>
            <select id="fu-status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>

          <TargetPicker
            members={directory.members}
            channels={directory.channels}
            truncated={directory.truncated}
            peopleError={directory.peopleError}
            channelError={directory.channelError}
            people={people}
            onLearn={onLearn}
            selected={form.targets}
            onChange={(next) => setField('targets', next)}
          />

          <label htmlFor="fu-before">
            <span>Remind this many days before the ETA</span>
            <input
              id="fu-before"
              type="number"
              min="0"
              max="90"
              value={form.remind_before_days}
              onChange={(e) => setField('remind_before_days', e.target.value)}
            />
          </label>

          <label htmlFor="fu-overdue">
            <span>Once overdue, remind every N days</span>
            <input
              id="fu-overdue"
              type="number"
              min="0"
              max="90"
              value={form.overdue_every_days}
              onChange={(e) => setField('overdue_every_days', e.target.value)}
            />
          </label>

          <label className="span-full" htmlFor="fu-evidence">
            <span>Evidence</span>
            <textarea
              id="fu-evidence"
              rows={3}
              placeholder="What proves this is done — a link, a build number, an approval, a screenshot path."
              value={form.evidence}
              onChange={(e) => setField('evidence', e.target.value)}
            />
          </label>
        </div>

        {error && <div className="banner banner-err" role="alert" style={{ marginTop: 14 }}>{error}</div>}

        <div className="form-foot">
          <p className="hint">
            Either day count at <span className="mono">0</span> switches that half of the schedule
            off — the row stays tracked and is chased only by hand.
          </p>
          <div>
            {editing && (
              <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ marginRight: 8 }}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : (editing ? 'Save changes' : 'Add follow-up')}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

/**
 * The log stores `user:<id>` rather than a name (nothing identifying at rest), so the history view
 * swaps ids for names at render time. An id with no match is shown as-is — that member has been
 * removed from the app, which is worth seeing rather than hiding.
 */
function resolveLogTargets(targets, people) {
  return String(targets || '')
    .split(', ')
    .map((part) => {
      const m = /^user:(\d+)$/.exec(part.trim());
      if (!m) return part;
      const p = people[m[1]];
      return (p && (p.email || p.name)) || `user ${m[1]} (unresolved)`;
    })
    .join(', ');
}

export default function FollowUps({ onNotice }) {
  const [rows, setRows] = useState([]);
  const [scope, setScope] = useState('open');
  const [status, setStatus] = useState('loading'); // 'loading' | 'ok' | 'error'
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openLog, setOpenLog] = useState(null); // { id, reminders }
  const [directory, setDirectory] = useState({
    members: [], channels: [], truncated: false, peopleError: '', channelError: '',
  });

  const load = useCallback((which) => {
    setStatus('loading');
    api(`/followups?scope=${encodeURIComponent(which)}`)
      .then((r) => { setRows(r.follow_ups || []); setStatus('ok'); setLoadError(''); })
      .catch((err) => {
        setStatus('error');
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the follow-ups.');
      });
  }, []);

  useEffect(() => { load(scope); }, [load, scope]);

  /**
   * Everyone the UI has learned about, `zuid → { name, email }`.
   *
   * Accumulating rather than derived, because a ZUID can arrive from three places: the list loaded
   * on mount, a search result the user picked, or a stored row whose person is outside the loaded
   * page. Deriving it from any one of those left the others rendering as "USER <zuid>".
   */
  const [people, setPeople] = useState({});

  const learnPeople = useCallback((rows) => {
    if (!rows || !rows.length) return;
    setPeople((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of rows) {
        if (!p || !p.id) continue;
        const existing = next[p.id];
        if (!existing || existing.email !== p.email || existing.name !== p.name) {
          next[p.id] = { name: p.name, email: p.email || '' };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /**
   * The two notify directories, read live.
   *
   * Members load on mount because the table itself needs them — a row stores `user:<id>` and has to
   * render a name. Channels load with them; both are small and the channel call is memoised
   * server-side for 60s, which matters because Cliq locks that endpoint after 20 calls a minute.
   *
   * A channel-list failure is shown but does not block the screen: the usual cause is a Cliq
   * connection made before the ZohoCliq.Channels.READ scope existed, and the fix is to reauthorize
   * it in Settings — meanwhile every existing row still works.
   */
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api('/followups/members'), api('/followups/channels')])
      .then(([m, c]) => {
        if (cancelled) return;
        /**
         * Keep the SERVER's message, per directory.
         *
         * The first version of this collapsed a people-list failure into the fixed string "Could
         * not load the people list", which discarded the one thing worth reading: the 424 that
         * names the missing Cliq scope and says to reauthorize. A generic message where a specific
         * one exists is worse than no message — it looks like a diagnosis and is not one.
         */
        const reason = (settled, fallback) => {
          if (settled.status !== 'rejected') return '';
          const e = settled.reason;
          return (e instanceof ApiError || e instanceof AuthError) && e.message ? e.message : fallback;
        };
        setDirectory({
          members: m.status === 'fulfilled' ? (m.value.members || []) : [],
          channels: c.status === 'fulfilled' ? (c.value.channels || []) : [],
          truncated: c.status === 'fulfilled' ? Boolean(c.value.truncated) : false,
          peopleError: reason(m, 'Could not load the people list.'),
          channelError: reason(c, 'Could not load Cliq channels.'),
        });
        if (m.status === 'fulfilled') learnPeople(m.value.members || []);
      });
    return () => { cancelled = true; };
  }, [learnPeople]);

  // The rail shows a count per section; views own their own totals (see useSectionCounts in App).
  useEffect(() => {
    if (status !== 'ok') return;
    window.dispatchEvent(new CustomEvent('wsm:section-count', {
      detail: { path: '/follow-ups', count: rows.length },
    }));
  }, [rows.length, status]);

  /**
   * Resolve ZUIDs that appear in rows but not yet in the index — a follow-up filed months ago, or a
   * person outside the page loaded on mount. One request for the batch rather than one per row.
   */
  useEffect(() => {
    const missing = [...new Set(
      rows.flatMap((r) => (r.notify_targets || [])
        .filter((t) => t.type === 'user' && !people[t.value])
        .map((t) => t.value)),
    )];
    if (!missing.length) return undefined;

    let cancelled = false;
    api(`/followups/people?ids=${encodeURIComponent(missing.slice(0, 25).join(','))}`)
      .then((r) => { if (!cancelled) learnPeople(Object.values(r.people || {})); })
      .catch(() => { /* an unresolved id renders as such; not worth an error banner */ });
    return () => { cancelled = true; };
  }, [rows, people, learnPeople]);

  const setField = useCallback((key, value) => setForm((f) => ({ ...f, [key]: value })), []);

  const startAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm((s) => !s);
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setForm({
      task: row.task,
      ref_url: row.ref_url,
      eta: row.eta,
      dri: row.dri,
      targets: row.notify_targets || [],
      status: row.status,
      evidence: row.evidence,
      remind_before_days: String(row.remind_before_days),
      overdue_every_days: String(row.overdue_every_days),
    });
    setFormError('');
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    const body = { ...form, notify_targets: form.targets };
    delete body.targets;
    try {
      if (editingId) {
        await api(`/followups/${editingId}`, { method: 'PATCH', body });
        onNotice?.('Follow-up updated.');
      } else {
        await api('/followups', { method: 'POST', body });
        onNotice?.('Follow-up added.');
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      setEditingId(null);
      load(scope);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Saving the follow-up failed.');
    } finally {
      setBusy(false);
    }
  };

  const patch = async (row, body, note) => {
    setBusy(true);
    try {
      await api(`/followups/${row.id}`, { method: 'PATCH', body });
      if (note) onNotice?.(note);
      load(scope);
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Could not update that follow-up.');
    } finally {
      setBusy(false);
    }
  };

  const remind = async (row) => {
    setBusy(true);
    try {
      const r = await api(`/followups/${row.id}/remind`, { method: 'POST' });
      if (r.status === 'sent') onNotice?.(`Reminder sent to ${(row.notify_targets || []).map((t) => targetText(t, people)).join(', ')}.`);
      else if (r.status === 'partial') onNotice?.(`Partly sent — ${r.error}`);
      else onNotice?.(r.error || 'The reminder did not go out.');
      load(scope);
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Sending the reminder failed.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    setBusy(true);
    try {
      await api(`/followups/${row.id}`, { method: 'DELETE' });
      onNotice?.('Follow-up removed.');
      load(scope);
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Could not remove that follow-up.');
    } finally {
      setBusy(false);
    }
  };

  const toggleLog = async (row) => {
    if (openLog && openLog.id === row.id) { setOpenLog(null); return; }
    try {
      const r = await api(`/followups/${row.id}/reminders`);
      setOpenLog({ id: row.id, reminders: r.reminders || [] });
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Could not read the reminder history.');
    }
  };

  /** A dry sweep answers "who gets chased today" without posting anything. */
  const previewSweep = async () => {
    setBusy(true);
    try {
      const r = await api('/followups/sweep', { method: 'POST', body: { dry_run: true } });
      onNotice?.(r.due
        ? `${r.due} of ${r.considered} follow-up(s) would be chased today.`
        : `Nothing is due today (${r.considered} checked).`);
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : 'Could not run the preview.');
    } finally {
      setBusy(false);
    }
  };

  const overdue = useMemo(
    () => rows.filter((r) => etaNote(r).tone === 'bad').length,
    [rows],
  );

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Follow-ups</h2>
          <p className="view-sub">
            Track what is being chased, and remind the people on it over Cliq — now, before the ETA,
            or every day it stays overdue
          </p>
        </div>
        <div className="view-actions">
          <button type="button" className="btn btn-ghost" onClick={previewSweep} disabled={busy}>
            Preview today's sweep
          </button>
          <button
            type="button"
            className={showForm && !editingId ? 'btn btn-ghost' : 'btn btn-primary'}
            onClick={startAdd}
            style={{ marginLeft: 8 }}
          >
            {showForm && !editingId ? 'Cancel' : 'Add follow-up'}
          </button>
        </div>
      </div>

      {showForm && (
        <FollowUpForm
          editing={!!editingId}
          form={form}
          setField={setField}
          onSubmit={submit}
          onCancel={() => { setShowForm(false); setEditingId(null); }}
          busy={busy}
          error={formError}
          directory={directory}
          people={people}
          onLearn={learnPeople}
        />
      )}

      <section className="card">
        <div className="card-head">
          <h2>Chase list</h2>
          <div className="wsm-chips">
            {SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`wsm-chipbtn${scope === s.key ? ' wsm-chipbtn-on' : ''}`}
                onClick={() => setScope(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {status === 'ok' && <span className="count">{rows.length}</span>}
          {status === 'ok' && overdue > 0 && <span className="tag tag-bad">{overdue} overdue</span>}
        </div>

        {status === 'loading' && <p className="hint">Loading…</p>}
        {status === 'error' && <div className="banner banner-err" role="alert">{loadError}</div>}

        {status === 'ok' && !rows.length && (
          <p className="empty">Nothing here — add a follow-up to start chasing something.</p>
        )}

        {status === 'ok' && rows.length > 0 && (
          <div className="table-scroll">
            <table className="cred-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>ETA</th>
                  <th>DRI</th>
                  <th>Notifies</th>
                  <th>Status</th>
                  <th>Evidence</th>
                  <th className="ta-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const note = etaNote(row);
                  const logOpen = openLog && openLog.id === row.id;
                  return [
                    <tr key={row.id} className={row.is_active ? undefined : 'row-inactive'}>
                      <td>
                        <span className="strong">{row.task}</span>
                        {row.ref_url && (
                          <div className="dim">
                            <a href={row.ref_url} target="_blank" rel="noreferrer" title={row.ref_url}>
                              {hostOf(row.ref_url)}
                            </a>
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="mono">{row.eta || <span className="dim">—</span>}</div>
                        {row.eta && (
                          <span className={note.tone === 'bad' ? 'tag tag-bad' : note.tone === 'warn' ? 'tag tag-warn' : 'dim'}>
                            {note.text}
                          </span>
                        )}
                      </td>
                      <td>{row.dri || <span className="dim">—</span>}</td>
                      <td>
                        {(row.notify_targets || []).length
                          ? (row.notify_targets || []).map((t) => (
                            <div className="dim" key={`${t.type}-${t.value}`}>{targetText(t, people)}</div>
                          ))
                          : <span className="tag tag-warn">nobody</span>}
                        {row.last_reminded_at && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            onClick={() => toggleLog(row)}
                            style={{ marginTop: 4 }}
                          >
                            {logOpen ? 'Hide history' : 'History'}
                          </button>
                        )}
                      </td>
                      <td>
                        <select
                          value={row.status}
                          onChange={(e) => patch(row, { status: e.target.value }, 'Status updated.')}
                          disabled={busy}
                          aria-label={`Status for ${row.task}`}
                        >
                          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <div>
                          <span className={`tag ${STATUS_TAG[row.status] || 'tag-muted'}`}>
                            {row.is_active ? 'reminders on' : 'paused'}
                          </span>
                        </div>
                      </td>
                      <td className="dim" title={row.evidence}>
                        {row.evidence
                          ? `${row.evidence.slice(0, 80)}${row.evidence.length > 80 ? '…' : ''}`
                          : <span className="tag tag-muted">none yet</span>}
                      </td>
                      <td className="ta-right">
                        <button type="button" className="btn btn-primary btn-small" onClick={() => remind(row)} disabled={busy}>
                          Remind now
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={() => patch(row, { is_active: !row.is_active }, row.is_active ? 'Reminders paused.' : 'Reminders resumed.')}
                          disabled={busy}
                          style={{ marginLeft: 6 }}
                        >
                          {row.is_active ? 'Pause' : 'Resume'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => startEdit(row)} style={{ marginLeft: 6 }}>
                          Edit
                        </button>
                        <button type="button" className="btn btn-danger btn-small" onClick={() => remove(row)} disabled={busy} style={{ marginLeft: 6 }}>
                          Delete
                        </button>
                      </td>
                    </tr>,
                    logOpen ? (
                      <tr key={`${row.id}-log`}>
                        <td colSpan={7}>
                          {openLog.reminders.length ? (
                            <ul className="wsm-dashlist">
                              {openLog.reminders.map((r) => (
                                <li className="wsm-dashitem" key={r.id}>
                                  <span className="mono">{r.sent_at}</span>
                                  {' · '}{r.trigger}{' · '}
                                  <span className={`tag ${r.status === 'sent' ? 'tag-good' : 'tag-bad'}`}>{r.status}</span>
                                  {' · '}<span className="dim">{resolveLogTargets(r.targets, people)}</span>
                                  {r.error && <div className="dim">{r.error}</div>}
                                </li>
                              ))}
                            </ul>
                          ) : <p className="hint">No reminders sent yet.</p>}
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="hint" style={{ marginTop: 12 }}>
          Scheduled reminders go out once a day from the <span className="mono">followup_reminders</span> task in <span className="mono">scheduler_job</span>,
          posting through the shared Zoho Cliq connection. Paused rows and rows marked done or
          cancelled are skipped; <strong>Remind now</strong> always sends.
        </p>
      </section>
    </>
  );
}
