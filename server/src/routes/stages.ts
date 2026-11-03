import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { Activity, Project, Stage, StageDetail, Task } from '../../../shared/types';
import { GATE_STATUS } from '../../../shared/schema';
import { ah, HttpError } from '../errors';
import { ensureAction, hasAction } from '../middleware/auth';
import { canAddActivityToStage, canDeleteVia, canEditActivity, canEditStage } from '../services/access';
import { audit } from '../services/audit';
import { rollupProject } from '../services/rollup';
import { assertOpen, byOrder, denyRow, loadStage, userIndex, assertTeamIds } from './helpers';
import { createActivityTree, stageTree } from './projects';

const optStr = z.string().optional().nullable();
const activityTreeBody = stageTree.shape.activities.unwrap().element;

export function stagesRouter(db: Db): Router {
  const r = Router();

  r.get('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { stage } = await loadStage(db, auth, req.params.id);
    const idx = await userIndex(db);
    const acts = (await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id)).sort(byOrder);
    const tasks = await db.find<Task>('tasks', (t) => t.stage_id === stage.stage_id);
    const activities = [];
    for (const a of acts) {
      const ts = tasks.filter((t) => t.activity_id === a.activity_id);
      const can = await canEditActivity(db, auth, a);
      activities.push({ ...a, owner_name: idx.name(a.owner_user_id), task_count: ts.length, done_count: ts.filter((t) => t.status === 'Done').length, perms: { canEdit: can, canDelete: can && canDeleteVia(auth, 'activity.edit', a.project_id) } });
    }
    const detail: StageDetail = { stage: { ...stage, owner_name: idx.name(stage.owner_user_id) } as Stage, activities, perms: { canEditActivities: await canAddActivityToStage(db, auth, stage) } };
    res.json(detail);
  }));

  r.patch('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { stage, project } = await loadStage(db, auth, req.params.id);
    assertOpen(project);
    await ensureAction(db, auth, 'stage.edit', { projectId: project.project_id, entity: 'stage', id: stage.stage_id });
    if (!(await canEditStage(db, auth, stage))) await denyRow(db, auth, 'You cannot edit this stage.', { projectId: project.project_id, entity: 'stage', id: stage.stage_id });
    const patch = z.object({
      name: z.string().min(1).max(120).optional(), description: optStr, gate_criteria: optStr, owner_user_id: optStr, start_date: optStr,
      end_date: optStr, sort_order: z.coerce.number().optional(), gate_approver_id: optStr,
    }).parse(req.body);
    if (patch.owner_user_id && patch.owner_user_id !== stage.owner_user_id) await assertTeamIds(db, project.project_id, [patch.owner_user_id], 'The stage owner');
    const updated = await db.update<Stage>('stages', stage.stage_id, patch as Partial<Stage>, auth.user.user_id);
    await audit(db, auth, 'stage.update', { type: 'stage', id: stage.stage_id, projectId: project.project_id, details: patch });
    res.json(updated);
  }));

  r.delete('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { stage, project } = await loadStage(db, auth, req.params.id);
    assertOpen(project);
    await ensureAction(db, auth, 'stage.edit', { projectId: project.project_id, entity: 'stage', id: stage.stage_id });
    if (!(await canEditStage(db, auth, stage))) await denyRow(db, auth, 'You cannot delete this stage.', { projectId: project.project_id, entity: 'stage', id: stage.stage_id });
    const me = auth.user.user_id;
    for (const t of await db.find<Task>('tasks', (x) => x.stage_id === stage.stage_id)) await db.softDelete('tasks', t.task_id, me);
    for (const a of await db.find<Activity>('activities', (x) => x.stage_id === stage.stage_id)) await db.softDelete('activities', a.activity_id, me);
    await db.softDelete('stages', stage.stage_id, me);
    if (project.current_stage_id === stage.stage_id) {
      const rest = (await db.find<Stage>('stages', (s) => s.project_id === project.project_id)).sort(byOrder);
      await db.update<Project>('projects', project.project_id, { current_stage_id: rest.find((s) => s.gate_status !== 'Approved')?.stage_id ?? rest[0]?.stage_id ?? null }, me);
    }
    await rollupProject(db, project.project_id, me);
    await audit(db, auth, 'stage.delete', { type: 'stage', id: stage.stage_id, projectId: project.project_id, details: { name: stage.name } });
    res.json({ ok: true });
  }));

  r.post('/:id/gate', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { stage, project } = await loadStage(db, auth, req.params.id);
    assertOpen(project);
    const { action } = z.object({ action: z.enum(['request', 'approve', 'reopen']) }).parse(req.body);
    const me = auth.user.user_id;
    let status: (typeof GATE_STATUS)[number];
    if (action === 'request') {
      if (!(hasAction(auth, 'stage.edit') || (await canAddActivityToStage(db, auth, stage)))) await ensureAction(db, auth, 'stage.edit', { projectId: project.project_id, entity: 'stage', id: stage.stage_id });
      status = 'Pending Approval';
    } else {
      await ensureAction(db, auth, 'stage.gate.approve', { projectId: project.project_id, entity: 'stage', id: stage.stage_id });
      status = action === 'approve' ? 'Approved' : 'Not Ready';
    }
    const updated = await db.update<Stage>('stages', stage.stage_id, { gate_status: status, ...(action === 'approve' ? { gate_approver_id: me } : {}) }, me);
    if (action === 'approve') {
      const stages = (await db.find<Stage>('stages', (s) => s.project_id === project.project_id)).sort(byOrder);
      const next = stages.find((s) => s.sort_order > stage.sort_order && s.gate_status !== 'Approved');
      if (next) await db.update<Project>('projects', project.project_id, { current_stage_id: next.stage_id }, me);
    }
    await audit(db, auth, `stage.gate.${action}`, { type: 'stage', id: stage.stage_id, projectId: project.project_id, details: { name: stage.name, gate_status: status } });
    res.json(updated);
  }));

  r.post('/:id/activities', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { stage, project } = await loadStage(db, auth, req.params.id);
    assertOpen(project);
    if (!(await canAddActivityToStage(db, auth, stage))) {
      await ensureAction(db, auth, 'activity.edit', { projectId: project.project_id, entity: 'activity' });
      await denyRow(db, auth, 'You can only add activities to stages you lead.', { projectId: project.project_id, entity: 'activity' });
    }
    const body = activityTreeBody.parse(req.body);
    const existing = await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id);
    const [act] = await createActivityTree(db, auth.user.user_id, stage, [body], existing.length + 1);
    await rollupProject(db, project.project_id, auth.user.user_id);
    await audit(db, auth, 'activity.create', { type: 'activity', id: act.activity_id, projectId: project.project_id, details: { name: act.name } });
    res.status(201).json(await db.get('activities', act.activity_id));
  }));

  r.post('/:id/activities/bulk', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { stage, project } = await loadStage(db, auth, req.params.id);
    assertOpen(project);
    if (!(await canAddActivityToStage(db, auth, stage))) {
      await ensureAction(db, auth, 'activity.edit', { projectId: project.project_id, entity: 'activity' });
      await denyRow(db, auth, 'You can only add activities to stages you lead.', { projectId: project.project_id, entity: 'activity' });
    }
    const { activities } = z.object({ activities: z.array(activityTreeBody).min(1) }).parse(req.body);
    const existing = await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id);
    const created = await createActivityTree(db, auth.user.user_id, stage, activities, existing.length + 1);
    await rollupProject(db, project.project_id, auth.user.user_id);
    await audit(db, auth, 'activity.bulk_create', { type: 'activity', projectId: project.project_id, details: { stage: stage.name, count: created.length }, ai: !!req.body?.fromAi });
    res.status(201).json(created);
  }));

  r.post('/:id/activities/reorder', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { stage, project } = await loadStage(db, auth, req.params.id);
    assertOpen(project);
    if (!(await canAddActivityToStage(db, auth, stage))) { await ensureAction(db, auth, 'activity.edit', { projectId: project.project_id, entity: 'activity' }); await denyRow(db, auth, 'You can only reorder activities in stages you lead.', { projectId: project.project_id, entity: 'activity' }); }
    const { activityIds } = z.object({ activityIds: z.array(z.string()).min(1) }).parse(req.body);
    const acts = await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id);
    const valid = new Set(acts.map((a) => a.activity_id));
    if (activityIds.some((id) => !valid.has(id))) throw new HttpError(400, 'Activity list does not match this stage.', 'VALIDATION');
    let order = 1;
    for (const id of activityIds) await db.update('activities', id, { sort_order: order++ }, auth.user.user_id);
    for (const a of acts.filter((x) => !activityIds.includes(x.activity_id)).sort(byOrder)) await db.update('activities', a.activity_id, { sort_order: order++ }, auth.user.user_id);
    await audit(db, auth, 'activity.reorder', { type: 'activity', projectId: project.project_id, details: { activityIds } });
    res.json((await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id)).sort(byOrder));
  }));

  return r;
}
