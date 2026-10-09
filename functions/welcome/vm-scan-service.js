/**
 * VM Manager > Dependency Upgrade Notifier — part 2, the scan.
 *
 * Reads the watch list from `tool_config`, fetches each dependency's release-notes source, works
 * out which versions are new, writes one `vm_notifications` row per new version, posts a
 * consolidated message to the dependency's channel, and advances its cursor in `tool_state`.
 *
 * A port of `agent-knowledge-kit/src/vm_management/lib/{sources,check}.py`. The pure parts (version
 * comparison, note slicing, summarising) live in `vm-version-util.js`; this file is the I/O half.
 *
 * ── One entry point, two callers ─────────────────────────────────────────────────────────────
 *
 * `runScan(ctx, …)` is called by BOTH the 6-hourly Job Function (`functions/vm_notifier_job`) and
 * the UI's "Run now" button. Same code, same result, so a manual run is a real rehearsal of the
 * scheduled one rather than a second implementation that drifts.
 *
 * `ctx` is anything carrying `catalystAdmin`/`catalystApp` — an Express `req` from the route, or
 * the small shim the job builds around its own `catalystApp`. Nothing here touches `req.userId`,
 * so credential resolution falls through to the **shared** connection, which is the only thing a
 * scheduled run could sensibly use (see resolveCredential in connections-service.js).
 *
 * ── Resumption: two mechanisms, by source shape ──────────────────────────────────────────────
 *
 *   Connect  — a time watermark. `lastViewedTime` is the newest post time already seen, kept in
 *              `tool_state.RESUME_CURSOR`. First run looks back FIRST_RUN_LOOKBACK_DAYS.
 *   Learn /  — no feed ordering to resume from, so the page is re-read in full every run and the
 *   internal   watermark is the SET of versions already notified, which is `vm_notifications`
 *              itself. Re-reading is cheap and idempotent; DEP_VERSION_KEY drops the repeats.
 *
 * Getting this backwards is the single most likely way to break the tool: a time cursor on a Learn
 * page would skip everything (those rows have no per-version timestamp at all), and a version-set
 * check on Connect would re-scan six months of feed on every run.
 *
 * ── Failure containment ──────────────────────────────────────────────────────────────────────
 *
 * One dependency's failure is recorded in its own `tool_state.LAST_ERROR` and the run continues
 * with the next. A scan that aborted on the first missing credential would let one unconfigured
 * connection hide every other dependency's releases.
 */

'use strict';

const { listConfig } = require('./tool-config-service');
const { getState, setState } = require('./tool-state-service');
const notifications = require('./vm-notifications-service');
const { callConnection } = require('./connections-service');
const V = require('./vm-version-util');

const TOOL_KEY = 'vm_notifier';

/** Connect paging, carried over from the Python tool unchanged. */
const CONNECT_PAGE_LIMIT = 50;
const CONNECT_MAX_PAGES = 20;
const FIRST_RUN_LOOKBACK_DAYS = 180;

/** Default pattern when a dependency declares none — a plain dotted version. */
const DEFAULT_PATTERN = '(\\d+\\.\\d+\\.\\d+)';

/** How many seen versions to keep in `tool_state.STATE_VALUE` (bare strings, ~10 chars each). */
const SEEN_CAP = 400;

const LEARN_URL_RE = /\/portal\/([^/]+)\/(?:team\/[^/]+\/)?(?:knowledge\/)?manual\/([^/]+)\/article\/([^/?#]+)/i;

const isoOf = ms => (ms ? new Date(Number(ms)).toISOString().replace(/\.\d{3}Z$/, 'Z') : '');

/* ------------------------------------------------------------------ HTTP helpers */

/**
 * A connection call that returns parsed JSON, or throws with the API's own message.
 *
 * `callConnection` hands back a raw `Response`; every caller here wants JSON and wants a non-2xx to
 * be an error rather than a body that silently parses to `{}`. The response text is truncated into
 * the message because it ends up in `LAST_ERROR` (255 chars) and then on screen.
 */
async function connJson(ctx, serviceKey, path, options = {}) {
  const resp = await callConnection(ctx, serviceKey, path, options);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} from ${serviceKey} ${path.split('?')[0]}: ${text.slice(0, 200)}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${serviceKey} ${path.split('?')[0]} did not return JSON: ${text.slice(0, 200)}`);
  }
}

/** Unauthenticated GET for corp-internal pages — the `internal` source type needs no credential. */
async function plainGet(url, timeoutMs = 45000) {
  const resp = await fetch(url, {
    headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}: ${text.slice(0, 200)}`);
  return text;
}

