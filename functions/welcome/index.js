/**
 * welcome — WSM Security connections registry.
 *
 * Catalyst Advanced I/O function (node18), mounted at:
 *   https://wsm-security-60073792083.development.catalystserverless.in/server/welcome/
 *
 * Auth: Catalyst default Hosted Authentication, gated by auth.js — a live session plus an
 * @zohocorp.com email is enough; there is no separate `members` table (2026-08-27 decision, see
 * CLAUDE.md and the project KB). Ownership is `user_id`, never email; role comes straight from the
 * session's role_details. The old inline middleware checked only that *some* Catalyst user existed,
 * which let any account that could sign up reach the vault — this closes that gap without adding a
 * table or storing PII.
 *
 * Storage: Catalyst DataStore, ONE table — `connection_credentials` (encrypted tokens).
 * The catalogue itself (services, scopes, DC hosts) is code, in connections-registry.js. It was
 * briefly mirrored into `connections` / `connection_profiles` tables; nothing ever read them, and
 * scopes are a security boundary that belongs in a reviewed diff rather than a console-editable
 * row, so the mirroring is gone (2026-08-27).
 *
 * There is no general-purpose credential vault. `credentials` + credential-service.js were removed
 * once it was settled that the only secrets this app stores are the ones connections need — those
 * live in `connection_credentials`, keyed to a service, and are never returned over HTTP.
 *
 * Secrets: CRED_ENC_KEY (32-byte hex) is injected at deploy time and must never be committed.
 */

const express = require('express');
const catalyst = require('zcatalyst-sdk-node');

const { requireMember } = require('./auth');
const registry = require('./connections-registry');
const conn = require('./connections-service');
const risks = require('./risk-service');
const ask = require('./ask-service');
const vm = require('./vm-service');
const vmScan = require('./vm-scan-service');
const vmNotifications = require('./vm-notifications-service');
const followups = require('./followup-service');
const followupNotify = require('./followup-notify-service');
const scheduler = require('./scheduled-tasks');
const directory = require('./directory-service');
const hacksaw = require('./hacksaw-service');
const hsReview = require('./hacksaw-review-service');

const app = express();
app.use(express.json({ limit: '256kb' }));

/* ------------------------------------------------------------------ public */

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'welcome', version: '3.0.0' });
});
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Connections API running', version: '3.0.0' });
});

// Root → the React client served by Catalyst client hosting.
app.get('/', (_req, res) => res.redirect('/app/'));

/**
 * There is deliberately NO /logout route.
 *
 * The old one cleared a `JSESSIONID` cookie — a name Catalyst does not use — and then redirected to
 * the hosted login page. The session survived, Catalyst saw it and bounced the browser straight
 * back into the app, so "Sign out" appeared to do nothing. Only the Web SDK can end a Catalyst
 * session; the SPA calls `catalyst.auth.signOut(url)` (frontend/src/lib/catalyst.js).
 */

/* ------------------------------------------------------------------ auth gate */

app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(requireMember(catalyst));

/* ------------------------------------------------------------------ helpers */

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Send a service-result object, honouring an error `status` if one was set. */
const send = (res, result, okStatus = 200) =>
  res.status(result.success ? okStatus : (result.status || 400)).json(result);

/**
 * This function's absolute base URL, needed for the OAuth redirect_uri.
 *
 * Three things have to be right or Zoho rejects the flow, and it compares the string literally:
 *
 * 1. Always https. Catalyst terminates TLS upstream, so req.protocol reads as http.
 * 2. The `/server/welcome` mount prefix has to be added back — Express sees paths without it.
 * 3. **Strip a `:443` port.** Catalyst's proxy sets Host to `hostname:443`, and interpolating that
 *    raw produced `https://…catalystserverless.in:443/…`, which no console entry will ever match
 *    (nobody registers the default port). 443 is the default for https, so per RFC 3986 the
 *    port-less form is the canonical one. Only 443 is stripped — a genuinely non-default port
 *    still belongs in the URI.
 *
 * The same value is sent at /authorize and again at the token exchange, and Zoho requires those to
 * be identical, so this must stay the single place it is built.
 */
