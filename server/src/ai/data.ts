/**
 * Permission-scoped data loading for the AI layer. Every AI feature reads data ONLY through here,
 * which in turn uses services/access.ts (the same rules as the REST API).
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import { applyProjectGrants } from '../services/grants';
import type {
  Activity, Communication, Contact, KnowledgeItem, Project, QuickNote, Stage, Task, TsaService, User, PersonaCode,
} from '../../../shared/types';
import { visibleProjectIds, sanitizeProject, sanitizeContact, filterCommunications } from '../services/access';
import { todayIso } from './lang';
import { maskContact } from '../../../shared/permissions';

export interface Scope {
  type: 'global' | 'project' | 'stage' | 'activity' | 'task';
  projectIds: string[];
  project?: Project;
  stage?: Stage;
  activity?: Activity;
  task?: Task;
}

export interface ScopedData {
  scope: Scope;
  projects: Project[];          // sanitized
  stages: Stage[];
  activities: Activity[];
  tasks: Task[];                // tasks inside the scope (whole project for project scope, etc.)
  users: Map<string, User>;
  personaByUser: Map<string, PersonaCode>;
}

export const can = (auth: AuthContext, action: string) => (auth.actions as string[]).includes(action);
export const isOverdue = (t: Task) => !!t.due_date && t.status !== 'Done' && t.due_date < todayIso();

export function userName(users: Map<string, User>, id?: string | null): string {
  if (!id) return 'Unassigned';
  return users.get(id)?.full_name ?? 'Unassigned';
}

export function hrefFor(kind: 'project' | 'stage' | 'activity' | 'task', ids: { projectId: string; stageId?: string; activityId?: string; taskId?: string }): string {
  const base = `/projects/${ids.projectId}`;
  if (kind === 'project' || !ids.stageId) return base;
  if (kind === 'stage' || !ids.activityId) return `${base}/stages/${ids.stageId}`;
  const act = `${base}/stages/${ids.stageId}/activities/${ids.activityId}`;
  if (kind === 'task' && ids.taskId) return `${act}?task=${ids.taskId}`;
  return act;
}

export function taskHref(t: Task) {
  return hrefFor('task', { projectId: t.project_id, stageId: t.stage_id, activityId: t.activity_id, taskId: t.task_id });
}

async function loadUsers(db: Db) {
  const [users, personas] = await Promise.all([db.all<User>('users', { includeDeleted: true }), db.all<any>('personas', { includeDeleted: true })]);
  const codeByPersona = new Map<string, PersonaCode>(personas.map((p: any) => [p.persona_id, p.code]));
  const map = new Map(users.map((u) => [u.user_id, u]));
  const personaByUser = new Map(users.map((u) => [u.user_id, codeByPersona.get(u.persona_id) as PersonaCode]));
  return { map, personaByUser };
}

export interface ContextInput { projectId?: string; stageId?: string; activityId?: string; taskId?: string }

/**
 * Resolve the scope from page context (+ optional project mentioned by name in the message).
 * Ids that point outside the user's visible projects are silently dropped (never trusted).
 */