/* ------------------------------------------------------------------ Connect */

function parseConnectUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  const at = name => (parts.indexOf(name) >= 0 ? parts[parts.indexOf(name) + 1] : null);
  return { host: parsed.hostname, portal: at('portal'), group: at('group') };
}

/**
 * Turn the portal/group slugs in a pasted feed URL into the numeric ids the Pulse API wants.
 *
 * Two calls, and the result is cached in `tool_state` — these ids never change for a given group,
 * and spending two API calls per dependency per run to rediscover them would be the bulk of the
 * scan's request budget.
 */
async function resolveConnectIds(ctx, portal, group) {
  const scopes = await connJson(ctx, 'zoho-connect', '/pulse/api/allScopes');
  const scopeList = (scopes.allScopes && scopes.allScopes.scopes) || scopes.scopes || [];
  let scopeId = '';
  for (const scope of scopeList) {
    const slug = String(scope.url || '').replace(/\/+$/, '').split('/').pop();
    if (slug === portal || scope.scopeUrl === portal) {
      scopeId = String(scope.id || '');
      break;
    }
  }
  if (!scopeId) throw new Error(`Connect network '${portal}' not found — is the shared zoho-connect connection a member of it?`);

  const groups = await connJson(
    ctx, 'zoho-connect',
    `/pulse/api/allGroups?scopeID=${encodeURIComponent(scopeId)}&limit=20&isGroupsMetaNeeded=true`
  );
  const groupList = (groups.allGroups && groups.allGroups.groups) || groups.groups || [];
  let partitionId = '';
  for (const item of groupList) {
    if ((item.partitionUrl || item.url || '') === group) {
      partitionId = String(item.id || '');
      break;
    }
  }
  // `limit` is capped at 20 by the API, so a group past the first page is not a "wrong slug".
  if (!partitionId) throw new Error(`Connect group '${group}' not found in the first 20 groups of '${portal}'`);
  return { scopeId, partitionId };
}

const asMs = (val) => {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e11 ? n * 1000 : n; // Connect sometimes answers in seconds
};

function streamTime(stream) {
  for (const key of ['time', 'createdTime', 'modifiedTime', 'lastActivityTime']) {
    if (stream[key] == null) continue;
    const ms = asMs(stream[key]);
    if (ms) return ms;
  }
  return 0;
}

function streamText(stream) {
  const extra = stream.streamContent || stream.article || {};
  const chunks = [
    stream.title, stream.content, stream.plainContent, stream.summary,
    extra && extra.title, extra && extra.content,
  ];
  return V.htmlToText(chunks.filter(Boolean).map(String).join('\n'));
}

function streamUrl(stream, host) {
  if (stream.url || stream.streamUrl) return stream.url || stream.streamUrl;
  return stream.id ? `https://${host}/portal/intranet/stream/${stream.id}` : '';
}

function streamsFrom(data, key) {
  const block = data[key];
  if (block && typeof block === 'object' && block.streams) return block.streams;
  if (Array.isArray(block) && block.length) return block;
  return data.streams || [];
}

/**
 * One page of a group's feed.
 *
 * `latestPartitionStreams` is the incremental endpoint and is tried first; `getLatestStreams` is
 * the fallback the Python tool also keeps, because the incremental one answers empty for some
 * groups rather than erroring — so an empty result is treated as "ask the other endpoint", not as
 * "no posts".
 */
async function fetchStreams(ctx, scopeId, partitionId, sinceMs, limit) {
  const query = `scopeID=${encodeURIComponent(scopeId)}&partitionId=${encodeURIComponent(partitionId)}`
    + `&lastViewedTime=${encodeURIComponent(String(sinceMs))}&streamLimit=${encodeURIComponent(String(limit))}`;
  try {
    const data = await connJson(ctx, 'zoho-connect', `/pulse/api/latestPartitionStreams?${query}`);
    const streams = streamsFrom(data, 'latestPartitionStreams');
    if (streams.length) return streams;
  } catch {
    // fall through to the non-incremental endpoint
  }
  const data = await connJson(ctx, 'zoho-connect', `/pulse/api/getLatestStreams?${query}`);
  return streamsFrom(data, 'getLatestStreams');
}

