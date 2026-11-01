/** Dashboard "Recent activity" shows meaningful changes only, with readable names and links. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, USERS } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => { t = await makeTestApp(); }, 60000);
afterAll(() => t.cleanup());

describe('dashboard recent activity feed', () => {
  it('hides sign-ins and read-only AI calls, keeps edits with labels and links', async () => {
    const ananya = t.as(USERS.ananya);
    const list = (await ananya.get('/api/projects')).body as { project_id: string }[];
    const pid = list[0].project_id;
    const detail = (await ananya.get(`/api/projects/${pid}`)).body;
    const stage = (await ananya.get(`/api/stages/${detail.stages[0].stage_id}`)).body;
    const act = (await ananya.get(`/api/activities/${stage.activities[0].activity_id}`)).body;
    const task = act.tasks[0];

    // Noise: AI reads
    await ananya.post('/api/ai/summary', { scope: 'project', id: pid });
    await ananya.post('/api/ai/piku', { message: 'status?', language: 'en', context: { type: 'project', projectId: pid } });
    // Signal: a real edit
    const patched = await ananya.patch(`/api/tasks/${task.task_id}`, { pending_notes: 'feed test' });
    expect(patched.status).toBe(200);

    const feed = (await ananya.get('/api/dashboard')).body.recentActivity as any[];
    expect(feed.length).toBeGreaterThan(0);
    for (const a of feed) {
      expect(a.action).not.toMatch(/^(auth\.|ai\.|access\.)/);
      expect(a.href, `entry ${a.action} has a link`).toMatch(/^\/projects\//);
      expect(a.record_label, `entry ${a.action} has a readable name`).toBeTruthy();
    }
    const mine = feed.find((a) => a.entity_id === task.task_id && a.action === 'task.update');
    expect(mine).toBeTruthy();
    expect(mine.record_label).toBe(task.title);
    expect(mine.href).toContain(`?task=${task.task_id}`);
  });

  it('client feed has no AI-assisted entries and no change details', async () => {
    const feed = (await t.as(USERS.lisa).get('/api/dashboard')).body.recentActivity as any[];
    for (const a of feed) {
      expect(a.ai_generated).not.toBe('Y');
      expect(a.details ?? null).toBeNull();
      expect(a.action).toMatch(/^(task\.(update|create)|stage\.gate|activity\.(create|update))/);
    }
  });
});
