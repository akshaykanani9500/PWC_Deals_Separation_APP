import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { Activity, ActivityDetail, AuditEntry, Communication, Contact, QuickNote, Task, TaskDetail } from '../../../shared/types';
import { PRIORITY, WORK_STATUS } from '../../../shared/schema';
import { ah, HttpError } from '../errors';
import { ensureAction, hasAction } from '../middleware/auth';
import { canAddTaskToActivity, canEditActivity, canEditTask, filterCommunications, sanitizeContact } from '../services/access';
import { audit } from '../services/audit';
import { isOverdue, rollupProject, today } from '../services/rollup';
import { assertOpen, byOrder, denyRow, loadActivity, loadTask, userIndex } from './helpers';

const optStr = z.string().optional().nullable();
const optNum = z.coerce.number().optional().nullable();

const taskBody = z.object({
  title: z.string().min(1).max(200), description: optStr, assignee_user_id: optStr, status: z.enum(WORK_STATUS).optional(),
  priority: z.enum(PRIORITY).optional().nullable(), start_date: optStr, due_date: optStr, completed_date: optStr, effort_hours: optNum,
  percent_complete: z.coerce.number().min(0).max(100).optional().nullable(), day1_critical: z.enum(['Y', 'N']).optional().nullable(),
  dependency_notes: optStr, done_notes: optStr, pending_notes: optStr, sort_order: optNum,
});

/** Status/percent consistency for a task write. */
function normalizeTaskPatch(patch: Partial<Task>, current?: Task): Partial<Task> {
  const out = { ...patch };
  if (out.status === 'Done') { out.percent_complete = 100; if (!out.completed_date) out.completed_date = today(); }
  else if (out.status && current?.status === 'Done') { out.completed_date = null; if (out.percent_complete === undefined || out.percent_complete === 100) out.percent_complete = out.status === 'Not Started' ? 0 : 90; }
  if (out.status === 'Not Started' && out.percent_complete === undefined && current?.status !== 'Not Started') out.percent_complete = 0;
  if (out.percent_complete === 100 && !out.status && current?.status !== 'Done') { out.status = 'Done'; out.completed_date = today(); }
  return out;
}