export async function resolveScope(db: Db, auth: AuthContext, ctx: ContextInput, message = ''): Promise<{ scope: Scope; visible: Set<string> }> {
  const visible = await visibleProjectIds(db, auth);
  let task: Task | undefined;
  let activity: Activity | undefined;
  let stage: Stage | undefined;
  let project: Project | undefined;

  if (ctx.taskId) { const r = await db.get<Task>('tasks', ctx.taskId); if (r && r.is_deleted !== 'Y' && visible.has(r.project_id)) task = r; }
  const activityId = ctx.activityId ?? task?.activity_id;
  if (activityId) { const r = await db.get<Activity>('activities', activityId); if (r && r.is_deleted !== 'Y' && visible.has(r.project_id)) activity = r; }
  const stageId = ctx.stageId ?? activity?.stage_id ?? task?.stage_id;
  if (stageId) { const r = await db.get<Stage>('stages', stageId); if (r && r.is_deleted !== 'Y' && visible.has(r.project_id)) stage = r; }
  const projectId = ctx.projectId ?? stage?.project_id ?? activity?.project_id ?? task?.project_id;
  if (projectId && visible.has(projectId)) { const r = await db.get<Project>('projects', projectId); if (r && r.is_deleted !== 'Y') project = r; }

  // Consistency: a child must belong to the resolved project.
  if (project) {
    if (stage && stage.project_id !== project.project_id) stage = undefined;
    if (activity && activity.project_id !== project.project_id) activity = undefined;
    if (task && task.project_id !== project.project_id) task = undefined;
  }

  if (message) {
    // "status of Phoenix" -> scope to that project (only if visible). From inside another project this
    // switches to the named project, so "Tell me about Project Phoenix" on a Rioja screen answers about Phoenix.
    const all = await db.find<Project>('projects', (p) => visible.has(p.project_id));
    const lower = message.toLowerCase();
    const hit = all.find((p) => {
      const name = (p.code_name || '').toLowerCase().replace(/^project\s+/, '');
      return name.length >= 3 && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower);
    });
    if (hit && (!project || hit.project_id !== project.project_id)) {
      project = hit; stage = undefined; activity = undefined; task = undefined;
    }
  }

  // Someone who can see exactly one project (e.g. the client viewer): dashboard questions are about that project.
  const askedForSomething = !!(ctx.projectId || ctx.stageId || ctx.activityId || ctx.taskId);
  if (!askedForSomething && !project && visible.size === 1) {
    const only = await db.get<Project>('projects', [...visible][0]);
    if (only && only.is_deleted !== 'Y') project = only;
  }

  // Approved access grants apply only inside the one project being discussed (never on portfolio-wide answers).
  await applyProjectGrants(db, auth, project?.project_id ?? null);

  if (task) return { scope: { type: 'task', projectIds: [task.project_id], project, stage, activity, task }, visible };
  if (activity) return { scope: { type: 'activity', projectIds: [activity.project_id], project, stage, activity }, visible };
  if (stage) return { scope: { type: 'stage', projectIds: [stage.project_id], project, stage }, visible };
  if (project) return { scope: { type: 'project', projectIds: [project.project_id], project }, visible };
  return { scope: { type: 'global', projectIds: Array.from(visible) }, visible };
}

/** Load tracker data for a scope. */
export async function loadScoped(db: Db, auth: AuthContext, scope: Scope): Promise<ScopedData> {
  const ids = new Set(scope.projectIds);
  const [projects, stages, activities, tasks, { map: users, personaByUser }] = await Promise.all([
    db.find<Project>('projects', (p) => ids.has(p.project_id)),
    db.find<Stage>('stages', (s) => ids.has(s.project_id)),
    db.find<Activity>('activities', (a) => ids.has(a.project_id)),
    db.find<Task>('tasks', (t) => ids.has(t.project_id)),
    loadUsers(db),
  ]);
  let scopedTasks = tasks;
  let scopedActivities = activities;
  let scopedStages = stages;
  if (scope.type === 'task' && scope.task) scopedTasks = tasks.filter((t) => t.task_id === scope.task!.task_id);
  else if (scope.type === 'activity' && scope.activity) scopedTasks = tasks.filter((t) => t.activity_id === scope.activity!.activity_id);
  else if (scope.type === 'stage' && scope.stage) {
    scopedTasks = tasks.filter((t) => t.stage_id === scope.stage!.stage_id);
    scopedActivities = activities.filter((a) => a.stage_id === scope.stage!.stage_id);
  }
  if (scope.type === 'activity' || scope.type === 'task') {
    scopedActivities = activities.filter((a) => a.activity_id === (scope.activity?.activity_id ?? scope.task?.activity_id));
  }
  if (scope.type !== 'global' && scope.type !== 'project' && scope.stage) scopedStages = stages.filter((s) => s.stage_id === scope.stage!.stage_id);

  return {
    scope,
    projects: projects.map((p) => sanitizeProject(p, auth)),
    stages: scopedStages.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    activities: scopedActivities.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    tasks: scopedTasks,
    users,
    personaByUser,
  };
}

