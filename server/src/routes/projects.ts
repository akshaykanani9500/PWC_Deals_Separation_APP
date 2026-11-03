import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthContext, AuthedRequest } from '../auth-types';
import type {
  Activity, Communication, Contact, Project, ProjectDetail, ProjectListItem, ProjectMember, Stage, Task,
} from '../../../shared/types';
import { DEFAULT_STAGES } from '../../../shared/defaults';
import { COMM_CHANNELS, DEAL_TYPES, INDUSTRIES, MEMBER_ROLES, PRIORITY, PROJECT_STATUS, RAG, SENSITIVITY, CONSENT_STATUS } from '../../../shared/schema';
import { ah, HttpError } from '../errors';
import { ensureAction, hasAction } from '../middleware/auth';
import {
  assertProjectAccess, canEditStage, filterCommunications, sanitizeContact, sanitizeProject, visibleProjectIds,
} from '../services/access';
import { audit } from '../services/audit';
import { activeGrantsFor } from '../services/grants';
import { permissionLabel } from '../../../shared/access';
import { isOverdue, rollupProject, today } from '../services/rollup';
import { assertOpen, byOrder, pickFields, userIndex } from './helpers';

const optStr = z.string().optional().nullable();
const optNum = z.coerce.number().optional().nullable();

export const projectFields = z.object({
  code_name: z.string().min(1).max(80),
  client_alias: optStr, deal_type: z.enum(DEAL_TYPES).optional().nullable(), industry: z.enum(INDUSTRIES).optional().nullable(),
  description: optStr, status: z.enum(PROJECT_STATUS).optional(), rag: z.enum(RAG).optional().nullable(),
  partner_user_id: optStr, manager_user_id: optStr, start_date: optStr, target_close_date: optStr, currency: optStr,
  fee_budget: optNum, fee_billed: optNum, tsa_monthly_cost: optNum, one_time_cost: optNum, funding_gap: optNum,
  spa_seller_cap: optNum, spa_clause_ref: z.string().max(80).optional().nullable(),
  apps_in_scope: optNum, sites_in_scope: optNum, employees_conveying: optNum, sensitivity: z.enum(SENSITIVITY).optional().nullable(),
  data_residency: optStr, clean_team_required: z.enum(['Y', 'N']).optional().nullable(), reuse_consent: z.enum(CONSENT_STATUS).optional().nullable(),
  tags: optStr, current_stage_id: optStr,
});

const taskTree = z.object({
  title: z.string().min(1), description: optStr, priority: z.enum(PRIORITY).optional().nullable(), day1_critical: z.enum(['Y', 'N']).optional().nullable(),
  assignee_user_id: optStr, due_date: optStr, effort_hours: optNum,
});
const activityTree = z.object({
  name: z.string().min(1), description: optStr, priority: z.enum(PRIORITY).optional().nullable(), owner_user_id: optStr,
  start_date: optStr, due_date: optStr, tasks: z.array(taskTree).optional(),
});
export const stageTree = z.object({
  name: z.string().min(1), description: optStr, gate_criteria: optStr, owner_user_id: optStr, start_date: optStr, end_date: optStr,
  activities: z.array(activityTree).optional(),
});
export type StageTree = z.infer<typeof stageTree>;
export type ActivityTree = z.infer<typeof activityTree>;

const FIN_FIELDS = ['fee_budget', 'fee_billed', 'tsa_monthly_cost', 'one_time_cost', 'funding_gap', 'spa_seller_cap', 'spa_clause_ref'];

/** Insert activities (+ tasks) under a stage. */
export async function createActivityTree(db: Db, actor: string, stage: Stage, acts: ActivityTree[], startOrder = 1): Promise<Activity[]> {
  const created: Activity[] = [];
  let order = startOrder;
  for (const a of acts) {
    const act = await db.insert<Activity>('activities', {
      project_id: stage.project_id, stage_id: stage.stage_id, name: a.name, description: a.description ?? undefined,
      priority: a.priority ?? 'Medium', owner_user_id: a.owner_user_id ?? stage.owner_user_id ?? null, start_date: a.start_date ?? null,
      due_date: a.due_date ?? null, sort_order: order++, status: 'Not Started', percent_complete: 0,
    }, actor);
    if (a.tasks?.length) {
      await db.insertMany<Task>('tasks', a.tasks.map((t, i) => ({
        project_id: stage.project_id, stage_id: stage.stage_id, activity_id: act.activity_id, title: t.title, description: t.description ?? undefined,
        priority: t.priority ?? 'Medium', day1_critical: t.day1_critical ?? 'N', assignee_user_id: t.assignee_user_id ?? null,
        due_date: t.due_date ?? null, effort_hours: t.effort_hours ?? null, status: 'Not Started', percent_complete: 0, sort_order: i + 1,
      })), actor);
    }
    created.push(act);
  }
  return created;
}

