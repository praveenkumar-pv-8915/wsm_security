/**
 * task_manager — WSM Security task management API.
 *
 * Catalyst Advanced I/O function (node18), mounted at:
 *   https://wsm-security-60073792083.development.catalystserverless.in/server/task_manager/
 *
 * Auth: Catalyst default HOSTED AUTHENTICATION. Catalyst's own hosted login pages establish the
 * session; this function only verifies it (see auth.js). No passwords, tokens or secrets live here —
 * which is why catalyst-config.json carries no env_variables.
 *
 * Storage: Catalyst DataStore (tables `tasks`, `task_checklist`, `task_activity`). NO `members`
 * table (2026-08-27 decision, see CLAUDE.md and the project KB) — ownership is `user_id` on
 * ASSIGNEE_ID/REPORTER_ID/ACTOR_ID columns, and the assignee list (`/members`) comes live from
 * Catalyst User Management, not a maintained table. See README.md for the column list.
 */

const express = require('express');
const catalyst = require('zcatalyst-sdk-node');

const { requireMember, canModify } = require('./auth');
const svc = require('./task-service');

const app = express();
app.use(express.json({ limit: '256kb' }));

/* ------------------------------------------------------------------ public */

// Health check — the only unauthenticated route. Deliberately leaks nothing.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'task_manager', version: '1.0.0' });
});

/* ------------------------------------------------------------------ auth gate */

app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  next();
});

// Everything below this line requires an active member.
app.use(requireMember(catalyst));

/* ------------------------------------------------------------------ helpers */

/** Wrap an async handler so thrown errors reach the error middleware instead of hanging. */
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------------ routes */

/** Who am I? The client uses this to render the header and decide what's editable. */
app.get('/me', (req, res) => {
  res.json({ allowed: true, ...req.caller });
});

/** Active members — powers the assignee dropdown. */
app.get('/members', wrap(async (req, res) => {
  res.json({ members: await svc.listMembers(req.catalystApp) });
}));

/** Vocabulary, so the UI's dropdowns can't drift from what the API accepts. */
app.get('/meta', (_req, res) => {
  res.json({
    types: svc.TASK_TYPES,
    statuses: svc.STATUSES,
    priorities: svc.PRIORITIES,
    visibility: svc.VISIBILITY,
  });
});

/** GET /tasks?scope=mine|team|closed  (default: team) */
app.get('/tasks', wrap(async (req, res) => {
  const scope = ['mine', 'team', 'closed'].includes(req.query.scope) ? req.query.scope : 'team';
  const tasks = await svc.listTasks(req.catalystApp, req.caller, scope);
  res.json({ scope, count: tasks.length, tasks });
}));

app.get('/tasks/:id', wrap(async (req, res) => {
  res.json(await svc.getTask(req.catalystApp, req.caller, req.params.id));
}));

app.post('/tasks', wrap(async (req, res) => {
  const task = await svc.createTask(req.catalystApp, req.caller, req.body || {});
  res.status(201).json(task);
}));

app.patch('/tasks/:id', wrap(async (req, res) => {
  res.json(await svc.updateTask(req.catalystApp, req.caller, req.params.id, req.body || {}, canModify));
}));

/** Soft delete — the row and its activity trail are kept, just hidden. */
app.delete('/tasks/:id', wrap(async (req, res) => {
  res.json(await svc.archiveTask(req.catalystApp, req.caller, req.params.id, canModify));
}));

app.post('/tasks/:id/comments', wrap(async (req, res) => {
  res.status(201).json(
    await svc.addComment(req.catalystApp, req.caller, req.params.id, (req.body || {}).comment)
  );
}));

app.post('/tasks/:id/checklist', wrap(async (req, res) => {
  res.status(201).json(
    await svc.addChecklistItem(req.catalystApp, req.caller, req.params.id, (req.body || {}).item, canModify)
  );
}));

app.patch('/tasks/:id/checklist/:itemId', wrap(async (req, res) => {
  const isDone = (req.body || {}).is_done === true || (req.body || {}).is_done === 'true';
  res.json(
    await svc.setChecklistItem(req.catalystApp, req.caller, req.params.id, req.params.itemId, isDone, canModify)
  );
}));

app.delete('/tasks/:id/checklist/:itemId', wrap(async (req, res) => {
  res.json(
    await svc.deleteChecklistItem(req.catalystApp, req.caller, req.params.id, req.params.itemId, canModify)
  );
}));

/* ------------------------------------------------------------------ errors */

app.use((_req, res) => res.status(404).json({ error: 'No such route' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('task_manager error:', err);
  res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
});

module.exports = app;
