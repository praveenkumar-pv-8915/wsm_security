/**
 * Task CRUD against the Catalyst DataStore.
 *
 * Tables (create them in the console — see README.md for the column list):
 *   members         EMAIL, NAME, ROLE, STATUS
 *   tasks           TITLE, DESCRIPTION, TASK_TYPE, PRODUCT, ASSIGNEE_EMAIL, REPORTER_EMAIL,
 *                   PRIORITY, STATUS, DUE_DATE, TAGS, VISIBILITY, IS_ARCHIVED
 *   task_checklist  TASK_ID, ITEM, IS_DONE, POSITION
 *   task_activity   TASK_ID, ACTOR_EMAIL, EVENT_TYPE, FIELD_NAME, FROM_VALUE, TO_VALUE, COMMENT
 *
 * Every mutation appends a task_activity row — that feed is what the UI's activity panel renders,
 * and it doubles as the audit trail for who changed what.
 */

const { esc, selectAll, selectOne, insert, update, remove } = require('./db');

/* ------------------------------------------------------------------ vocabulary */

const TASK_TYPES = ['hacksaw_review', 'dev', 'security_review', 'tools_development', 'techstack_2_0'];
const STATUSES   = ['backlog', 'in_progress', 'blocked', 'in_review', 'done'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const VISIBILITY = ['team', 'private'];

const TASK_COLUMNS =
  'tasks.ROWID, tasks.TITLE, tasks.DESCRIPTION, tasks.TASK_TYPE, tasks.PRODUCT, ' +
  'tasks.ASSIGNEE_EMAIL, tasks.REPORTER_EMAIL, tasks.PRIORITY, tasks.STATUS, tasks.DUE_DATE, ' +
  'tasks.TAGS, tasks.VISIBILITY, tasks.IS_ARCHIVED, tasks.CREATEDTIME, tasks.MODIFIEDTIME';

/** Fields a PATCH is allowed to touch. Anything else in the body is ignored. */
const PATCHABLE = {
  TITLE:          v => nonEmpty(v, 'title'),
  DESCRIPTION:    v => String(v ?? ''),
  TASK_TYPE:      v => oneOf(v, TASK_TYPES, 'type'),
  PRODUCT:        v => nonEmpty(v, 'product'),
  ASSIGNEE_EMAIL: v => String(v ?? '').toLowerCase(),
  PRIORITY:       v => oneOf(v, PRIORITIES, 'priority'),
  STATUS:         v => oneOf(v, STATUSES, 'status'),
  DUE_DATE:       v => isoDate(v),
  TAGS:           v => String(v ?? ''),
  VISIBILITY:     v => oneOf(v, VISIBILITY, 'visibility'),
};

/* ------------------------------------------------------------------ validation */

class BadRequest extends Error {
  constructor(message) { super(message); this.status = 400; }
}
class NotFound extends Error {
  constructor(message) { super(message || 'Not found'); this.status = 404; }
}

function nonEmpty(value, field) {
  const s = String(value ?? '').trim();
  if (!s) throw new BadRequest(`${field} is required`);
  if (s.length > 500) throw new BadRequest(`${field} is too long (max 500 characters)`);
  return s;
}
function oneOf(value, allowed, field) {
  const s = String(value ?? '').trim().toLowerCase();
  const match = allowed.find(a => a.toLowerCase() === s);
  if (!match) throw new BadRequest(`${field} must be one of: ${allowed.join(', ')}`);
  return match;
}
/** Dates are stored as plain 'YYYY-MM-DD' text — ZCQL string comparison sorts them correctly. */
function isoDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequest('due_date must be YYYY-MM-DD');
  return s;
}

/* ------------------------------------------------------------------ activity */

async function logActivity(app, taskId, actorEmail, event) {
  return insert(app, 'task_activity', {
    TASK_ID: String(taskId),
    ACTOR_EMAIL: actorEmail,
    EVENT_TYPE: event.type,
    FIELD_NAME: event.field || '',
    FROM_VALUE: event.from == null ? '' : String(event.from),
    TO_VALUE: event.to == null ? '' : String(event.to),
    COMMENT: event.comment || '',
  });
}

/* ------------------------------------------------------------------ reads */

/**
 * List tasks for a scope.
 *   mine    — assigned to the caller, not done
 *   team    — every open task the caller may see
 *   closed  — done tasks
 * Private tasks are visible only to their assignee and reporter (admins see everything).
 * Filtering/sorting beyond this is done client-side: this is team-scale data, not thousands of rows.
 */
