/**
 * directory-service — who and where a notification can be sent. Read live, never persisted.
 *
 * Both directories come from Cliq, through the stored `zoho-cliq` connection:
 *
 *   people    `GET /api/v2/users`    → `{ id: <zuid>, name: <display_name> }`
 *   channels  `GET /api/v2/channels` → `{ unique_name, name }`
 *
 * ── Why people come from Cliq and not from Catalyst (2026-10-20) ────────────────────────────
 *
 * They used to come from `userManagement().getAllUsers()`, which lists people registered in *this
 * Catalyst app*. On a live check that returned **five** — the handful who had ever signed in — while
 * the team is thirteen and the org far larger. The picker structurally could not reach the people
 * it exists to notify, and a search for a colleague's own handle came back "No match".
 *
 * Cliq's own user directory is the right source: it is the directory the messages are addressed
 * into. It also removes a whole mechanism — a Cliq buddy can be addressed by **ZUID**
 * (`/api/v2/buddies/{ZUID}/message`), so there is no email to resolve at send time and no
 * per-sweep Catalyst directory read.
 *
 * ── Where email sits, exactly (revised 2026-10-20) ──────────────────────────────────────────
 *
 * **Stored: never. Displayed: yes.**
 *
 * A follow-up stores `{ type:'user', value:'<zuid>' }` — a ZUID is an opaque numeric id, not
 * personal data — and the reminder posts straight to it, so no email is involved in sending or at
 * rest. That part of the rule is unchanged and is the one that matters.
 *
 * What changed: these functions now return `email` alongside `name`, because a picker showing only
 * "ASHOK" cannot be used. Two colleagues share a first name, people search by address, and the
 * display name alone left the user unable to tell which person they had picked. So the address is
 * read live and shown, and is still never written to a row, a log line, or the reminder itself.
 *
 * The honest framing: this is a deliberate narrowing of the earlier "no email crosses the wire"
 * claim down to "no email is persisted". It was asked for on 2026-10-20 with the trade-off stated.
 *
 * `catalystApp` is still needed — `callConnection` resolves the stored credential through it.
 */

'use strict';

const conn = require('./connections-service');

/**
 * Memo TTL for both directories.
 *
 * Cliq rate-limits `/channels` to **20 requests a minute then locks for ten**, and `/users` to 30.
 * Every save validates its targets against these lists, so without a memo a few rows saved in a row
 * could lock the picker out for the whole team. Module-level, therefore per warm function instance:
 * a rate-limit guard, not a cache with a correctness story. A new channel or colleague appears
 * within a minute, and `fresh` skips it.
 */
const TTL_MS = 60 * 1000;

/** Cliq caps `limit` at 100 per page. These are how far we page before stopping. */
const CHANNEL_CAP = 500;
const USER_CAP = 500;

let channelMemo = { at: 0, rows: null };
let userMemo = { at: 0, rows: null };

/* ------------------------------------------------------------------ paging */

/**
 * Page a Cliq v2 list endpoint, following `next_token` while `has_more`.
 *
 * A 401/403 here almost always means the stored connection predates the scope this endpoint needs,
 * so that is answered as 424 with the reauthorize instruction rather than a bare 502 — a fresh
 * environment then says what to do instead of looking broken.
 */
