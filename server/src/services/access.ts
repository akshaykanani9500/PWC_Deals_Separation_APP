/**
 * Data-access rules shared by REST routes (Agent 1) and AI features (Agent 3).
 * SIGNATURES ARE A CONTRACT - do not change parameters or return types.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Project, Contact, Communication, Task, Activity, Stage, ProjectMember } from '../../../shared/types';
import { CLIENT_HIDDEN_PROJECT_FIELDS, FINANCE_FIELDS, maskContact } from '../../../shared/permissions';
import { HttpError } from '../errors';
import { audit } from './audit';
import { applyProjectGrants, rowCode } from './grants';

const has = (auth: AuthContext, a: string) => (auth.actions as string[]).includes(a);

/** Project ids this user may see (scope 'all' => every non-deleted project; 'member' => project_members rows). */
export async function visibleProjectIds(db: Db, auth: AuthContext): Promise<Set<string>> {
  if (auth.scope === 'all') {
    return new Set((await db.all<Project>('projects')).map((p) => p.project_id));
  }
  const live = new Set((await db.all<Project>('projects')).map((p) => p.project_id));
  const mine = await db.find<ProjectMember>('project_members', (m) => m.user_id === auth.user.user_id);
  const ids = new Set<string>();
  for (const m of mine) if (live.has(m.project_id)) ids.add(m.project_id);
  // Partners / managers named on the project also see it even without a member row.
  for (const p of await db.all<Project>('projects')) {
    if (p.partner_user_id === auth.user.user_id || p.manager_user_id === auth.user.user_id) ids.add(p.project_id);
  }
  return ids;
}

/** Throws an HttpError(403) when the project is not visible (404 when it does not exist). Returns the project when it is. */
export async function assertProjectAccess(db: Db, auth: AuthContext, projectId: string): Promise<Project> {
  const project = await db.get<Project>('projects', projectId);
  if (!project || project.is_deleted === 'Y') throw new HttpError(404, 'Project not found.', 'NOT_FOUND');
  if (!has(auth, 'project.view')) {
    await audit(db, auth, 'access.denied', { type: 'project', id: projectId, projectId, details: { needed: ['project.view'] } });
    throw new HttpError(403, 'Your role cannot open projects.', 'FORBIDDEN');
  }
  const visible = await visibleProjectIds(db, auth);
  if (!visible.has(projectId)) {
    await audit(db, auth, 'access.denied', { type: 'project', id: projectId, projectId, details: { reason: 'not staffed on project' } });
    throw new HttpError(403, 'You are not staffed on this project.', 'FORBIDDEN');
  }
  // Approved, unexpired access grants for this project (two-level governance) switch on extra actions for this request.
  await applyProjectGrants(db, auth, projectId);
  return project;
}

/** Remove fields this persona may not receive (finance without finance.view; CLIENT hidden fields). */
export function sanitizeProject<T extends Partial<Project>>(project: T, auth: AuthContext): T {
  const out: Record<string, unknown> = { ...project };
  if (!has(auth, 'finance.view')) for (const f of FINANCE_FIELDS) delete out[f];
  if (auth.code === 'CLIENT') for (const f of CLIENT_HIDDEN_PROJECT_FIELDS) delete out[f];
  return out as T;
}

/** Mask phone/email unless contacts.view.full. */
export function sanitizeContact(contact: Contact, auth: AuthContext): Contact {
  if (has(auth, 'contacts.view.full')) return contact;
  return { ...contact, email: maskContact(contact.email), phone: maskContact(contact.phone) };
}

/** CLIENT persona only sees channel 'Meeting'; others need comms.view. Phone numbers inside bodies are masked without contacts.view.full. */
export function filterCommunications(comms: Communication[], auth: AuthContext): Communication[] {
  if (auth.code === 'CLIENT') return comms.filter((c) => c.channel === 'Meeting');
  if (!has(auth, 'comms.view')) return [];
  if (has(auth, 'contacts.view.full')) return comms;
  return comms.map((c) => ({
    ...c,
    body: c.body?.replace(/\+?\d[\d\s-]{8,}\d/g, (m) => maskContact(m)),
    subject: c.subject?.replace(/\+?\d[\d\s-]{8,}\d/g, (m) => maskContact(m)),
  }));
}