const selfHost = req => String(req.get('host') || '').replace(/:443$/, '');
const selfBase = req => `https://${selfHost(req)}/server/welcome`;
const oauthRedirectUri = req => `${selfBase(req)}/api/connections/oauth/callback`;

/* ------------------------------------------------------------------ identity */

app.get('/api/me', (req, res) => {
  res.json({ success: true, allowed: true, ...req.caller });
});

/* ------------------------------------------------------------------ connections */

/** The catalogue, annotated with the shared credential, the caller's override, and which wins. */
app.get('/api/connections', wrap(async (req, res) => {
  send(res, await conn.listConnections(req));
}));

/** Data-centre profiles for the DC picker. */
app.get('/api/connections/profiles', (_req, res) => {
  send(res, conn.listProfiles());
});

/** The scope/host definitions straight from code — useful for diffing against the kit. */
app.get('/api/connections/catalogue', (_req, res) => {
  res.json({ success: true, catalogue: registry.publicCatalogue() });
});

/**
 * Begin an OAuth consent flow.
 * Body: { service_key, dc?, client_id, client_secret, scope_level: 'shared' | 'user' }
 * Scopes come from the registry, never the client. Returns { auth_url } for the browser to visit.
 *
 * The redirect URI below must be registered against the client_id in the Zoho API console.
 */
/**
 * Re-run consent for a connection that is already configured, reusing the stored client id and
 * secret so nobody has to paste them again. This is the path to take when a service's scope list
 * grows: the old refresh token still works but carries the OLD grant, so the new scopes 401 until
 * the user re-consents.
 */
app.post('/api/connections/:id/reauthorize', wrap(async (req, res) => {
  const result = await conn.reauthorize(req, req.params.id, oauthRedirectUri(req));
  send(res, { ...result, redirect_uri: oauthRedirectUri(req) }, 201);
}));

/**
 * Configure several OAuth services with ONE client and ONE consent.
 * Body: { service_keys: [...], dc, client_id, client_secret, scope_level }
 * Scopes are the union of the selected services', taken from the registry — never from the client.
 */
app.post('/api/connections/bulk/start', wrap(async (req, res) => {
  const result = await conn.startBulkOAuth(req, req.body || {}, oauthRedirectUri(req));
  send(res, { ...result, redirect_uri: oauthRedirectUri(req) }, 201);
}));

app.post('/api/connections/oauth/start', wrap(async (req, res) => {
  const result = await conn.startOAuth(req, req.body || {}, oauthRedirectUri(req));
  send(res, { ...result, redirect_uri: oauthRedirectUri(req) }, 201);
}));

/**
 * OAuth callback. Zoho redirects the browser here, so this responds with a page-level redirect back
 * into the SPA rather than JSON.
 */
app.get('/api/connections/oauth/callback', wrap(async (req, res) => {
  const result = await conn.handleCallback(req, req.query || {}, oauthRedirectUri(req));
  const status = result.success ? 'connected' : 'failed';
  // A bulk consent finishes several services on one callback — say so rather than naming just one.
  const detail = result.success
    ? (result.count > 1 ? `${result.count} services` : result.service_key)
    : (result.error || 'unknown error');
  res.redirect(`/app/#/connections?status=${status}&detail=${encodeURIComponent(detail)}`);
}));

/**
 * Store a static token for a non-OAuth connection (CMTools PRIVATE-TOKEN, Repository PAT).
 * Body: { service_key, dc?, token, scope_level: 'shared' | 'user' }
 */
app.post('/api/connections/token', wrap(async (req, res) => {
  send(res, await conn.saveStaticToken(req, req.body || {}), 201);
}));

/**
 * Store an OAuth connection from a refresh token you already have, bypassing the redirect
 * consent flow. For OAuth services whose only usable Zoho client is a self client — self clients
 * have no redirect URI, so oauth/start's browser flow can never complete for them.
 * Body: { service_key, dc?, client_id, client_secret, refresh_token, scope_level, extra_config? }
 */
app.post('/api/connections/oauth/refresh-token', wrap(async (req, res) => {
  send(res, await conn.saveRefreshToken(req, req.body || {}), 201);
}));