async function pageAll(req, { path, params, cap, pick, scopeHint }) {
  const out = [];
  let nextToken = '';

  for (let page = 0; page < Math.ceil(cap / 100); page += 1) {
    const qs = new URLSearchParams({ limit: '100', ...params });
    if (nextToken) qs.set('next_token', nextToken);

    const resp = await conn.callConnection(req, 'zoho-cliq', `${path}?${qs.toString()}`, {
      signal: AbortSignal.timeout(20000),
    });
    const text = await resp.text();

    if (!resp.ok) {
      const err = new Error(`Cliq refused ${path} (HTTP ${resp.status}): ${text.slice(0, 180)}`);
      err.status = resp.status === 401 || resp.status === 403 ? 424 : 502;
      if (err.status === 424) {
        err.message += ` — reauthorize the Zoho Cliq connection; this needs the ${scopeHint} scope.`;
      }
      throw err;
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Cliq returned an unreadable response for ${path}`);
    }

    // Cliq is inconsistent across endpoints: /users answers under `data`, /channels under `channels`.
    const items = body.data || body.channels || body.users || [];
    for (const item of items) {
      const row = pick(item);
      if (row) out.push(row);
    }

    nextToken = body.has_more ? String(body.next_token || '') : '';
    if (!nextToken) break;
  }

  return { rows: out, truncated: Boolean(nextToken) };
}

/* ------------------------------------------------------------------ people */

/**
 * Cliq users, for the notify picker. `{ id: <zuid>, name }` — **never email**.
 *
 * `query` is passed to Cliq's own `search` filter rather than matched here: the directory is the
 * whole org, so filtering client-side would mean fetching all of it to find one person. Searching
 * by the handle people actually know works because Cliq matches its own fields — which is what the
 * Catalyst-backed version could not do once email was stripped from the response.
 */
async function listPeople(req, { query = '', fresh = false } = {}) {
  const q = String(query || '').trim();

  if (!q && !fresh && userMemo.rows && Date.now() - userMemo.at < TTL_MS) {
    return userMemo.rows;
  }

  const pick = (u) => {
    const zuid = String(u.zuid || u.id || '');
    if (!zuid) return null;
    return {
      id: zuid,
      name: String(u.display_name || u.name || zuid),
      // Display only. Never stored on a follow-up, in the reminder log, or in the Cliq message.
      email: String(u.email_id || u.email || ''),
    };
  };

  const { rows } = await pageAll(req, {
    path: '/api/v2/users',
    params: q ? { status: 'active', search: q } : { status: 'active' },
    cap: q ? 100 : USER_CAP,
    pick,
    scopeHint: 'ZohoCliq.Users.READ',
  });

  const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
  if (!q) userMemo = { at: Date.now(), rows: sorted };
  return sorted;
}

/**
 * Resolve stored ZUIDs to `{ id, name, email }` — what the table, the chips and the reminder log
 * render for a `user:<zuid>`.
 *
 * ── Why this scans a listing instead of looking each id up ───────────────────────────────────
 *
 * Cliq gives no way to fetch a user by ZUID. `GET /users` accepts only `status`, `plan_type`,
 * `fields`, `limit`, `search`, `sort_by`, `modified_after` and `next_token` — no id filter — and
 * `search` matches names and email addresses, **not** ZUIDs. (`GET /users/{USER_ID}` exists but
 * keys on `id`, and its response carries no `zuid`, which is the field sending needs.)
 *
 * The first version here searched `?q=<zuid>`, which always returned nothing and so reported every
 * stored person as unresolvable — and, through `validateTargets`, refused to save a row whose
 * person had just been picked from this very directory (observed 2026-10-20).
 *
 * So: scan the cached listing. It is memoised and capped at `USER_CAP`, which means a ZUID outside
 * that page resolves to nothing — the UI shows the bare id, which is honest about what happened.
 * Raising the cap is the lever if that starts to bite.
 */
async function resolvePeople(req, ids) {
  const wanted = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 25);
  if (!wanted.length) return {};

  const out = {};

  // First: ask Cliq for each user directly. The docs describe `GET /users/{USER_ID}` without
  // saying whether a ZUID is accepted there, and the listing returns BOTH `id` and `zuid`, so
  // whether this works is an empirical question — it is tried, and a failure is not an error.
  for (const id of wanted) {
    try {
      const resp = await conn.callConnection(req, 'zoho-cliq', `/api/v2/users/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) continue;
      const body = JSON.parse(await resp.text());
      const u = body.data || body.user || body;
      const zuid = String(u.zuid || u.id || '');
      if (!zuid) continue;
      out[id] = { id, name: String(u.display_name || u.name || id), email: String(u.email_id || u.email || '') };
    } catch {
      /* fall through to the listing scan */
    }
  }

  // Fallback: scan the cached listing for whatever is still unresolved. Capped at USER_CAP, so a
  // ZUID beyond that page stays unresolved and the UI shows the bare id — which is what happened
  // to every stored person before the per-id lookup above (verified 2026-10-20: an id that had
  // just sent a reminder successfully could not be named).
  const missing = wanted.filter(id => !out[id]);
  if (missing.length) {
    try {
      const set = new Set(missing);
      for (const p of await listPeople(req)) {
        if (set.has(p.id)) out[p.id] = p;
      }
    } catch (e) {
      console.log('resolvePeople: directory unreadable:', e.message);
    }
  }

  return out;
}