async function listTasks(app, caller, scope) {
  const where = ["tasks.IS_ARCHIVED = 'false'"];

  if (scope === 'mine') {
    where.push(`tasks.ASSIGNEE_EMAIL = '${esc(caller.email)}'`, "tasks.STATUS != 'done'");
  } else if (scope === 'closed') {
    where.push("tasks.STATUS = 'done'");
  } else {
    where.push("tasks.STATUS != 'done'");
  }

  const rows = await selectAll(
    app,
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE ${where.join(' AND ')} ORDER BY tasks.ROWID DESC`
  );
  return rows.filter(t => isVisibleTo(t, caller));
}

function isVisibleTo(task, caller) {
  if (String(task.VISIBILITY || 'team') !== 'private') return true;
  if (caller.role === 'admin') return true;
  return (
    caller.email === String(task.ASSIGNEE_EMAIL || '').toLowerCase() ||
    caller.email === String(task.REPORTER_EMAIL || '').toLowerCase()
  );
}

async function getTaskRow(app, taskId) {
  const row = await selectOne(app, `SELECT ${TASK_COLUMNS} FROM tasks WHERE tasks.ROWID = ${Number(taskId) || 0}`);
  if (!row) throw new NotFound('Task not found');
  return row;
}

/** One task with its checklist and activity feed, for the detail drawer. */
async function getTask(app, caller, taskId) {
  const task = await getTaskRow(app, taskId);
  if (!isVisibleTo(task, caller)) throw new NotFound('Task not found');

  const id = Number(taskId);
  const [checklist, activity] = await Promise.all([
    selectAll(
      app,
      'SELECT task_checklist.ROWID, task_checklist.ITEM, task_checklist.IS_DONE, task_checklist.POSITION ' +
        `FROM task_checklist WHERE task_checklist.TASK_ID = ${id} ORDER BY task_checklist.POSITION`
    ),
    selectAll(
      app,
      'SELECT task_activity.ROWID, task_activity.ACTOR_EMAIL, task_activity.EVENT_TYPE, ' +
        'task_activity.FIELD_NAME, task_activity.FROM_VALUE, task_activity.TO_VALUE, ' +
        'task_activity.COMMENT, task_activity.CREATEDTIME ' +
        `FROM task_activity WHERE task_activity.TASK_ID = ${id} ORDER BY task_activity.ROWID`
    ),
  ]);
  return { ...task, checklist, activity };
}

async function listMembers(app) {
  return selectAll(
    app,
    "SELECT members.ROWID, members.EMAIL, members.NAME, members.ROLE FROM members " +
      "WHERE members.STATUS = 'active' ORDER BY members.NAME"
  );
}

/* ------------------------------------------------------------------ writes */

async function createTask(app, caller, body) {
  const row = {
    TITLE:          nonEmpty(body.title, 'title'),
    DESCRIPTION:    String(body.description ?? ''),
    TASK_TYPE:      oneOf(body.type, TASK_TYPES, 'type'),
    PRODUCT:        nonEmpty(body.product, 'product'),
    ASSIGNEE_EMAIL: String(body.assignee_email ?? '').toLowerCase(),
    REPORTER_EMAIL: caller.email,                       // never taken from the client
    PRIORITY:       oneOf(body.priority ?? 'P2', PRIORITIES, 'priority'),
    STATUS:         oneOf(body.status ?? 'backlog', STATUSES, 'status'),
    DUE_DATE:       isoDate(body.due_date),
    TAGS:           String(body.tags ?? ''),
    VISIBILITY:     oneOf(body.visibility ?? 'team', VISIBILITY, 'visibility'),
    IS_ARCHIVED:    'false',
  };

  const created = await insert(app, 'tasks', row);
  const taskId = created.ROWID || created.rowid;

  const items = Array.isArray(body.checklist) ? body.checklist : [];
  for (let i = 0; i < items.length; i++) {
    await insert(app, 'task_checklist', {
      TASK_ID: String(taskId),
      ITEM: nonEmpty(items[i], `checklist[${i}]`),
      IS_DONE: 'false',
      POSITION: String(i),
    });
  }

  await logActivity(app, taskId, caller.email, { type: 'created' });
  return getTask(app, caller, taskId);
}

/** Patch a task. Logs one activity row per changed field. */
async function updateTask(app, caller, taskId, body, canModify) {
  const task = await getTaskRow(app, taskId);
  if (!isVisibleTo(task, caller)) throw new NotFound('Task not found');
  if (!canModify(caller, task)) {
    const err = new Error('Only the assignee, the reporter or an admin can change this task');
    err.status = 403;
    throw err;
  }

  const patch = {};
  const changes = [];
  for (const [column, coerce] of Object.entries(PATCHABLE)) {
    const key = column.toLowerCase();
    if (!(key in body)) continue;
    const next = coerce(body[key]);
    const prev = task[column] == null ? '' : String(task[column]);
    if (String(next) !== prev) {
      patch[column] = next;
      changes.push({ field: key, from: prev, to: next });
    }
  }
  if (!Object.keys(patch).length) return getTask(app, caller, taskId);

  await update(app, 'tasks', taskId, patch);
  for (const c of changes) {
    await logActivity(app, taskId, caller.email, { type: 'field_changed', ...c });
  }
  return getTask(app, caller, taskId);
}

/** Soft delete — keeps the row (and its activity trail) but hides it from every list. */
async function archiveTask(app, caller, taskId, canModify) {
  const task = await getTaskRow(app, taskId);
  if (!canModify(caller, task)) {
    const err = new Error('Only the assignee, the reporter or an admin can archive this task');
    err.status = 403;
    throw err;
  }
  await update(app, 'tasks', taskId, { IS_ARCHIVED: 'true' });
  await logActivity(app, taskId, caller.email, { type: 'archived' });
  return { archived: true, id: String(taskId) };
}

async function addComment(app, caller, taskId, text) {
  const task = await getTaskRow(app, taskId);
  if (!isVisibleTo(task, caller)) throw new NotFound('Task not found');
  const comment = nonEmpty(text, 'comment');
  await logActivity(app, taskId, caller.email, { type: 'comment', comment });
  return getTask(app, caller, taskId);
}

async function addChecklistItem(app, caller, taskId, text, canModify) {
  const task = await getTaskRow(app, taskId);
  if (!canModify(caller, task)) {
    const err = new Error('Only the assignee, the reporter or an admin can change the checklist');
    err.status = 403;
    throw err;
  }
  const existing = await selectAll(
    app,
    `SELECT task_checklist.POSITION FROM task_checklist WHERE task_checklist.TASK_ID = ${Number(taskId)} ` +
      'ORDER BY task_checklist.POSITION'
  );
  await insert(app, 'task_checklist', {
    TASK_ID: String(taskId),
    ITEM: nonEmpty(text, 'item'),
    IS_DONE: 'false',
    POSITION: String(existing.length),
  });
  await logActivity(app, taskId, caller.email, { type: 'checklist_added', to: text });
  return getTask(app, caller, taskId);
}

async function setChecklistItem(app, caller, taskId, itemId, isDone, canModify) {
  const task = await getTaskRow(app, taskId);
  if (!canModify(caller, task)) {
    const err = new Error('Only the assignee, the reporter or an admin can change the checklist');
    err.status = 403;
    throw err;
  }
  const item = await selectOne(
    app,
    'SELECT task_checklist.ROWID, task_checklist.ITEM, task_checklist.TASK_ID FROM task_checklist ' +
      `WHERE task_checklist.ROWID = ${Number(itemId) || 0}`
  );
  if (!item || String(item.TASK_ID) !== String(taskId)) throw new NotFound('Checklist item not found');

  await update(app, 'task_checklist', itemId, { IS_DONE: isDone ? 'true' : 'false' });
  await logActivity(app, taskId, caller.email, {
    type: isDone ? 'checklist_checked' : 'checklist_unchecked',
    to: item.ITEM,
  });
  return getTask(app, caller, taskId);
}

async function deleteChecklistItem(app, caller, taskId, itemId, canModify) {
  const task = await getTaskRow(app, taskId);
  if (!canModify(caller, task)) {
    const err = new Error('Only the assignee, the reporter or an admin can change the checklist');
    err.status = 403;
    throw err;
  }
  await remove(app, 'task_checklist', itemId);
  await logActivity(app, taskId, caller.email, { type: 'checklist_removed' });
  return getTask(app, caller, taskId);
}

module.exports = {
  TASK_TYPES, STATUSES, PRIORITIES, VISIBILITY,
  BadRequest, NotFound,
  listTasks, getTask, listMembers,
  createTask, updateTask, archiveTask,
  addComment, addChecklistItem, setChecklistItem, deleteChecklistItem,
};
