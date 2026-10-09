/**
 * VM Manager > Dependency Upgrade Notifier — configuration.
 *
 * Part 1 of a two-part tool (2026-09-17). This file is the configuration half: what we watch and
 * where we announce it. The cron half — fetch each release-notes page, diff against the versions
 * already seen, post to the notification channel — is a later pass and reads the same rows.
 *
 * Prior art: `agent-knowledge-kit/src/vm_management` (Python). That tool already scans Zoho Connect
 * feeds, Learn articles and internal corp HTML, diffs versions and posts a consolidated Cliq
 * notification — but its configuration is a checked-in `config.json` on one developer's Mac, and
 * its run state a sibling `data/releases.json`. This module moves both into DataStore so the team
 * can edit the first from the UI and the cron can own the second.
 *
 * ── Storage: two generic tables, no bespoke one ──────────────────────────────────────────────
 *
 * A dedicated `vm_dependencies` table was designed and then dropped (2026-09-17) once it was clear
 * every column it added was either unused or derivable. What actually mattered was the split
 * between who writes what, and that is expressible with the existing generic stores:
 *
 *   `tool_config`, TOOL_KEY = 'vm_notifier'       — human-written, one row per dependency.
 *                                                   CONFIG_KEY is the dependency key; CONFIG_VALUE
 *                                                   is the JSON below.
 *   `tool_state`,  TOOL_KEY = 'vm_notifier'       — cron-written, one row per dependency. CURSOR is
 *                                                   the Connect watermark, STATE_VALUE holds the
 *                                                   seen-version list and resolved source ids.
 *
 * One row per dependency, not one row holding an array of them, for two reasons: per-row writes
 * can't clobber each other, and the 10,000-char CONFIG_VALUE cap then applies per dependency rather
 * than to the whole list (which would have filled silently at roughly 20–30 of them).
 *
 * The config/state split means the cron never writes a row the UI writes, so the two cannot race at
 * all — which is a better guarantee than getting row granularity right on a single store.
 *
 * ── Shape of one CONFIG_VALUE ────────────────────────────────────────────────────────────────
 *   {
 *     name:            'Stratus Client',
 *     release_url:     'https://connect.zoho.in/portal/intranet/group/stratus-client/feed',
 *     release_type:    'connect',
 *     notify_url:      'https://cliq.zoho.in/api/v2/bots/vmwatcher/message?zapikey=…',
 *     notify_type:     'cliq',
 *     version_pattern: 'STRATUS[_\\s-]*CLIENT[_\\s_-]+(\\d+\\.\\d+\\.\\d+)',
 *     is_active:       true,
 *     extra_config:    { … } | null,
 *     owner_id:        '<catalyst user_id>',
 *     created_at:      '2026-09-17T09:00:00Z'
 *   }
 *
 * `notify_url` holds a Cliq bot webhook, which carries a zapikey. It is returned only to an
 * authenticated member and never logged. Neither of these tables is a secret store: a real OAuth
 * credential still belongs in `connection_credentials` (connections-service.js).
 */

const { readConfig, setConfig, listConfig, deleteConfig } = require('./tool-config-service');
const { listState, deleteState } = require('./tool-state-service');
const { compilePattern } = require('./vm-version-util');
const notifications = require('./vm-notifications-service');

/** Both stores are namespaced by this; `tool_state` keeps its rows under the same key. */
const TOOL_KEY = 'vm_notifier';

const fail = (error, status = 400) => ({ success: false, error, status });

/* ------------------------------------------------------------------ link → source type */