/**
 * Run this connection's one read-only fetch operation and return the whole response — the "does
 * this credential actually retrieve data" check.
 *
 * Body: { params: { … } } — values for the operation's DECLARED params only. There is deliberately
 * no path, method or service key in the request: the operation is looked up from the registry by
 * the stored connection's service, so this cannot be steered into an arbitrary endpoint. See the
 * open-proxy warning on callConnection.
 */
app.post('/api/connections/:id/fetch', wrap(async (req, res) => {
  const result = await conn.runFetch(req, req.params.id, (req.body && req.body.params) || {});
  send(res, result);
}));

/**
 * Update a connection's non-secret extra config (e.g. PlatformAI's portal_id / default model)
 * without redoing OAuth consent. Only services that declare `extra_config_fields` accept this.
 * Body: { extra_config: { ... } } — validated against the registry, same as at Connect time.
 */
app.post('/api/connections/:id/config', wrap(async (req, res) => {
  send(res, await conn.setExtraConfig(req, req.params.id, req.body || {}));
}));

/** Revoke at Zoho where applicable, then wipe the stored material. */
app.delete('/api/connections/:id', wrap(async (req, res) => {
  send(res, await conn.revokeConnection(req, req.params.id));
}));

/* ------------------------------------------------------------------ compliance: risk register */

/** List risks — query filters: register, status, severity, q. */
app.get('/api/risks', wrap(async (req, res) => {
  send(res, await risks.listRisks(req, req.query || {}));
}));

/** The full guideline text, for the Risk Register's "View guidelines" panel. */
app.get('/api/risks/guidelines', wrap(async (req, res) => {
  send(res, await risks.getGuidelines());
}));

app.get('/api/risks/:riskId', wrap(async (req, res) => {
  send(res, await risks.getRisk(req, req.params.riskId));
}));

/** Live single-record Creator call for the row-expand detail panel — never persisted, see risk-service.js. */
app.get('/api/risks/:riskId/preview', wrap(async (req, res) => {
  send(res, await risks.previewRisk(req, req.params.riskId));
}));

/** Mirrors `risk draft_risk` — drafts one candidate risk via chatCompletion(); nothing is written. */
app.post('/api/risks/draft', wrap(async (req, res) => {
  send(res, await risks.draftRisk(req, req.body || {}), 201);
}));

/**
 * Mirrors `risk compare_risks` — DPIA coverage comparison, run as an async job (see
 * risk-service.js's submitCompareDpiasJob/runCompareDpiasJob header comment for why). This POST
 * returns { job_id } immediately (202); GET the job id below to poll status/result.
 */
app.post('/api/risks/compare-dpias', wrap(async (req, res) => {
  send(res, await risks.submitCompareDpiasJob(req), 202);
}));

/** GET /api/risks/compare-dpias/:jobId — poll status while 'running', result once 'done'. */
app.get('/api/risks/compare-dpias/:jobId', wrap(async (req, res) => {
  send(res, await risks.getCompareDpiasJob(req, req.params.jobId));
}));

/** Full replace of compliance_risks from the live Zoho Creator connection — see risk-service.js. */
app.post('/api/risks/sync', wrap(async (req, res) => {
  send(res, await risks.syncFromCreator(req));
}));

/** Scripted guideline review (G6-G10, G19) — see risk-review.js and risk-guidelines.md. */
app.post('/api/risks/review', wrap(async (req, res) => {
  send(res, await risks.reviewGuidelines(req));
}));


/** Rerun the same scripted review for one risk — the Status column's per-row rerun icon. */
app.post('/api/risks/:riskId/review', wrap(async (req, res) => {
  send(res, await risks.reviewOneRisk(req, req.params.riskId));
}));

/* ------------------------------------------------------------------ compliance: DMS manager */

/** GET /api/dms/documents — list DMS documents live from Zoho Creator (link, app and added date
 *  included), same team filter as Risk Register. See risk-service.js's listDocuments. */
app.get('/api/dms/documents', wrap(async (req, res) => {
  send(res, await risks.listDocuments(req));
}));

/** POST /api/dms/documents/sync — full replace of dms_documents from the live Zoho Creator connection. */
app.post('/api/dms/documents/sync', wrap(async (req, res) => {
  send(res, await risks.syncDmsDocuments(req));
}));