export function activitiesRouter(db: Db): Router {
  const r = Router();

  r.get('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { activity, project } = await loadActivity(db, auth, req.params.id);
    const idx = await userIndex(db);
    const tasks = (await db.find<Task>('tasks', (t) => t.activity_id === activity.activity_id)).sort(byOrder);
    const rows = [];
    for (const t of tasks) {
      const p = await canEditTask(db, auth, t);
      rows.push({ ...t, assignee_name: idx.name(t.assignee_user_id), perms: { canEdit: p.canEdit, canDelete: p.canDelete } });
    }
    const notes = auth.code === 'CLIENT' ? [] : (await db.find<QuickNote>('quick_notes', (n) => n.activity_id === activity.activity_id))
      .sort((a, b) => (a.pinned === 'Y' ? -1 : 0) - (b.pinned === 'Y' ? -1 : 0) || (a.created_at < b.created_at ? 1 : -1))
      .map((n) => ({ ...n, author_name: idx.name(n.created_by) }));
    const comms = filterCommunications(await db.find<Communication>('communications', (c) => c.activity_id === activity.activity_id), auth)
      .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    const contactIds = new Set(comms.map((c) => c.contact_id).filter(Boolean));
    const contacts = auth.code === 'CLIENT' ? [] : (await db.find<Contact>('contacts', (c) => c.project_id === project.project_id))
      .filter((c) => contactIds.has(c.contact_id) || c.side === 'PwC').map((c) => sanitizeContact(c, auth));
    const t0 = today();
    const detail: ActivityDetail = {
      activity: { ...activity, owner_name: idx.name(activity.owner_user_id) },
      tasks: rows, notes, communications: comms, contacts,
      stats: {
        total: tasks.length, done: tasks.filter((t) => t.status === 'Done').length, inProgress: tasks.filter((t) => t.status === 'In Progress').length,
        blocked: tasks.filter((t) => t.status === 'Blocked').length, overdue: tasks.filter((t) => isOverdue(t, t0)).length,
        day1Critical: tasks.filter((t) => t.day1_critical === 'Y' && t.status !== 'Done').length,
        hours: tasks.reduce((s, t) => s + (Number(t.effort_hours) || 0), 0),
      },
      perms: {
        canEditActivity: await canEditActivity(db, auth, activity),
        canAddTask: await canAddTaskToActivity(db, auth, activity),
        canAddNote: hasAction(auth, 'notes.add') && project.status !== 'Closed',
      },
    };
    res.json(detail);
  }));

  r.patch('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { activity, project } = await loadActivity(db, auth, req.params.id);
    assertOpen(project);
    await ensureAction(db, auth, 'activity.edit', { projectId: project.project_id, entity: 'activity', id: activity.activity_id });
    if (!(await canEditActivity(db, auth, activity))) await denyRow(db, auth, 'You can only edit activities in stages you lead.', { projectId: project.project_id, entity: 'activity', id: activity.activity_id });
    const patch = z.object({
      name: z.string().min(1).max(160).optional(), description: optStr, priority: z.enum(PRIORITY).optional().nullable(), owner_user_id: optStr,
      start_date: optStr, due_date: optStr, summary: optStr, sort_order: optNum,
    }).parse(req.body);
    const updated = await db.update<Activity>('activities', activity.activity_id, patch as Partial<Activity>, auth.user.user_id);
    await audit(db, auth, 'activity.update', { type: 'activity', id: activity.activity_id, projectId: project.project_id, details: patch });
    res.json(updated);
  }));

  r.delete('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { activity, project } = await loadActivity(db, auth, req.params.id);
    assertOpen(project);
    await ensureAction(db, auth, 'activity.edit', { projectId: project.project_id, entity: 'activity', id: activity.activity_id });
    if (!(await canEditActivity(db, auth, activity))) await denyRow(db, auth, 'You can only delete activities in stages you lead.', { projectId: project.project_id, entity: 'activity', id: activity.activity_id });
    for (const t of await db.find<Task>('tasks', (x) => x.activity_id === activity.activity_id)) await db.softDelete('tasks', t.task_id, auth.user.user_id);
    await db.softDelete('activities', activity.activity_id, auth.user.user_id);
    await rollupProject(db, project.project_id, auth.user.user_id);
    await audit(db, auth, 'activity.delete', { type: 'activity', id: activity.activity_id, projectId: project.project_id, details: { name: activity.name } });
    res.json({ ok: true });
  }));

  r.post('/:id/tasks', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { activity, project } = await loadActivity(db, auth, req.params.id);
    assertOpen(project);
    await ensureAction(db, auth, 'task.edit', { projectId: project.project_id, entity: 'task' });
    if (!(await canAddTaskToActivity(db, auth, activity))) await denyRow(db, auth, 'You can only add tasks in stages you lead.', { projectId: project.project_id, entity: 'task' });
    const body = normalizeTaskPatch(taskBody.parse(req.body) as Partial<Task>);
    const count = (await db.find<Task>('tasks', (t) => t.activity_id === activity.activity_id)).length;
    const task = await db.insert<Task>('tasks', {
      ...body, project_id: project.project_id, stage_id: activity.stage_id, activity_id: activity.activity_id,
      status: body.status ?? 'Not Started', priority: body.priority ?? 'Medium', percent_complete: body.percent_complete ?? 0,
      day1_critical: body.day1_critical ?? 'N', sort_order: body.sort_order ?? count + 1,
    }, auth.user.user_id);
    await rollupProject(db, project.project_id, auth.user.user_id);
    await audit(db, auth, 'task.create', { type: 'task', id: task.task_id, projectId: project.project_id, details: { title: task.title } });
    res.status(201).json(await db.get('tasks', task.task_id));
  }));

  r.post('/:id/tasks/bulk', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { activity, project } = await loadActivity(db, auth, req.params.id);
    assertOpen(project);
    await ensureAction(db, auth, 'task.edit', { projectId: project.project_id, entity: 'task' });
    if (!(await canAddTaskToActivity(db, auth, activity))) await denyRow(db, auth, 'You can only add tasks in stages you lead.', { projectId: project.project_id, entity: 'task' });
    const { tasks } = z.object({ tasks: z.array(taskBody).min(1) }).parse(req.body);
    const count = (await db.find<Task>('tasks', (t) => t.activity_id === activity.activity_id)).length;
    const created = await db.insertMany<Task>('tasks', tasks.map((raw, i) => {
      const t = normalizeTaskPatch(raw as Partial<Task>);
      return { ...t, project_id: project.project_id, stage_id: activity.stage_id, activity_id: activity.activity_id, status: t.status ?? 'Not Started', priority: t.priority ?? 'Medium', percent_complete: t.percent_complete ?? 0, day1_critical: t.day1_critical ?? 'N', sort_order: count + i + 1 };
    }), auth.user.user_id);
    await rollupProject(db, project.project_id, auth.user.user_id);
    await audit(db, auth, 'task.bulk_create', { type: 'task', projectId: project.project_id, details: { activity: activity.name, count: created.length }, ai: !!req.body?.fromAi });
    res.status(201).json(created);
  }));

  return r;
}