/**
 * Identify a link.
 *
 * The rule for this feature: **the connection is identified from the link**, not picked from a
 * dropdown. Pasting a `learn.zoho.in` URL already says which API will read it and which stored
 * credential that read needs. The form still allows an override, because a host can be reachable
 * two ways (a Writer doc served off `zohoapis`) and whoever pasted the link knows better.
 *
 * `connection_key` names the entry in connections-registry.js whose credential the cron will need.
 * `null` means none is required — an internal corp page is fetched unauthenticated, exactly as
 * `vm_management/lib/sources.py::scan_html` does today.
 *
 * NOTE: `zoho-connect` is deliberately NOT in connections-registry.js yet. Connect links classify
 * correctly and save fine, but the service has to be registered with a reviewed scope list before
 * the cron can read a feed — scopes are a security boundary that belongs in a diff. The UI shows
 * that as "not configured" rather than silently accepting an unusable row.
 */
const SOURCE_TYPES = ['cliq', 'learn', 'connect', 'writer', 'internal'];

const DETECTORS = [
  { type: 'connect', connection_key: 'zoho-connect', host: /(^|\.)connect\.zoho(corp)?\./i },
  { type: 'learn', connection_key: 'zoho-learn', host: /(^|\.)learn\.zoho(corp)?\./i },
  { type: 'cliq', connection_key: 'zoho-cliq', host: /(^|\.)cliq\.zoho(corp)?\./i },
  { type: 'writer', connection_key: 'zoho-writer', host: /(^|\.)(writer\.zoho|docs\.zoho|www\.zohoapis)\./i },
];

/** Corp-internal hosts — no OAuth, plain GET (internals.csez.zohocorpin.com and friends). */
const INTERNAL_HOST = /(^|\.)(zohocorpin\.com|csez\.zohocorp\.com|zohocorpcloud\.in)$/i;

function detectSource(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return { ok: false, error: 'Enter a link first.' };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ok: false, error: 'Only http and https links are supported.' };
  }

  const host = parsed.hostname;
  for (const d of DETECTORS) {
    if (d.host.test(host)) {
      return { ok: true, url, host, type: d.type, connection_key: d.connection_key, confident: true };
    }
  }
  return {
    ok: true,
    url,
    host,
    type: 'internal',
    connection_key: null,
    // An unrecognised host is *assumed* internal rather than rejected — that is what the WMS API
    // source in the Python config already is. Flagged so the UI says "assumed", not "detected".
    confident: INTERNAL_HOST.test(host),
  };
}

/* ------------------------------------------------------------------ validation */

/** `Stratus Client` → `stratus_client`, matching the Python config's dependency keys. */
function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

const LIMITS = { name: 100, release_url: 255, notify_url: 255, version_pattern: 255 };

/**
 * Validate and normalise a create/update body into the stored JSON's fields.
 * Returns `{ error }` on the first problem, otherwise `{ values }`.
 *
 * The length caps are app-level here rather than DataStore Var Char limits, since everything lives
 * in one Text column now. They are kept at the same numbers the dropped table used, so a later move
 * back to real columns wouldn't have to truncate anything.
 */