/* ------------------------------------------------------------------ channels */

/**
 * Channels the connected Cliq account is in.
 *
 * `unique_name` is what the send path addresses (`/channelsbyname/{unique_name}/message`) and `name`
 * is what a person recognises, so both come back: the UI shows one and stores the other.
 *
 * Read through the SHARED connection, because that is the credential the cron posts with — a
 * channel only the signed-in person had joined would accept the pick and then fail every scheduled
 * reminder.
 *
 * Unlike `/users`, this endpoint has no server-side search, so the whole joined list is fetched and
 * filtered in the browser. `truncated` says when the cap was hit, so the UI can admit that rather
 * than pretending a channel does not exist (the 2026-10-16 cap of 300 was reached exactly, and the
 * picker gave no sign of it).
 */
async function listChannels(req, { fresh = false } = {}) {
  if (!fresh && channelMemo.rows && Date.now() - channelMemo.at < TTL_MS) {
    return channelMemo.rows;
  }

  const { rows, truncated } = await pageAll(req, {
    path: '/api/v2/channels',
    params: { joined: 'true' },
    cap: CHANNEL_CAP,
    pick: (c) => {
      const uniqueName = String(c.unique_name || '');
      return uniqueName ? { unique_name: uniqueName, name: String(c.name || uniqueName) } : null;
    },
    scopeHint: 'ZohoCliq.Channels.READ',
  });

  const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
  sorted.truncated = truncated;
  channelMemo = { at: Date.now(), rows: sorted };
  return sorted;
}

/* ------------------------------------------------------------------ validation */

/**
 * Validate a parsed target list against the live directories, for save time.
 *
 * **Channels are checked; people are not.** That asymmetry is deliberate.
 *
 * A channel genuinely can become unreachable while a row still names it — the shared account gets
 * removed from it — and the check is cheap and exact, because `unique_name` is what the listing
 * returns and what the send path uses.
 *
 * A ZUID cannot be checked. Cliq offers no lookup by ZUID (see `resolvePeople`), so the only
 * available test is "does it appear in the first `USER_CAP` of the directory" — which says nothing
 * about an org larger than the cap. Applying it refused saves for people who had just been picked
 * from this directory. A check that cannot distinguish "absent" from "beyond the page" is worse
 * than no check: it blocks valid work and teaches people to distrust the error.
 *
 * What makes that safe: the ZUID came from this same directory moments earlier via a picker-only
 * form, and a person who really has left is reported per target at send time, with the row
 * recorded as `partial` or `failed` rather than silently dropped.
 */
async function validateTargets(req, targets) {
  const list = targets || [];
  if (!list.length) return { ok: [], unknown: [] };

  const channelsNeeded = list.some(t => t.type === 'channel');
  const channels = channelsNeeded
    ? new Set((await listChannels(req)).map(c => c.unique_name.toLowerCase()))
    : new Set();

  const ok = [];
  const unknown = [];

  for (const t of list) {
    if (t.type !== 'channel') { ok.push(t); continue; }
    (channels.has(String(t.value).toLowerCase()) ? ok : unknown).push(t);
  }

  return { ok, unknown };
}

module.exports = {
  listPeople, resolvePeople, listChannels, validateTargets,
  CHANNEL_CAP, USER_CAP, TTL_MS,
};
