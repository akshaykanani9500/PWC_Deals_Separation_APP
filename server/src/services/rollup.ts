/**
 * Roll-up rule (docs/API.md): status is computed from the work, never typed by hand at higher levels.
 *  task Done => 100%; activity % = avg of tasks; stage % = avg of activities;
 *  project % = avg of stages weighted by activity count.
 *  Derived status: all Done => Done; any Blocked => Blocked; any progress => In Progress; else Not Started.
 *  RAG: Red if a Critical or Day-1 task is overdue or > 2 tasks blocked; Amber if any task overdue; else Green.
 */
import type { Db } from '../db/Db';
import type { Activity, Project, Stage, Task, WorkStatus, Rag } from '../../../shared/types';

export const today = () => new Date().toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 10) / 10;

export function taskPercent(t: Task): number {
  if (t.status === 'Done') return 100;
  const p = Number(t.percent_complete ?? 0);
  return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
}

export function deriveStatus(items: { status?: WorkStatus | null; percent: number }[]): WorkStatus {
  if (!items.length) return 'Not Started';
  if (items.every((i) => i.status === 'Done')) return 'Done';
  if (items.some((i) => i.status === 'Blocked')) return 'Blocked';
  if (items.some((i) => i.status === 'In Progress' || i.status === 'Done' || i.percent > 0)) return 'In Progress';
  return 'Not Started';
}

export function isOverdue(t: Task, on = today()): boolean {
  return t.status !== 'Done' && !!t.due_date && t.due_date < on;
}

export function computeRag(tasks: Task[], on = today()): Rag {
  const overdue = tasks.filter((t) => isOverdue(t, on));
  const blocked = tasks.filter((t) => t.status === 'Blocked').length;
  if (overdue.some((t) => t.priority === 'Critical' || t.day1_critical === 'Y') || blocked > 2) return 'Red';
  if (overdue.length) return 'Amber';
  return 'Green';
}

/** Recompute activity, stage and project progress for one project. Only writes rows whose values changed. */
export async function rollupProject(db: Db, projectId: string, actorId?: string): Promise<void> {
  const project = await db.get<Project>('projects', projectId);
  if (!project) return;
  const stages = await db.find<Stage>('stages', (s) => s.project_id === projectId);
  const activities = await db.find<Activity>('activities', (a) => a.project_id === projectId);
  const tasks = await db.find<Task>('tasks', (t) => t.project_id === projectId);

  const actResults = new Map<string, { percent: number; status: WorkStatus }>();
  for (const a of activities) {
    const ts = tasks.filter((t) => t.activity_id === a.activity_id);
    const percent = ts.length ? round(ts.reduce((s, t) => s + taskPercent(t), 0) / ts.length) : Number(a.percent_complete ?? 0);
    const status = ts.length ? deriveStatus(ts.map((t) => ({ status: t.status, percent: taskPercent(t) }))) : (a.status || 'Not Started');
    actResults.set(a.activity_id, { percent, status });
    if (a.percent_complete !== percent || a.status !== status) {
      await db.update('activities', a.activity_id, { percent_complete: percent, status }, actorId);
    }
  }

  let weighted = 0;
  let weight = 0;
  for (const s of stages) {
    const acts = activities.filter((a) => a.stage_id === s.stage_id).map((a) => actResults.get(a.activity_id)!);
    const percent = acts.length ? round(acts.reduce((x, a) => x + a.percent, 0) / acts.length) : Number(s.percent_complete ?? 0);
    const status = acts.length ? deriveStatus(acts) : (s.status || 'Not Started');
    weighted += percent * acts.length;
    weight += acts.length;
    if (s.percent_complete !== percent || s.status !== status) {
      await db.update('stages', s.stage_id, { percent_complete: percent, status }, actorId);
    }
  }

  const percent = weight ? round(weighted / weight) : 0;
  const rag = project.status === 'Closed' ? project.rag : computeRag(tasks);
  if (project.percent_complete !== percent || project.rag !== rag) {
    await db.update('projects', projectId, { percent_complete: percent, rag }, actorId);
  }
}