function buildValues(body, { partial = false } = {}) {
  const b = body || {};
  const values = {};

  if (!partial || b.name !== undefined) {
    const name = String(b.name || '').trim();
    if (!name) return { error: 'Dependency name is required.' };
    if (name.length > LIMITS.name) return { error: `Dependency name must be ${LIMITS.name} characters or fewer.` };
    values.name = name;
  }

  for (const [field, label] of [['release', 'Release notes page'], ['notify', 'Notification channel']]) {
    const urlKey = `${field}_url`;
    const typeKey = `${field}_type`;
    if (partial && b[urlKey] === undefined && b[typeKey] === undefined) continue;

    const raw = String(b[urlKey] || '').trim();
    if (!raw) return { error: `${label} link is required.` };
    if (raw.length > LIMITS[urlKey]) return { error: `${label} link must be ${LIMITS[urlKey]} characters or fewer.` };

    const detected = detectSource(raw);
    if (!detected.ok) return { error: `${label}: ${detected.error}` };

    // The link decides the type; an explicit type only overrides it, and only to a known one.
    const chosen = b[typeKey] ? String(b[typeKey]).trim().toLowerCase() : detected.type;
    if (!SOURCE_TYPES.includes(chosen)) {
      return { error: `${label} type must be one of: ${SOURCE_TYPES.join(', ')}.` };
    }
    values[urlKey] = raw;
    values[typeKey] = chosen;
  }

  if (!partial || b.version_pattern !== undefined) {
    const pattern = String(b.version_pattern || '').trim();
    if (pattern.length > LIMITS.version_pattern) {
      return { error: `Version pattern must be ${LIMITS.version_pattern} characters or fewer.` };
    }
    if (pattern) {
      // Reject a broken regex here rather than letting the job throw on it at 6am.
      //
      // Compiled through compilePattern, not `new RegExp`, because the patterns people paste come
      // from the Python tool's config.json and two of them start with `(?i)` — inline flag syntax
      // JavaScript rejects outright. `new RegExp('(?i)(M2...)')` throws, which would have made the
      // two M2-style dependencies impossible to add at all.
      if (!compilePattern(pattern)) {
        return { error: 'Version pattern is not a valid regular expression.' };
      }
    }
    values.version_pattern = pattern;
  }

  if (!partial || b.is_active !== undefined) {
    values.is_active = !(b.is_active === false || b.is_active === 'false');
  }

  if (!partial || b.extra_config !== undefined) {
    const extra = b.extra_config;
    if (extra === undefined || extra === null || extra === '') {
      values.extra_config = null;
    } else if (typeof extra === 'string') {
      try { values.extra_config = JSON.parse(extra); } catch { return { error: 'Extra config must be valid JSON.' }; }
    } else {
      values.extra_config = extra;
    }
  }

  return { values };
}

const connectionFor = type => (DETECTORS.find(d => d.type === type) || {}).connection_key || null;

/**
 * Stored config + cron state → the one shape the SPA reads.
 *
 * `id` is the dependency key, not a ROWID: the key IS the row identity in `tool_config`, so the
 * REST paths address it directly. It is derived from the name once, at creation, and then frozen —
 * renaming a dependency changes its display name only. Letting a rename move the key would mean
 * delete-and-recreate, which would orphan that dependency's `tool_state` row and silently reset its
 * cursor.
 */
function toDto(key, cfg, state) {
  return {
    id: key,
    key,
    name: cfg.name || key,
    release_url: cfg.release_url || '',
    release_type: cfg.release_type || '',
    release_connection: connectionFor(cfg.release_type),
    notify_url: cfg.notify_url || '',
    notify_type: cfg.notify_type || '',
    notify_connection: connectionFor(cfg.notify_type),
    is_active: cfg.is_active !== false,
    version_pattern: cfg.version_pattern || '',
    extra_config: cfg.extra_config || null,
    created_at: cfg.created_at || '',
    // Everything below is written by the scan (vm-scan-service.js), not by the UI.
    current_version: (state && state.value && state.value.current_version) || '',
    last_checked_at: (state && state.last_run_at) || '',
    last_error: (state && state.last_error) || '',
  };
}

/* ------------------------------------------------------------------ operations */

/**
 * Every watched dependency, for everyone.
 *
 * Deliberately not filtered by owner: this is a team-wide watch list, the way the Python tool's
 * config.json was shared. `owner_id` records who added a row so the UI can attribute it; it is not
 * an access boundary.
 *
 * State is fetched in one query and merged in memory rather than per-row, so the list costs two
 * ZCQL calls regardless of how many dependencies there are. A dependency with no state row yet
 * (never checked) merges against `undefined` and reads as blank, which is correct.
 */