/** GET /api/dms/documents/:documentId/workflow — one document's live WorkDrive workflow status
 *  (last reviewed/approved dates, open-too-long / stale-approval flags — see risk-service.js). */
app.get('/api/dms/documents/:documentId/workflow', wrap(async (req, res) => {
  send(res, await risks.getDocumentWorkflow(req, req.params.documentId));
}));

/* ------------------------------------------------------------------ compliance: team filters */

/** GET /api/team-filters — which Creator Team_Name values sync() pulls. */
app.get('/api/team-filters', wrap(async (req, res) => {
  send(res, await risks.listTeamFilters(req));
}));

/** POST /api/team-filters — body: { team_name }. */
app.post('/api/team-filters', wrap(async (req, res) => {
  send(res, await risks.addTeamFilter(req, (req.body || {}).team_name), 201);
}));

/** DELETE /api/team-filters/:teamName — teamName is URL-encoded, see risk-service.js. */
app.delete('/api/team-filters/:teamName', wrap(async (req, res) => {
  send(res, await risks.removeTeamFilter(req, req.params.teamName));
}));

/* ------------------------------------------------------------------ compliance: ask */

/** Grounded Q&A — mirrors compliancemanager's query_handler. Read-only; canned answers for now. */
app.post('/api/ask', wrap(async (req, res) => {
  send(res, ask.answerQuestion((req.body || {}).question));
}));

/* ------------------------------------------------------------------ vm manager: dependency upgrade notifier */

/**
 * The watched-dependency list — the configuration behind the settings drawer. Stored in
 * `tool_config` under TOOL_KEY `vm_notifier`, team-wide rather than per-caller: everyone sees and
 * edits the same watch list, the way the Python tool's config.json was shared. See vm-service.js.
 */
app.get('/api/vm/dependencies', wrap(async (req, res) => {
  send(res, await vm.listDependencies(req));
}));

/**
 * Body: { name, release_url, release_type?, notify_url, notify_type?, version_pattern?,
 *         is_active?, extra_config? }
 * The *_type fields are optional — the link identifies the source, and an explicit type only
 * overrides that detection.
 */
app.post('/api/vm/dependencies', wrap(async (req, res) => {
  send(res, await vm.createDependency(req, req.body || {}), 201);
}));

/** Partial update — send only the fields that change (the list's active toggle sends one). */
app.patch('/api/vm/dependencies/:id', wrap(async (req, res) => {
  send(res, await vm.updateDependency(req, req.params.id, req.body || {}));
}));

app.delete('/api/vm/dependencies/:id', wrap(async (req, res) => {
  send(res, await vm.deleteDependency(req, req.params.id));
}));

/**
 * GET /api/vm/detect?url=… — classify a pasted link (type + which connection its fetch will need).
 * Pure function over the URL: no network call, nothing stored.
 */
app.get('/api/vm/detect', (req, res) => {
  send(res, vm.describeLink((req.query || {}).url));
});

/**
 * GET /api/vm/notifications?limit=&dep=  — what the scan has found, newest first.
 *
 * This is the notifier page itself now: the feed is the content, and the watch list sits behind the
 * settings icon. Rows come from `vm_notifications`, written by the 6-hourly job (or by Run now).
 *
 * A missing table answers 424 with the column list rather than a masked 500, so a fresh
 * environment tells you what to create instead of looking broken.
 */
app.get('/api/vm/notifications', wrap(async (req, res) => {
  const q = req.query || {};
  send(res, {
    success: true,
    notifications: await vmNotifications.listNotifications(req, { limit: q.limit, depKey: q.dep }),
  });
}));

/**
 * POST /api/vm/run — scan now, instead of waiting for the next 6-hourly tick.
 *
 * Body: { dependencies?: ['stratus_client'] } — omit to scan every active dependency.
 *
 * Runs the SAME `runScan` the Job Function runs, in this request. That is deliberate: a manual run
 * that exercised a second code path would not tell you whether the scheduled one works.
 *
 * It does mean a full run happens inside one HTTP request. Eight dependencies, each a handful of
 * calls to internal APIs, can approach an Advanced I/O function's execution limit — which is why
 * the drawer offers a per-dependency run as well, and why the scheduled job (not this route) is the
 * real path. If a full manual run ever does time out, the fix is to submit to the job pool
 * (`catalystApp.jobScheduling().pool(id).submitJob(...)`) rather than to raise the limit.
 */