export function tasksRouter(db: Db): Router {
  const r = Router();

  r.get('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { task } = await loadTask(db, auth, req.params.id);
    const idx = await userIndex(db);
    const perms = await canEditTask(db, auth, task);
    const comms = filterCommunications(await db.find<Communication>('communications', (c) => c.task_id === task.task_id), auth).sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    const notes = auth.code === 'CLIENT' ? [] : (await db.find<QuickNote>('quick_notes', (n) => n.task_id === task.task_id)).map((n) => ({ ...n, author_name: idx.name(n.created_by) }));
    const history = (await db.find<AuditEntry>('audit_log', (a) => a.entity_id === task.task_id && a.action !== 'access.denied')).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 30);
    const detail: TaskDetail = { task: { ...task, assignee_name: idx.name(task.assignee_user_id) }, communications: comms, notes, history, perms };
    res.json(detail);
  }));

  r.patch('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { task, project } = await loadTask(db, auth, req.params.id);
    assertOpen(project);
    await ensureAction(db, auth, ['task.edit', 'task.edit.own'], { projectId: project.project_id, entity: 'task', id: task.task_id });
    const perms = await canEditTask(db, auth, task);
    if (!perms.canEdit) await denyRow(db, auth, auth.code === 'ANALYST' ? 'You can only update tasks assigned to you.' : 'You cannot edit this task.', { projectId: project.project_id, entity: 'task', id: task.task_id });
    const parsed = taskBody.partial().parse(req.body) as Partial<Task>;
    const keys = Object.keys(parsed) as (keyof Task)[];
    const notAllowed = keys.filter((k) => !perms.editableFields.includes(k));
    if (notAllowed.length) await denyRow(db, auth, `You can only change: ${perms.editableFields.join(', ')}. Not allowed: ${notAllowed.join(', ')}.`, { projectId: project.project_id, entity: 'task', id: task.task_id });
    const patch = normalizeTaskPatch(parsed, task);
    const updated = await db.update<Task>('tasks', task.task_id, patch, auth.user.user_id);
    await rollupProject(db, project.project_id, auth.user.user_id);
    await audit(db, auth, 'task.update', { type: 'task', id: task.task_id, projectId: project.project_id, details: { title: task.title, ...patch } });
    res.json(await db.get('tasks', updated.task_id));
  }));

  r.delete('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { task, project } = await loadTask(db, auth, req.params.id);
    assertOpen(project);
    await ensureAction(db, auth, 'task.edit', { projectId: project.project_id, entity: 'task', id: task.task_id });
    const perms = await canEditTask(db, auth, task);
    if (!perms.canDelete) await denyRow(db, auth, 'You cannot delete this task.', { projectId: project.project_id, entity: 'task', id: task.task_id });
    await db.softDelete('tasks', task.task_id, auth.user.user_id);
    await rollupProject(db, project.project_id, auth.user.user_id);
    await audit(db, auth, 'task.delete', { type: 'task', id: task.task_id, projectId: project.project_id, details: { title: task.title } });
    res.json({ ok: true });
  }));

  return r;
}
