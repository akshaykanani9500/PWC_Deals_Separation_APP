import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Persona, User, Project, Stage, Activity, Task } from '../../../shared/types';
import { HttpError } from '../errors';
import { assertProjectAccess } from '../services/access';
import { audit } from '../services/audit';

export async function userIndex(db: Db) {
  const users = await db.all<User>('users', { includeDeleted: true });
  const personas = await db.all<Persona>('personas');
  const pcode = new Map(personas.map((p) => [p.persona_id, p.code]));
  const byId = new Map(users.map((u) => [u.user_id, u]));
  return {
    name: (id?: string | null) => (id ? byId.get(id)?.full_name : undefined),
    code: (id?: string | null) => (id ? pcode.get(byId.get(id)?.persona_id || '') : undefined),
    byId,
  };
}

export async function loadStage(db: Db, auth: AuthContext, id: string): Promise<{ stage: Stage; project: Project }> {
  const stage = await db.get<Stage>('stages', id);
  if (!stage || stage.is_deleted === 'Y') throw new HttpError(404, 'Stage not found.', 'NOT_FOUND');
  const project = await assertProjectAccess(db, auth, stage.project_id);
  return { stage, project };
}

export async function loadActivity(db: Db, auth: AuthContext, id: string): Promise<{ activity: Activity; project: Project }> {
  const activity = await db.get<Activity>('activities', id);
  if (!activity || activity.is_deleted === 'Y') throw new HttpError(404, 'Activity not found.', 'NOT_FOUND');
  const project = await assertProjectAccess(db, auth, activity.project_id);
  return { activity, project };
}

export async function loadTask(db: Db, auth: AuthContext, id: string): Promise<{ task: Task; project: Project }> {
  const task = await db.get<Task>('tasks', id);
  if (!task || task.is_deleted === 'Y') throw new HttpError(404, 'Task not found.', 'NOT_FOUND');
  const project = await assertProjectAccess(db, auth, task.project_id);
  return { task, project };
}

export function assertOpen(project: Project) {
  if (project.status === 'Closed') throw new HttpError(403, 'This project is closed and read-only.', 'FORBIDDEN');
}

/** Drop undefined keys and keys not in the allowed list. */
export function pickFields<T extends Record<string, any>>(body: T, allowed: readonly string[]): Partial<T> {
  const out: Record<string, any> = {};
  for (const k of allowed) if (body[k] !== undefined) out[k] = body[k];
  return out as Partial<T>;
}

export const byOrder = (a: { sort_order?: number }, b: { sort_order?: number }) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

/** Audit a row-level denial and throw 403. */
export async function denyRow(db: Db, auth: AuthContext, msg: string, d: { projectId: string; entity: string; id?: string }): Promise<never> {
  await audit(db, auth, 'access.denied', { type: d.entity, id: d.id, projectId: d.projectId, details: { reason: msg } });
  throw new HttpError(403, msg, 'FORBIDDEN');
}