export async function createStageTree(db: Db, actor: string, projectId: string, stages: StageTree[], startOrder = 1): Promise<Stage[]> {
  const out: Stage[] = [];
  let order = startOrder;
  for (const s of stages) {
    const stage = await db.insert<Stage>('stages', {
      project_id: projectId, name: s.name, description: s.description ?? undefined, gate_criteria: s.gate_criteria ?? undefined,
      owner_user_id: s.owner_user_id ?? null, start_date: s.start_date ?? null, end_date: s.end_date ?? null, sort_order: order++,
      status: 'Not Started', percent_complete: 0, gate_status: 'Not Ready',
    }, actor);
    if (s.activities?.length) await createActivityTree(db, actor, stage, s.activities);
    out.push(stage);
  }
  return out;
}

export async function projectDetail(db: Db, auth: AuthContext, projectId: string): Promise<ProjectDetail> {
  const project = await assertProjectAccess(db, auth, projectId);
  const idx = await userIndex(db);
  const closed = project.status === 'Closed';
  const stages = (await db.find<Stage>('stages', (s) => s.project_id === projectId)).sort(byOrder);
  const stageRows = [];
  for (const s of stages) {
    const can = await canEditStage(db, auth, s);
    stageRows.push({ ...s, owner_name: idx.name(s.owner_user_id), perms: { canEdit: can, canDelete: can } });
  }
  const members = (await db.find<ProjectMember>('project_members', (m) => m.project_id === projectId))
    .map((m) => ({ ...m, full_name: idx.name(m.user_id) || m.user_id, persona_code: idx.code(m.user_id)! }));
  return {
    project: { ...sanitizeProject(project, auth), partner_name: idx.name(project.partner_user_id), manager_name: idx.name(project.manager_user_id) },
    stages: stageRows,
    members: auth.code === 'CLIENT' ? members.filter((m) => m.persona_code !== 'ANALYST') : members,
    perms: {
      canEditProject: hasAction(auth, 'project.edit') && !closed,
      canEditStages: hasAction(auth, 'stage.edit') && !closed,
      canClose: hasAction(auth, 'project.close') && !closed,
      canApproveGate: hasAction(auth, 'stage.gate.approve') && !closed,
      canViewFinance: hasAction(auth, 'finance.view'),
      canAddNotes: hasAction(auth, 'notes.add') && !closed,
      canUseAiSuggest: hasAction(auth, 'ai.suggest'),
      canEditFinance: hasAction(auth, 'finance.edit') && !closed,
      canRequestAccess: (auth.baseActions ?? auth.actions).includes('access.request') && !closed,
      canSponsorAccess: (auth.baseActions ?? auth.actions).includes('access.approve') && !closed,
    },
    grants: (await activeGrantsFor(db, auth.user.user_id, projectId)).map((g) => ({ grant_id: g.grant_id, permission_code: g.permission_code, label: permissionLabel(g.permission_code), expires_at: g.expires_at })),
  };
}