app.post('/api/vm/run', wrap(async (req, res) => {
  const body = req.body || {};
  const depKeys = Array.isArray(body.dependencies) ? body.dependencies.map(String) : [];
  send(res, await vmScan.runScan(req, { depKeys, trigger: 'manual' }));
}));


/* ------------------------------------------------------------------ follow-ups */

/**
 * Follow-ups — the chase list. A row is a task, its doc/ticket link, an ETA, a DRI, who to ping on
 * Cliq, a status and its evidence. Reminders go out three ways and all three land in the same
 * `remindOne`: the button below, the pre-ETA window, and the overdue repeat.
 *
 * Team-wide, like the VM watch list: everyone reads and edits the same board. Only DELETE is
 * narrowed, to the row's owner or an admin — see followup-service.js.
 */

/** GET /api/followups?scope=open|mine|closed|all  (default: open) */
app.get('/api/followups', wrap(async (req, res) => {
  const scope = ['open', 'mine', 'closed', 'all'].includes((req.query || {}).scope)
    ? req.query.scope : 'open';
  res.json({ success: true, scope, follow_ups: await followups.listFollowUps(req, { scope }) });
}));

/** The vocabulary the form's dropdowns render, so they cannot drift from what the API accepts. */
app.get('/api/followups/meta', (_req, res) => {
  res.json({ success: true, statuses: followups.STATUSES, target_types: followups.TARGET_TYPES });
});

/**
 * GET /api/followups/members?q= — the people the notify picker offers.
 *
 * Cliq's own user directory, `{ id: <zuid>, name }` and **never email**. Read live on every call;
 * nothing about a person is persisted by this feature. `?q=` is handed to Cliq's own `search`
 * filter, because the org is larger than any list this would fetch.
 *
 * It used to read Catalyst User Management, which returned only the five people who had signed into
 * this app while the team is thirteen — see directory-service.js (2026-10-20).
 *
 * Doubles as the resolver the reminder-history view uses to turn a logged `user:<zuid>` into a name.
 */
app.get('/api/followups/members', wrap(async (req, res) => {
  const q = req.query || {};
  res.json({
    success: true,
    members: await directory.listPeople(req, { query: String(q.q || ''), fresh: String(q.fresh || '') === '1' }),
  });
}));

/**
 * GET /api/followups/channels — the Cliq channels the notify picker offers.
 *
 * Only channels the SHARED connection has joined (`joined=true`), because that is the credential
 * the cron posts with: a channel only the signed-in person is in would accept the pick and then
 * fail every scheduled reminder. `?fresh=1` skips the 60-second memo for a channel created moments
 * ago — used sparingly, since Cliq locks this endpoint for ten minutes after 20 calls a minute.
 *
 * Answers 424 if the stored connection predates the `ZohoCliq.Channels.READ` scope, with the
 * reauthorize instruction in the message.
 */
/**
 * GET /api/followups/people?ids=a,b,c — resolve stored ZUIDs to `{ id, name, email }`.
 *
 * What the table and the picker chips use: a row holds only a ZUID, and "USER 60040410285" is not
 * a name. Looked up live through Cliq, capped at 25 ids, and an id that no longer resolves is
 * simply absent from the response so the UI can mark it rather than break.
 */
app.get('/api/followups/people', wrap(async (req, res) => {
  const ids = String((req.query || {}).ids || '').split(',').map(s => s.trim()).filter(Boolean);
  res.json({ success: true, people: await directory.resolvePeople(req, ids) });
}));

app.get('/api/followups/channels', wrap(async (req, res) => {
  const fresh = String((req.query || {}).fresh || '') === '1';
  const channels = await directory.listChannels(req, { fresh });
  // `truncated` tells the UI the cap was hit, so it can say so instead of implying a channel
  // beyond the cap does not exist.
  res.json({ success: true, channels, truncated: Boolean(channels.truncated) });
}));