/** Communications in scope, filtered by the persona rules. Empty without comms.view. */
export async function loadComms(db: Db, auth: AuthContext, scope: Scope): Promise<Communication[]> {
  if (!can(auth, 'comms.view')) return [];
  const ids = new Set(scope.projectIds);
  let rows = await db.find<Communication>('communications', (c) => ids.has(c.project_id));
  if (scope.type === 'task' && scope.task) rows = rows.filter((c) => c.task_id === scope.task!.task_id || (!c.task_id && c.activity_id === scope.task!.activity_id));
  else if (scope.type === 'activity' && scope.activity) rows = rows.filter((c) => c.activity_id === scope.activity!.activity_id);
  else if (scope.type === 'stage' && scope.stage) rows = rows.filter((c) => c.stage_id === scope.stage!.stage_id);
  rows = filterCommunications(rows, auth);
  if (!can(auth, 'contacts.view.full')) rows = rows.map((c) => ({ ...c, subject: maskPii(c.subject), body: maskPii(c.body), ai_summary: maskPii(c.ai_summary), from_name: maskPii(c.from_name), to_name: maskPii(c.to_name) }));
  return rows.sort((a, b) => (b.occurred_at || '').localeCompare(a.occurred_at || ''));
}

const PHONE = /\+?\d[\d ()-]{7,}\d/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Mask phone numbers and email addresses inside free text (for roles whose contacts are masked). */
export function maskPii<T extends string | undefined | null>(text: T): T {
  if (!text) return text;
  return text.replace(EMAIL, (e) => maskContact(e)).replace(PHONE, (p) => maskContact(p)) as T;
}

export async function loadNotes(db: Db, scope: Scope): Promise<QuickNote[]> {
  const ids = new Set(scope.projectIds);
  let rows = await db.find<QuickNote>('quick_notes', (n) => ids.has(n.project_id));
  if (scope.type === 'task' && scope.task) rows = rows.filter((n) => n.task_id === scope.task!.task_id);
  else if (scope.type === 'activity' && scope.activity) rows = rows.filter((n) => n.activity_id === scope.activity!.activity_id);
  else if (scope.type === 'stage' && scope.stage) rows = rows.filter((n) => n.stage_id === scope.stage!.stage_id);
  return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

/** Contacts: none for CLIENT; masked for personas without contacts.view.full. */
export async function loadContacts(db: Db, auth: AuthContext, scope: Scope): Promise<Contact[]> {
  if (auth.code === 'CLIENT') return [];
  const ids = new Set(scope.projectIds);
  const rows = await db.find<Contact>('contacts', (c) => ids.has(c.project_id));
  return rows.map((c) => sanitizeContact(c, auth));
}

export async function loadTsa(db: Db, scope: Scope): Promise<TsaService[]> {
  const ids = new Set(scope.projectIds);
  return db.find<TsaService>('tsa_services', (s) => ids.has(s.project_id));
}

export async function loadApprovedKnowledge(db: Db): Promise<KnowledgeItem[]> {
  return db.find<KnowledgeItem>('knowledge_items', (k) => k.review_status === 'Approved');
}

export function pct(n: number | null | undefined): string {
  return `${Math.round(Number(n ?? 0))}%`;
}

export function completion(tasks: Task[]): number {
  if (!tasks.length) return 0;
  return Math.round(tasks.reduce((s, t) => s + (t.status === 'Done' ? 100 : Number(t.percent_complete ?? 0)), 0) / tasks.length);
}