async function listDependencies(req) {
  const configs = await listConfig(req, TOOL_KEY);
  let states = {};
  let stateError = null;
  try {
    states = await listState(req, TOOL_KEY);
  } catch (e) {
    // The notifier is usable before the cron has ever run, so a `tool_state` problem must not take
    // the configuration screen down with it — the state columns are cosmetic until part 2 ships.
    // But it is reported rather than swallowed: silently blank "last checked" forever would hide a
    // genuinely misconfigured table.
    if (e.status !== 424) throw e;
    stateError = e.message;
  }
  const dependencies = Object.keys(configs)
    .map(key => toDto(key, configs[key] || {}, states[key]))
    .sort((a, b) => a.name.localeCompare(b.name));
  return stateError
    ? { success: true, dependencies, state_error: stateError }
    : { success: true, dependencies };
}

async function createDependency(req, body) {
  const built = buildValues(body);
  if (built.error) return fail(built.error);

  const key = slugify(built.values.name);
  if (!key) return fail('Dependency name must contain at least one letter or number.');

  if (await readConfig(req, TOOL_KEY, key) !== undefined) {
    return fail(`A dependency named "${built.values.name}" is already being watched.`, 409);
  }

  const record = {
    ...built.values,
    owner_id: String(req.caller.user_id),
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  await setConfig(req, TOOL_KEY, key, record);
  return { success: true, dependency: toDto(key, record, null) };
}

/**
 * Patch one dependency. Only the fields present in the body change — so the list's Pause/Resume can
 * send `{ is_active }` alone without round-tripping the URLs it isn't touching.
 *
 * This is still a read-modify-write of that dependency's JSON, but only ever by the UI: the cron
 * writes `tool_state`, never `tool_config`, so there is no writer to race with.
 */
async function updateDependency(req, id, body) {
  const key = String(id || '').trim();
  if (!key) return fail('Dependency id is required.');

  const existing = await readConfig(req, TOOL_KEY, key);
  if (existing === undefined) return fail('No such dependency.', 404);

  const built = buildValues(body, { partial: true });
  if (built.error) return fail(built.error);
  if (!Object.keys(built.values).length) return fail('Nothing to update.');

  // The key never moves — see toDto's note. A rename is a display-name change only, so two
  // dependencies may share a slug root without colliding, and no uniqueness re-check is needed.
  const merged = { ...existing, ...built.values };
  await setConfig(req, TOOL_KEY, key, merged);

  let state = null;
  try {
    state = (await listState(req, TOOL_KEY))[key] || null;
  } catch (e) {
    if (e.status !== 424) throw e;
  }
  return { success: true, dependency: toDto(key, merged, state) };
}

/** Remove the configuration and the cron state together, so nothing is left orphaned. */
async function deleteDependency(req, id) {
  const key = String(id || '').trim();
  if (!key) return fail('Dependency id is required.');

  if (await readConfig(req, TOOL_KEY, key) === undefined) return fail('No such dependency.', 404);
  await deleteConfig(req, TOOL_KEY, key);
  try {
    await deleteState(req, TOOL_KEY, key);
  } catch (e) {
    // No state row (or no table yet) is the normal case for a dependency the job never reached.
    if (e.status !== 424) throw e;
  }
  let removedNotifications = 0;
  try {
    removedNotifications = await notifications.deleteForDependency(req, key);
  } catch (e) {
    // Same reasoning as the state row: the notifications table may not exist yet, and a dependency
    // that never produced one is the common case. Anything else is a real problem worth surfacing.
    if (e.status !== 424) throw e;
  }
  return { success: true, id: key, removed_notifications: removedNotifications };
}

/** GET /api/vm/detect?url=… — what the form calls as someone pastes a link. */
function describeLink(url) {
  const detected = detectSource(url);
  if (!detected.ok) return fail(detected.error);
  return {
    success: true,
    host: detected.host,
    type: detected.type,
    connection_key: detected.connection_key,
    confident: detected.confident,
  };
}

module.exports = {
  listDependencies, createDependency, updateDependency, deleteDependency,
  describeLink, detectSource, slugify,
  SOURCE_TYPES, TOOL_KEY,
};