async function isProjectClosed(db: Db, projectId: string) {
  const p = await db.get<Project>('projects', projectId);
  return !p || p.status === 'Closed' || p.is_deleted === 'Y';
}

/** Is this LEAD the owner/workstream lead of the stage? */
async function leadsStage(db: Db, auth: AuthContext, stage: Stage): Promise<boolean> {
  if (stage.owner_user_id === auth.user.user_id) return true;
  const mem = await db.find<ProjectMember>('project_members', (m) => m.project_id === stage.project_id && m.user_id === auth.user.user_id);
  const target = stage.name.trim().toLowerCase();
  return mem.some((m) => (m.workstream || '').split(/[,;|]/).map((s) => s.trim().toLowerCase()).filter(Boolean).some((w) => w === target || target.includes(w) || w.includes(target)));
}

async function visible(db: Db, auth: AuthContext, projectId: string) {
  return (await visibleProjectIds(db, auth)).has(projectId);
}

export async function canEditStage(db: Db, auth: AuthContext, stage: Stage): Promise<boolean> {
  if (!has(auth, 'stage.edit')) return false;
  if (await isProjectClosed(db, stage.project_id)) return false;
  return visible(db, auth, stage.project_id);
}

export async function canEditActivity(db: Db, auth: AuthContext, activity: Activity): Promise<boolean> {
  if (!has(auth, 'activity.edit')) return false;
  if (await isProjectClosed(db, activity.project_id)) return false;
  if (!(await visible(db, auth, activity.project_id))) return false;
  if (rowCode(auth, activity.project_id) === 'LEAD') {
    const stage = await db.get<Stage>('stages', activity.stage_id);
    return !!stage && leadsStage(db, auth, stage);
  }
  return true;
}

/** Can the user add activities to this stage? (same row rule as editing) */
export async function canAddActivityToStage(db: Db, auth: AuthContext, stage: Stage): Promise<boolean> {
  if (!has(auth, 'activity.edit')) return false;
  if (await isProjectClosed(db, stage.project_id)) return false;
  if (!(await visible(db, auth, stage.project_id))) return false;
  if (rowCode(auth, stage.project_id) === 'LEAD') return leadsStage(db, auth, stage);
  return true;
}

export const OWN_TASK_FIELDS: (keyof Task)[] = ['status', 'percent_complete', 'done_notes', 'pending_notes', 'dependency_notes'];
export const ALL_TASK_FIELDS: (keyof Task)[] = [
  'title', 'description', 'assignee_user_id', 'status', 'priority', 'start_date', 'due_date', 'completed_date', 'effort_hours',
  'percent_complete', 'day1_critical', 'dependency_notes', 'done_notes', 'pending_notes', 'sort_order',
];

export async function canEditTask(db: Db, auth: AuthContext, task: Task): Promise<{ canEdit: boolean; canDelete: boolean; editableFields: (keyof Task)[] }> {
  const none = { canEdit: false, canDelete: false, editableFields: [] as (keyof Task)[] };
  if (await isProjectClosed(db, task.project_id)) return none;
  if (!(await visible(db, auth, task.project_id))) return none;
  if (has(auth, 'task.edit')) {
    let full = true;
    if (rowCode(auth, task.project_id) === 'LEAD') {
      const stage = await db.get<Stage>('stages', task.stage_id);
      full = !!stage && (await leadsStage(db, auth, stage));
    }
    if (full) return { canEdit: true, canDelete: true, editableFields: [...ALL_TASK_FIELDS] };
  }
  if (has(auth, 'task.edit.own') && task.assignee_user_id === auth.user.user_id) {
    return { canEdit: true, canDelete: false, editableFields: [...OWN_TASK_FIELDS] };
  }
  return none;
}

/** Can the user add tasks to this activity? */
export async function canAddTaskToActivity(db: Db, auth: AuthContext, activity: Activity): Promise<boolean> {
  if (!has(auth, 'task.edit')) return false;
  if (await isProjectClosed(db, activity.project_id)) return false;
  if (!(await visible(db, auth, activity.project_id))) return false;
  if (rowCode(auth, activity.project_id) === 'LEAD') {
    const stage = await db.get<Stage>('stages', activity.stage_id);
    return !!stage && leadsStage(db, auth, stage);
  }
  return true;
}
