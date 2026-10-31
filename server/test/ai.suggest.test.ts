import { beforeAll, describe, expect, it } from 'vitest';
import { suggest } from '../src/ai/suggest';
import { makeDb, authFor, USERS } from './aiFixtures';
import type { LocalJsonAdapter } from '../src/db/adapters/LocalJsonAdapter';
import type { Activity, KnowledgeItem, Stage, Task } from '../../shared/types';

let db: LocalJsonAdapter;
let stage: Stage; let activity: Activity; let task: Task;
beforeAll(async () => {
  delete process.env.GEMINI_API_KEY;
  db = await makeDb();
  stage = (await db.find<Stage>('stages', (s) => s.project_id === 'PRJ-0001'))[0];
  activity = (await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id))[0];
  task = (await db.find<Task>('tasks', (t) => t.activity_id === activity.activity_id))[0];
});

const run = async (req: any, user = USERS.manager) => suggest(db, await authFor(db, user), req);

describe('AI suggest shapes', () => {
  it('project: five stages with activities and tasks, reusing approved knowledge', async () => {
    const before = await db.all<KnowledgeItem>('knowledge_items');
    const r = await run({ kind: 'project', hints: { deal_type: 'TSA exit', industry: 'Financial Services & Payments', name: 'Project Test' } });
    const d = r.draft as any;
    expect(d.stages).toHaveLength(5);
    for (const s of d.stages) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.gate_criteria).toBe('string');
      expect(s.activities.length).toBeGreaterThan(0);
      for (const a of s.activities) for (const t of a.tasks) expect(['Y', 'N']).toContain(t.day1_critical);
    }
    expect(r.mode).toBe('offline');
    expect(r.sources.length).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain('source_project_id');
    const after = await db.all<KnowledgeItem>('knowledge_items');
    const usedSum = (xs: KnowledgeItem[]) => xs.reduce((s, k) => s + Number(k.times_used ?? 0), 0);
    expect(usedSum(after)).toBeGreaterThanOrEqual(usedSum(before));
  });

  it('stages: array of stage objects', async () => {
    const r = await run({ kind: 'stages', projectId: 'PRJ-0001' });
    expect(Array.isArray(r.draft)).toBe(true);
    for (const s of r.draft as any[]) expect(typeof s.name).toBe('string');
  });

  it('stage: single object with gate criteria', async () => {
    const r = await run({ kind: 'stage', projectId: 'PRJ-0001', current: { name: 'Day-1 Readiness' } });
    expect((r.draft as any).gate_criteria).toMatch(/Go decision/);
  });

  it('activities: no duplicates of existing ones', async () => {
    const r = await run({ kind: 'activities', stageId: stage.stage_id });
    const existing = (await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id)).map((a) => a.name.toLowerCase());
    for (const a of r.draft as any[]) {
      expect(existing).not.toContain(a.name.toLowerCase());
      expect(Array.isArray(a.tasks)).toBe(true);
    }
  });

  it('activity: name, priority and due date', async () => {
    const r = await run({ kind: 'activity', stageId: stage.stage_id, current: { name: 'Licence consents' } });
    const d = r.draft as any;
    expect(d.name).toBe('Licence consents');
    expect(['Low', 'Medium', 'High', 'Critical']).toContain(d.priority);
    expect(d.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('tasks: array with titles, priority, Day-1 flag, effort', async () => {
    const r = await run({ kind: 'tasks', activityId: activity.activity_id });
    for (const t of r.draft as any[]) {
      expect(typeof t.title).toBe('string');
      expect(['Y', 'N']).toContain(t.day1_critical);
      expect(typeof t.effort_hours).toBe('number');
    }
  });

  it('task: a field patch based on history', async () => {
    const r = await run({ kind: 'task', taskId: task.task_id });
    expect(Array.isArray(r.draft)).toBe(false);
    expect(typeof r.rationale).toBe('string');
  });

  it('refuses ids outside the user scope (404)', async () => {
    const hidden = (await db.find<Stage>('stages', (s) => s.project_id === 'PRJ-0002'))[0];
    await expect(run({ kind: 'activities', stageId: hidden.stage_id }, USERS.analyst)).rejects.toMatchObject({ status: 404 });
  });
});