/**
 * Body: { task, ref_url?, eta?, dri?, notify_targets?, status?, evidence?,
 *         remind_before_days?, overdue_every_days?, is_active? }
 * `notify_targets` takes either the raw textarea ("#wsm-security, someone@zohocorp.com") or an
 * already-parsed array — see parseTargets.
 */
app.post('/api/followups', wrap(async (req, res) => {
  res.status(201).json({ success: true, follow_up: await followups.createFollowUp(req, req.body || {}) });
}));

/** Partial update — the status dropdown and the pause toggle each send one field. */
app.patch('/api/followups/:id', wrap(async (req, res) => {
  res.json({ success: true, follow_up: await followups.updateFollowUp(req, req.params.id, req.body || {}) });
}));

app.delete('/api/followups/:id', wrap(async (req, res) => {
  res.json({ success: true, ...(await followups.deleteFollowUp(req, req.params.id)) });
}));

/** What has been sent for this row, newest first. */
app.get('/api/followups/:id/reminders', wrap(async (req, res) => {
  res.json({ success: true, reminders: await followups.listReminders(req, req.params.id) });
}));

/**
 * POST /api/followups/:id/remind — the "Remind now" button.
 *
 * Forced: it skips the once-a-day dedupe and a paused row, because a person pressing the button
 * means it. It still refuses a done/cancelled row and one with nobody listed.
 */
app.post('/api/followups/:id/remind', wrap(async (req, res) => {
  const row = followups.toDto(await followups.getRow(req, req.params.id));
  res.json({ success: true, ...(await followupNotify.remindOne(req, row, { trigger: 'manual', force: true })) });
}));

/**
 * POST /api/followups/sweep — run the daily pass now instead of waiting for the 09:00 job.
 *
 * Body: { dry_run?: true } answers "who would be chased today" without posting anything, which is
 * the safe way to check a schedule change. Runs the SAME `sweep` the job runs, in this request —
 * deliberately, for the reason POST /api/vm/run gives: a manual path exercising different code
 * would not tell you whether the scheduled one works.
 */
app.post('/api/followups/sweep', wrap(async (req, res) => {
  const body = req.body || {};
  res.json(await scheduler.runTask(req, {
    task: 'followup_reminders',
    dryRun: body.dry_run === true,
    force: true, // a person asked for it now; the interval floor and a stale lease shouldn't block
  }));
}));

/* ------------------------------------------------------------------ scheduler */

/**
 * The scheduled-task registry, with each task's last run. One screen can list every recurring job
 * in the app instead of each feature growing its own status corner.
 */
app.get('/api/scheduler/tasks', wrap(async (req, res) => {
  res.json({ success: true, tasks: await scheduler.listTasks(req) });
}));

/**
 * POST /api/scheduler/tasks/:key/run — run a registered task in this request.
 *
 * Body: { dry_run?: true, force?: true }. Runs the SAME `runTask` the job function runs, which is
 * what makes this a real test of the scheduled path rather than a parallel one. `force` is how a
 * person overrides the interval floor and a stale lease; a dry run takes no lease and stamps
 * nothing.
 */
app.post('/api/scheduler/tasks/:key/run', wrap(async (req, res) => {
  const body = req.body || {};
  res.json(await scheduler.runTask(req, {
    task: req.params.key,
    dryRun: body.dry_run === true,
    force: body.force === true,
  }));
}));

/* ------------------------------------------------------------------ hacksaw */

/**
 * Hacksaw — read-only. See claude/hacksaw-module-design.md and hacksaw-service.js.
 *
 * Two things are deliberately absent from every signature here: a path and an organisation. The
 * service builds the path from a literal and reads the org from the connection's saved config, so
 * a caller can neither proxy arbitrary Hacksaw endpoints nor read an org this team does not own.
 *
 * These throw rather than return a result object; the error handler at the foot of this file
 * honours `status`, which is how a Hacksaw rate-limit reaches the browser as a 429 saying so.
 */
app.get('/api/hacksaw/products', wrap(async (req, res) => {
  res.json(await hacksaw.listProducts(req, { ownership: req.query.ownership }));
}));

app.get('/api/hacksaw/reports', wrap(async (req, res) => {
  res.json(await hacksaw.listReports(req, {
    product: req.query.product, page: req.query.page, limit: req.query.limit,
  }));
}));