/** Release posts newer than the cursor, plus the new watermark. */
async function scanConnect(ctx, cfg, state) {
  const { host, portal, group } = parseConnectUrl(cfg.release_url);
  if (!portal || !group) throw new Error(`Could not read a portal and group out of ${cfg.release_url}`);

  const cached = (state && state.value) || {};
  let scopeId = cached.connect_scope_id || '';
  let partitionId = cached.connect_partition_id || '';
  if (!scopeId || !partitionId) {
    ({ scopeId, partitionId } = await resolveConnectIds(ctx, portal, group));
  }

  const pattern = cfg.version_pattern || DEFAULT_PATTERN;
  const cursor = Number(state && state.cursor) || 0;
  const sinceMs = cursor || (Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const seenIds = new Set();
  const posts = [];
  let maxSeen = sinceMs;
  let currentSince = sinceMs;

  for (let page = 0; page < CONNECT_MAX_PAGES; page += 1) {
    const streams = await fetchStreams(ctx, scopeId, partitionId, currentSince, CONNECT_PAGE_LIMIT);
    const newer = [];
    for (const stream of streams) {
      const sid = String(stream.id || '');
      if (sid && seenIds.has(sid)) continue;
      if (sid) seenIds.add(sid);
      const stime = streamTime(stream);
      if (stime && stime <= currentSince) continue;
      newer.push(stream);
      if (stime > maxSeen) maxSeen = stime;
    }
    if (!newer.length) break;

    for (const stream of newer) {
      const text = streamText(stream);
      const versions = [];
      const primary = V.extractVersion(stream.title || '', pattern) || V.extractVersion(text, pattern);
      if (primary) versions.push(primary);
      // SAS posts list extra builds as "Build : x.y.z". Skipped for M2-style dependencies, where
      // such a line is a bundled jar's version (DOMPurify 3.4.12) and not a release of the dep.
      if (!pattern.includes('M2')) {
        for (const m of text.matchAll(/Build\s*:\s*(\d+\.\d+\.\d+)/g)) {
          const extra = V.normalizeVersion(m[1]);
          if (!versions.includes(extra)) versions.push(extra);
        }
      }
      if (!versions.length) continue;

      const url = streamUrl(stream, host);
      const posted = streamTime(stream);
      for (const version of versions) {
        posts.push({
          version,
          posted_at_ms: posted,
          source: 'connect',
          source_url: url,
          title: String(stream.title || '').trim(),
          text: V.extractVersionSection(text, version, pattern) || text,
        });
      }
    }

    const pageMax = Math.max(...newer.map(streamTime));
    if (!pageMax || pageMax <= currentSince) break;
    currentSince = pageMax;
    if (newer.length < CONNECT_PAGE_LIMIT) break;
  }

  posts.sort((a, b) => a.posted_at_ms - b.posted_at_ms);
  return { posts, cursor: String(maxSeen), ids: { connect_scope_id: scopeId, connect_partition_id: partitionId } };
}

/* ------------------------------------------------------------------ Learn */

function parseLearnUrl(url) {
  const match = LEARN_URL_RE.exec(url || '');
  if (!match) return null;
  return { network: match[1], manual: match[2], article: match[3] };
}

function articleHtml(payload) {
  const article = payload.article || payload;
  if (!article || typeof article !== 'object') return '';
  const keys = ['content', 'htmlContent', 'html', 'body', 'articleContent', 'text', 'description'];
  for (const key of keys) {
    if (typeof article[key] === 'string' && article[key].trim()) return article[key];
  }
  const nested = article.article;
  if (nested && typeof nested === 'object') {
    for (const key of ['content', 'htmlContent', 'html', 'body']) {
      if (typeof nested[key] === 'string' && nested[key].trim()) return nested[key];
    }
  }
  return '';
}

/**
 * Every version on a Learn release-notes article.
 *
 * No cursor: the whole article is re-read each run and the version set does the de-duplication.
 * `posted_at_ms` is 0 for all of them, which is honest — that page carries no per-version date, and
 * the Python store records `posted_at: 0` for exactly the same reason.
 */
async function scanLearn(ctx, cfg) {
  const parsed = parseLearnUrl(cfg.release_url);
  if (!parsed) throw new Error(`Could not read a portal/manual/article out of ${cfg.release_url}`);
  const path = `/learn/api/v1/portal/${encodeURIComponent(parsed.network)}`
    + `/manual/${encodeURIComponent(parsed.manual)}/article/${encodeURIComponent(parsed.article)}`;
  const payload = await connJson(ctx, 'zoho-learn', path);
  const text = V.htmlToText(articleHtml(payload));
  const pattern = cfg.version_pattern || DEFAULT_PATTERN;

  const posts = V.versionsInText(text, pattern).map(version => ({
    version,
    posted_at_ms: 0,
    source: 'learn',
    source_url: cfg.release_url,
    title: '',
    text: V.extractVersionSection(text, version, pattern),
  }));
  return { posts, cursor: null, ids: {} };
}

/* ------------------------------------------------------------------ internal HTML */

const HTML_EDITED_RE = /Last edited on\s+(\w+\s+\d{1,2},\s+\d{4})/i;

function htmlPostedAt(html) {
  const match = HTML_EDITED_RE.exec(html || '');
  if (!match) return 0;
  const parsed = Date.parse(match[1]);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function absolutize(host, path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The menu block whose entries are this page's sibling versions (WMS API's release index). */
function htmlMenuEntries(menuJson, menuId, htmlPath) {
  const menus = (menuJson && menuJson.apiMenu) || [];
  let chosen = null;
  if (menuId) {
    chosen = menus.find(block => String(block.MenuID || '') === String(menuId)) || null;
  }
  if (!chosen && htmlPath) {
    const needle = htmlPath.replace(/\/+$/, '');
    chosen = menus.find(block => (block.menu || []).some(item => needle && String(item.link || '').includes(needle))) || null;
  }
  return (chosen && chosen.menu) || [];
}

/**
 * A corp-internal HTML page, fetched unauthenticated — the WMS API case.
 *
 * Two shapes. With `html_menu` in the dependency's extra config, the menu JSON lists one page per
 * version and each is fetched; without it, the single page's own `<h1>` supplies the version. The
 * menu form is why `extra_config` exists on a dependency at all.
 */
async function scanInternal(cfg, current, series) {
  const extra = cfg.extra_config || {};
  const menuUrl = String(extra.html_menu || '').trim();
  const pageUrl = String(cfg.release_url || '').trim();
  const pattern = cfg.version_pattern || DEFAULT_PATTERN;
  const host = new URL(menuUrl || pageUrl).hostname;

  if (!menuUrl) {
    const html = await plainGet(pageUrl);
    const h1 = /<h1[^>]*>([^<]+)<\/h1>/i.exec(html);
    const version = V.extractVersion(h1 ? h1[1] : '', pattern) || V.extractVersion(html, pattern);
    if (!version) return { posts: [], cursor: null, ids: {} };
    const text = V.htmlToText(html);
    return {
      posts: [{
        version,
        posted_at_ms: htmlPostedAt(html),
        source: 'internal',
        source_url: pageUrl,
        title: h1 ? h1[1].trim() : '',
        text: V.extractVersionSection(text, version, pattern) || text,
      }],
      cursor: null,
      ids: {},
    };
  }

  const raw = await plainGet(menuUrl);
  let menuJson;
  try {
    menuJson = JSON.parse(raw);
  } catch (e) {
    throw new Error(`The html_menu URL did not return JSON: ${e.message}`);
  }
  const pagePath = pageUrl ? new URL(pageUrl).pathname : '';
  const posts = [];
  for (const item of htmlMenuEntries(menuJson, extra.html_menu_id, pagePath)) {
    const names = item.menuName || [];
    const title = names.length ? String(names[0]) : '';
    if (title.includes('|sec-title')) continue;
    const link = String(item.link || '').trim();
    const version = V.extractVersion(title, pattern);
    if (!version || !link) continue;
    // Fetching every historical version's page would be dozens of requests for nothing, so the
    // out-of-scope ones are dropped before their page is read, not after.
    if (!V.inScope(version, current, { series })) continue;
    const url = absolutize(host, link);
    const html = await plainGet(url);
    const text = V.htmlToText(html);
    posts.push({
      version,
      posted_at_ms: htmlPostedAt(html),
      source: 'internal',
      source_url: url,
      title,
      text: V.extractVersionSection(text, version, pattern) || text,
    });
  }
  posts.sort((a, b) => V.versionCmp(a.version, b.version));
  return { posts, cursor: null, ids: {} };
}

/* ------------------------------------------------------------------ delivery */

const NBSP = ' ';

/**
 * The consolidated card for one dependency, ported from `notify.py`.
 *
 * Built here and never stored: eight dependencies' worth of these would not fit a 10,000-char Text
 * column, and the rows in `vm_notifications` hold everything needed to rebuild one.
 */
function buildCliqPayload(depName, current, items) {
  const latest = items.length ? items[items.length - 1].version : '';
  const lines = [
    `*${depName}*`,
    `Current version:${NBSP}${current || 'unset'}`,
    `Latest version:${NBSP}${latest || 'none'}`,
    '',
  ];
  const shown = items.slice(-MAX_CARD_ITEMS);
  for (const item of shown) {
    lines.push(`*${item.version}*`);
    lines.push(item.summary || V.NO_ACTION);
    if (item.source_url) lines.push(`[Release post](${item.source_url})`);
    lines.push('');
  }
  if (items.length > shown.length) {
    lines.push(`_and ${items.length - shown.length} older version(s) — see the notifier page._`);
  }
  return {
    text: lines.join('\n').trim(),
    bot: { name: 'VM Watcher' },
    card: {
      title: items.length === 1
        ? `${depName}  ${items[0].version}`
        : `${depName}  ${items.length} new versions`,
      theme: 'modern-inline',
    },
  };
}

/**
 * Post the card to the dependency's channel.
 *
 * `notify_url` is a Cliq **bot webhook** carrying its own zapikey, which is how the Python tool has
 * always delivered — so this is a plain POST and needs no OAuth credential and no Cliq write scope.
 * Any other notify type is recorded as skipped rather than guessed at: Writer and Cliq-chat
 * delivery have no prior art here, and inventing one silently would look like a delivery that
 * worked.
 */
async function deliver(cfg, payload) {
  if (cfg.notify_type !== 'cliq') {
    return { status: notifications.DELIVERY.SKIPPED, error: `No delivery implemented for a '${cfg.notify_type}' channel.` };
  }
  try {
    const resp = await fetch(cfg.notify_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const text = await resp.text();
    if (!resp.ok) {
      return { status: notifications.DELIVERY.FAILED, error: `HTTP ${resp.status}: ${text.slice(0, 150)}` };
    }
    return { status: notifications.DELIVERY.SENT, error: '' };
  } catch (e) {
    return { status: notifications.DELIVERY.FAILED, error: String(e.message || e).slice(0, 200) };
  }
}

/* ------------------------------------------------------------------ orchestration */

const SCANNERS = {
  connect: (ctx, cfg, state) => scanConnect(ctx, cfg, state),
  learn: (ctx, cfg) => scanLearn(ctx, cfg),
  internal: (ctx, cfg, state, current, series) => scanInternal(cfg, current, series),
};

/** One dependency, start to finish. Never throws — the outcome is the return value. */
async function scanOne(ctx, key, cfg) {
  const name = cfg.name || key;
  const result = { dep_key: key, name, new_versions: [], delivery: null, error: '', skipped: '' };

  if (cfg.is_active === false) {
    result.skipped = 'paused';
    return result;
  }
  const scanner = SCANNERS[cfg.release_type];
  if (!scanner) {
    result.skipped = `no fetcher for a '${cfg.release_type}' source`;
    return result;
  }

  let state = null;
  try {
    state = await getState(ctx, TOOL_KEY, key);
  } catch (e) {
    if (e.status !== 424) throw e;
    result.error = e.message;
    return result;
  }

  const stored = (state && state.value) || {};
  const current = stored.current_version || '';
  const series = Boolean((cfg.extra_config || {}).series);

  try {
    const { posts, cursor, ids } = await scanner(ctx, cfg, state, current, series);
    const known = await notifications.knownVersions(ctx, key);

    const fresh = [];
    for (const post of posts) {
      if (known.has(post.version)) continue;
      if (!V.inScope(post.version, current, { series })) continue;
      known.add(post.version); // a Connect post can mention the same version twice
      fresh.push(post);
    }
    fresh.sort((a, b) => V.versionCmp(a.version, b.version));

    const rows = [];
    for (const post of fresh) {
      const summary = V.summarize(post.text);
      const row = await notifications.insertNotification(ctx, {
        dep_key: key,
        dep_name: name,
        version: post.version,
        source_type: post.source,
        source_url: post.source_url,
        title: post.title,
        summary: V.cleanExcerpt(summary, 900),
        posted_at: isoOf(post.posted_at_ms),
      });
      if (row) rows.push(row);
    }

    if (rows.length) {
      // FIRST RUN IS A BASELINE, NOT AN ANNOUNCEMENT.
      //
      // With no stored current version, everything the source lists is "new" — a Learn page can
      // carry forty historical versions, and the 180-day Connect lookback several. Announcing that
      // backlog on the day a dependency is added would be indistinguishable from forty real
      // releases. So the first scan records the rows (the page shows them, and they become the
      // watermark) and posts nothing; from the next run on, anything above that watermark is a
      // genuine release and is announced.
      //
      // The Python tool has no equivalent because a human seeded `current_versions.config` by hand
      // before the first run ever happened. Nothing in this UI asks for that, so it is inferred.
      const outcome = current
        ? await deliver(cfg, buildCliqPayload(name, current, rows))
        : { status: notifications.DELIVERY.SKIPPED, error: 'Baseline: recorded on the first scan, not announced.' };
      for (const row of rows) {
        await notifications.setDelivery(ctx, row.id, outcome.status, outcome.error);
      }
      result.delivery = outcome;
      result.baseline = !current;
      result.new_versions = rows.map(r => r.version);
    }

    // Current version only ever moves forward, so a series dependency that publishes an older
    // series after a newer one does not drag the floor back down and re-notify its history.
    const highest = rows.reduce((top, row) => (V.isNewer(row.version, top) ? row.version : top), current);
    const seen = [...new Set([...(stored.seen || []), ...rows.map(r => r.version)])].slice(-SEEN_CAP);
    await setState(ctx, TOOL_KEY, key, {
      cursor: cursor == null ? (state && state.cursor) || '' : cursor,
      value: { ...stored, ...ids, current_version: highest, seen },
      error: '',
    });
  } catch (e) {
    result.error = String((e && e.message) || e);
    try {
      await setState(ctx, TOOL_KEY, key, { error: result.error });
    } catch {
      // A state write failing on top of a scan failure is not worth masking the scan failure with.
    }
  }
  return result;
}

/**
 * Scan every active dependency (or just the ones named), post what is new, and report per
 * dependency. Called by the Job Function on its 6-hourly schedule and by POST /api/vm/run.
 */
async function runScan(ctx, { depKeys = [], trigger = 'manual' } = {}) {
  const configs = await listConfig(ctx, TOOL_KEY);
  const wanted = depKeys.length ? depKeys.filter(k => configs[k]) : Object.keys(configs);

  const runs = [];
  for (const key of wanted) {
    // Sequential on purpose: these are rate-limited internal APIs, and eight dependencies at one
    // request each is not worth the contention of running them in parallel.
    runs.push(await scanOne(ctx, key, configs[key] || {}));
  }

  const newCount = runs.reduce((n, r) => n + r.new_versions.length, 0);
  const failed = runs.filter(r => r.error).map(r => r.dep_key);
  await setState(ctx, TOOL_KEY, '_tool', {
    value: { last_trigger: trigger, checked: runs.length, new_versions: newCount, failed },
    error: failed.length ? `Failed: ${failed.join(', ')}` : '',
  }).catch(() => {});

  return {
    success: true,
    trigger,
    checked: runs.length,
    new_versions: newCount,
    runs,
  };
}

module.exports = {
  runScan, scanOne, buildCliqPayload, parseConnectUrl, parseLearnUrl,
  htmlMenuEntries, htmlPostedAt, TOOL_KEY,
};