export function projectsRouter(db: Db): Router {
  const r = Router();

  // ---------- list ----------
  r.get('/', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const ids = await visibleProjectIds(db, auth);
    const { q, status, industry, rag, includeClosed } = req.query as Record<string, string | undefined>;
    const idx = await userIndex(db);
    const stages = await db.all<Stage>('stages');
    const stageName = new Map(stages.map((s) => [s.stage_id, s.name]));
    const tasks = await db.all<Task>('tasks');
    const members = await db.all<ProjectMember>('project_members');
    const t0 = today();
    let projects = (await db.all<Project>('projects')).filter((p) => ids.has(p.project_id));
    if (!includeClosed || includeClosed === '0') projects = projects.filter((p) => p.status !== 'Closed' || status === 'Closed');
    if (status) projects = projects.filter((p) => p.status === status);
    if (industry) projects = projects.filter((p) => p.industry === industry);
    if (rag) projects = projects.filter((p) => p.rag === rag);
    if (q) {
      const s = q.toLowerCase();
      projects = projects.filter((p) => [p.code_name, p.client_alias, p.deal_type, p.industry, idx.name(p.manager_user_id), idx.name(p.partner_user_id), p.tags].some((v) => v?.toLowerCase().includes(s)));
    }
    const list: ProjectListItem[] = projects.map((p) => {
      const pt = tasks.filter((t) => t.project_id === p.project_id);
      const open = pt.filter((t) => t.status !== 'Done');
      return {
        ...sanitizeProject(p, auth),
        partner_name: idx.name(p.partner_user_id), manager_name: idx.name(p.manager_user_id),
        current_stage_name: stageName.get(p.current_stage_id || ''),
        open_tasks: open.length, overdue_tasks: open.filter((t) => isOverdue(t, t0)).length,
        blocked_tasks: open.filter((t) => t.status === 'Blocked').length,
        team_size: members.filter((m) => m.project_id === p.project_id).length,
      };
    }).sort((a, b) => a.code_name.localeCompare(b.code_name));
    res.json(list);
  }));

  // ---------- create ----------
  r.post('/', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    await ensureAction(db, auth, 'project.create', { entity: 'project' });
    const body = projectFields.extend({
      stages: z.array(stageTree).optional(),
      members: z.array(z.object({ user_id: z.string(), member_role: z.enum(MEMBER_ROLES).optional(), workstream: optStr })).optional(),
    }).parse(req.body);
    const { stages, members, ...fields } = body;
    if (!hasAction(auth, 'finance.edit') && !hasAction(auth, 'finance.view')) for (const f of FIN_FIELDS) delete (fields as any)[f];
    const me = auth.user.user_id;
    const project = await db.insert<Project>('projects', {
      ...(fields as Partial<Project>), status: fields.status ?? 'Planning', rag: 'Green', percent_complete: 0, currency: fields.currency || 'USD',
      partner_user_id: fields.partner_user_id ?? (auth.code === 'PARTNER' ? me : null),
      manager_user_id: fields.manager_user_id ?? (auth.code === 'MANAGER' ? me : null),
      start_date: fields.start_date ?? today(), reuse_consent: fields.reuse_consent ?? 'Pending', sensitivity: fields.sensitivity ?? 'Confidential',
    } as Partial<Project>, me);
    const roleOf = (code?: string) => (code === 'PARTNER' ? 'Partner' : code === 'MANAGER' ? 'Manager' : code === 'LEAD' ? 'Workstream Lead' : code === 'ANALYST' ? 'Analyst' : code === 'CLIENT' ? 'Client Viewer' : 'SME');
    const idx = await userIndex(db);
    const memberRows = new Map<string, { member_role: string; workstream?: string | null }>();
    memberRows.set(me, { member_role: roleOf(auth.code) });
    if (project.partner_user_id) memberRows.set(project.partner_user_id, { member_role: 'Partner' });
    if (project.manager_user_id) memberRows.set(project.manager_user_id, { member_role: 'Manager' });
    for (const m of members || []) if (idx.byId.has(m.user_id)) memberRows.set(m.user_id, { member_role: m.member_role || roleOf(idx.code(m.user_id)), workstream: m.workstream });
    await db.insertMany<ProjectMember>('project_members', [...memberRows.entries()].map(([user_id, m]) => ({
      project_id: project.project_id, user_id, member_role: m.member_role as any, workstream: m.workstream ?? null, clean_team: m.member_role === 'Partner' || m.member_role === 'Manager' ? 'Y' : 'N',
    } as Partial<ProjectMember>)), me);
    const tree: StageTree[] = stages?.length ? stages : DEFAULT_STAGES.map((s) => ({ name: s.name, description: s.description, gate_criteria: s.gate_criteria }));
    const created = await createStageTree(db, me, project.project_id, tree);
    await db.update('projects', project.project_id, { current_stage_id: created[0]?.stage_id ?? null }, me);
    await rollupProject(db, project.project_id, me);
    await audit(db, auth, 'project.create', { type: 'project', id: project.project_id, projectId: project.project_id, details: { code_name: project.code_name, stages: created.length, fromAiPlan: !!req.body?.fromAi }, ai: !!req.body?.fromAi });
    res.status(201).json(await projectDetail(db, auth, project.project_id));
  }));

  // ---------- read / update / delete ----------
  r.get('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    res.json(await projectDetail(db, auth, req.params.id));
  }));

  r.patch('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'project.edit', { projectId: project.project_id, entity: 'project', id: project.project_id });
    if (project.status === 'Closed' && req.body?.status !== 'Closed') assertOpen(project);
    const patch: Record<string, unknown> = projectFields.partial().parse(req.body);
    if (!hasAction(auth, 'finance.edit')) for (const f of FIN_FIELDS) delete patch[f];
    if (patch.status === 'Closed') throw new HttpError(400, 'Use the close-out flow to close a project.', 'VALIDATION');
    delete patch.rag; // computed
    await db.update('projects', project.project_id, patch, auth.user.user_id);
    await audit(db, auth, 'project.update', { type: 'project', id: project.project_id, projectId: project.project_id, details: patch });
    res.json(await projectDetail(db, auth, project.project_id));
  }));

  r.delete('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'project.edit', { projectId: project.project_id, entity: 'project', id: project.project_id });
    if (!['PARTNER', 'MANAGER'].includes(auth.code)) throw new HttpError(403, 'Only partners and managers can delete projects.', 'FORBIDDEN');
    await db.softDelete('projects', project.project_id, auth.user.user_id);
    await audit(db, auth, 'project.delete', { type: 'project', id: project.project_id, projectId: project.project_id });
    res.json({ ok: true });
  }));

  // ---------- finance: see routes/finance.ts (finance workspace, v1.3) ----------

  // ---------- members ----------
  r.get('/:id/members', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    res.json((await projectDetail(db, auth, req.params.id)).members);
  }));

  r.post('/:id/members', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'project.edit', { projectId: project.project_id, entity: 'member' });
    assertOpen(project);
    const body = z.object({ user_id: z.string(), member_role: z.enum(MEMBER_ROLES).optional(), workstream: optStr }).parse(req.body);
    const idx = await userIndex(db);
    if (!idx.byId.has(body.user_id)) throw new HttpError(400, 'Unknown user.', 'VALIDATION');
    const existing = await db.find<ProjectMember>('project_members', (m) => m.project_id === project.project_id && m.user_id === body.user_id);
    const row = existing[0]
      ? await db.update<ProjectMember>('project_members', existing[0].member_id, { member_role: body.member_role, workstream: body.workstream ?? existing[0].workstream ?? undefined }, auth.user.user_id)
      : await db.insert<ProjectMember>('project_members', { project_id: project.project_id, user_id: body.user_id, member_role: body.member_role ?? 'Analyst', workstream: body.workstream ?? undefined, clean_team: 'N' }, auth.user.user_id);
    await audit(db, auth, 'member.add', { type: 'member', id: row.member_id, projectId: project.project_id, details: body });
    res.status(201).json({ ...row, full_name: idx.name(row.user_id), persona_code: idx.code(row.user_id) });
  }));

  r.delete('/:id/members/:memberId', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'project.edit', { projectId: project.project_id, entity: 'member' });
    const m = await db.get<ProjectMember>('project_members', req.params.memberId);
    if (!m || m.project_id !== project.project_id) throw new HttpError(404, 'Member not found.', 'NOT_FOUND');
    await db.softDelete('project_members', m.member_id, auth.user.user_id);
    await audit(db, auth, 'member.remove', { type: 'member', id: m.member_id, projectId: project.project_id });
    res.json({ ok: true });
  }));

  // ---------- contacts & communications ----------
  r.get('/:id/contacts', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    if (auth.code === 'CLIENT') return res.json([]);
    const contacts = await db.find<Contact>('contacts', (c) => c.project_id === project.project_id);
    res.json(contacts.map((c) => sanitizeContact(c, auth)));
  }));

  r.get('/:id/communications', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    const { stageId, activityId, taskId } = req.query as Record<string, string | undefined>;
    let comms = await db.find<Communication>('communications', (c) => c.project_id === project.project_id);
    if (stageId) comms = comms.filter((c) => c.stage_id === stageId);
    if (activityId) comms = comms.filter((c) => c.activity_id === activityId);
    if (taskId) comms = comms.filter((c) => c.task_id === taskId);
    res.json(filterCommunications(comms, auth).sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)));
  }));

  r.post('/:id/communications', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'notes.add', { projectId: project.project_id, entity: 'communication' });
    assertOpen(project);
    const body = z.object({
      channel: z.enum(COMM_CHANNELS), subject: optStr, body: optStr, stage_id: optStr, activity_id: optStr, task_id: optStr, to_name: optStr,
      contact_id: optStr, duration_min: optNum, occurred_at: optStr,
    }).parse(req.body);
    const row = await db.insert<Communication>('communications', {
      ...(body as Partial<Communication>), project_id: project.project_id, from_name: auth.user.full_name, occurred_at: body.occurred_at || new Date().toISOString(),
    }, auth.user.user_id);
    await audit(db, auth, 'communication.create', { type: 'communication', id: row.comm_id, projectId: project.project_id, details: { channel: row.channel, subject: row.subject } });
    res.status(201).json(row);
  }));

  // ---------- stages under a project ----------
  r.post('/:id/stages', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'stage.edit', { projectId: project.project_id, entity: 'stage' });
    assertOpen(project);
    const body = stageTree.parse(req.body);
    const existing = await db.find<Stage>('stages', (s) => s.project_id === project.project_id);
    const [stage] = await createStageTree(db, auth.user.user_id, project.project_id, [body], existing.length + 1);
    await rollupProject(db, project.project_id, auth.user.user_id);
    await audit(db, auth, 'stage.create', { type: 'stage', id: stage.stage_id, projectId: project.project_id, details: { name: stage.name } });
    res.status(201).json(await db.get('stages', stage.stage_id));
  }));

  r.post('/:id/stages/bulk', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'stage.edit', { projectId: project.project_id, entity: 'stage' });
    assertOpen(project);
    const { stages } = z.object({ stages: z.array(stageTree).min(1) }).parse(req.body);
    const existing = await db.find<Stage>('stages', (s) => s.project_id === project.project_id);
    const created = await createStageTree(db, auth.user.user_id, project.project_id, stages, existing.length + 1);
    if (!project.current_stage_id && created[0]) await db.update('projects', project.project_id, { current_stage_id: created[0].stage_id }, auth.user.user_id);
    await rollupProject(db, project.project_id, auth.user.user_id);
    await audit(db, auth, 'stage.bulk_create', { type: 'stage', projectId: project.project_id, details: { count: created.length, names: created.map((s) => s.name) }, ai: !!req.body?.fromAi });
    res.status(201).json(created);
  }));

  r.post('/:id/stages/reorder', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'stage.edit', { projectId: project.project_id, entity: 'stage' });
    assertOpen(project);
    const { stageIds } = z.object({ stageIds: z.array(z.string()).min(1) }).parse(req.body);
    const stages = await db.find<Stage>('stages', (s) => s.project_id === project.project_id);
    const valid = new Set(stages.map((s) => s.stage_id));
    if (stageIds.some((id) => !valid.has(id))) throw new HttpError(400, 'Stage list does not match this project.', 'VALIDATION');
    let order = 1;
    for (const id of stageIds) await db.update('stages', id, { sort_order: order++ }, auth.user.user_id);
    for (const s of stages.filter((x) => !stageIds.includes(x.stage_id)).sort(byOrder)) await db.update('stages', s.stage_id, { sort_order: order++ }, auth.user.user_id);
    await audit(db, auth, 'stage.reorder', { type: 'stage', projectId: project.project_id, details: { stageIds } });
    res.json((await db.find<Stage>('stages', (s) => s.project_id === project.project_id)).sort(byOrder));
  }));

  return r;
}

export { pickFields };