app.get('/api/hacksaw/report', wrap(async (req, res) => {
  res.json(await hacksaw.getReportStats(req, { product: req.query.product, label: req.query.label }));
}));

/** `filters` arrives as a JSON string; a malformed one is a 400, not a silent no-filter result. */
app.get('/api/hacksaw/violations', wrap(async (req, res) => {
  let filters;
  if (req.query.filters) {
    try { filters = JSON.parse(req.query.filters); } catch {
      const e = new Error("'filters' must be a JSON object"); e.status = 400; throw e;
    }
  }
  res.json(await hacksaw.listViolations(req, {
    product: req.query.product,
    label: req.query.label,
    scan: req.query.scan,
    file_type: req.query.file_type,
    filters,
    page: req.query.page,
    limit: req.query.limit,
  }));
}));

/* -- review state: the team's verdicts, and the review records that group them -------------- */

/** Every recorded verdict, keyed by stable finding key, for the client to merge into its list. */
app.get('/api/hacksaw/decisions', wrap(async (req, res) => {
  res.json(await hsReview.listDecisions(req));
}));

/** One verdict. The client sends the finding's identity; the key is always computed server-side. */
app.post('/api/hacksaw/decisions', wrap(async (req, res) => {
  res.json(await hsReview.setDecision(req, req.body || {}));
}));

/** The same verdict across selected findings — the design's bulk action. */
app.post('/api/hacksaw/decisions/bulk', wrap(async (req, res) => {
  res.json(await hsReview.setDecisionsBulk(req, req.body || {}));
}));

app.get('/api/hacksaw/reviews', wrap(async (req, res) => {
  res.json(await hsReview.listReviews(req));
}));

app.post('/api/hacksaw/reviews', wrap(async (req, res) => {
  res.json(await hsReview.createReview(req, req.body || {}), 201);
}));

/** Approve / request changes / reopen / claim. */
app.patch('/api/hacksaw/reviews/:id', wrap(async (req, res) => {
  res.json(await hsReview.updateReview(req, req.params.id, req.body || {}));
}));

/** Diff: one build against a base build — the WIP-vs-base view the v7 design is built on. */
app.get('/api/hacksaw/diff', wrap(async (req, res) => {
  res.json(await hacksaw.getDiffStats(req, {
    product: req.query.product,
    label: req.query.label,
    base_label: req.query.base_label,
    diff_type: req.query.diff_type,
  }));
}));

app.get('/api/hacksaw/diff-violations', wrap(async (req, res) => {
  let filters;
  if (req.query.filters) {
    try { filters = JSON.parse(req.query.filters); } catch {
      const e = new Error("'filters' must be a JSON object"); e.status = 400; throw e;
    }
  }
  res.json(await hacksaw.listDiffViolations(req, {
    product: req.query.product,
    label: req.query.label,
    base_label: req.query.base_label,
    scan: req.query.scan,
    diff_category: req.query.diff_category,
    file_type: req.query.file_type,
    filters,
    page: req.query.page,
    limit: req.query.limit,
  }));
}));

/** SCA: components with known vulnerabilities in one report. Small set, no paging. */
app.get('/api/hacksaw/components', wrap(async (req, res) => {
  res.json(await hacksaw.listComponents(req, { product: req.query.product, label: req.query.label }));
}));

/** The CVEs behind one component. `component_id` must be an id this app itself returned. */
app.get('/api/hacksaw/component-vulnerabilities', wrap(async (req, res) => {
  res.json(await hacksaw.listComponentVulnerabilities(req, {
    product: req.query.product,
    label: req.query.label,
    component_id: req.query.component_id,
    component_type: req.query.component_type,
  }));
}));

app.get('/api/hacksaw/violation-filters', wrap(async (req, res) => {
  res.json(await hacksaw.listViolationFilters(req, {
    product: req.query.product,
    label: req.query.label,
    scan: req.query.scan,
    file_type: req.query.file_type,
  }));
}));

/* ------------------------------------------------------------------ errors */

app.use((_req, res) => res.status(404).json({ success: false, error: 'No such route' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('welcome error:', err);
  res.status(status).json({ success: false, error: status >= 500 ? 'Internal error' : err.message });
});

module.exports = app;
