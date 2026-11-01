/**
 * v1.2 verifier regressions: defects found while asking Piku a question bank per screen and persona.
 *  - a question naming a task ("When is X due and who owns it?") answers about that task
 *  - "why is it late?" / "who should follow up on that?" use the task from the previous answer
 *  - naming another visible project from inside a project switches to that project (and stays refused when not visible)
 *  - analysts get readable field names, a masked-contacts notice and correct grammar
 *  - follow-up chips never show truncated activity names; decisions are not repeated
 *  - with Gemini on, the prompt names the focus task; JSON-mode summary still parses
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerPiku, pickFocusTask } from '../src/ai/piku';
import { summarize } from '../src/ai/summary';
import { resetGeminiState } from '../src/ai/gemini';
import { makeDb, authFor, USERS } from './aiFixtures';
import type { LocalJsonAdapter } from '../src/db/adapters/LocalJsonAdapter';
import type { ChatMessage, Task } from '../../shared/types';

let db: LocalJsonAdapter;
beforeAll(async () => { db = await makeDb(); });
beforeEach(() => resetGeminiState());
afterEach(() => { vi.unstubAllGlobals(); delete process.env.GEMINI_API_KEY; });

const PROJECT = 'PRJ-0001';
const STAGE = 'STG-0004';
const ACTIVITY = 'ACT-0014';
const actCtx = { type: 'activity' as const, projectId: PROJECT, stageId: STAGE, activityId: ACTIVITY };

async function firstOpenTask(): Promise<Task> {
  const tasks = await db.find<Task>('tasks', (t) => t.activity_id === ACTIVITY && t.status !== 'Done');
  return tasks.sort((a, b) => a.title.localeCompare(b.title))[0];
}

describe('specific questions about one task', () => {
  it('a question naming a task answers its due date and owner', async () => {
    const task = await firstOpenTask();
    const r = await answerPiku(db, await authFor(db, USERS.manager), { message: `When is ${task.title} due and who owns it?`, language: 'en', context: actCtx });
    expect(r.answer).toContain(task.title);
    expect(r.answer).toMatch(/due \*\*/);
    expect(r.answer).not.toMatch(/^Activity owner:/);
  });

  it('pronoun follow-ups use the task from the previous answer', () => {
    const tasks = [{ title: 'Group applications into waves' }, { title: 'Execute wave 1' }] as Task[];
    const history = [{ sender: 'piku', body: '1 task is overdue:\n- Group applications into waves - Neha Gupta' }] as ChatMessage[];
    expect(pickFocusTask('and why is it late?', tasks, history, undefined, 'overdue')?.title).toBe('Group applications into waves');
    expect(pickFocusTask('who should I chase?', tasks, history, undefined, 'chase')).toBeUndefined();
  });
});

describe('scope', () => {
  it('naming another visible project switches to it (EXEC), but stays refused when not visible (ANALYST)', async () => {
    const rioja = { type: 'project' as const, projectId: 'PRJ-0002' };
    const exec = await answerPiku(db, await authFor(db, USERS.exec), { message: 'Tell me about Project Phoenix', language: 'en', context: rioja });
    expect(exec.answer).toContain('Project Phoenix');
    expect(exec.answer).not.toContain('Project Rioja');
    const analystCtx = { type: 'project' as const, projectId: PROJECT };
    const a = await answerPiku(db, await authFor(db, USERS.analyst), { message: 'Tell me about Project Cobalt', language: 'en', context: analystCtx });
    expect(a.mode).toBe('rules (permissions)');
  });
});

describe('wording for limited roles', () => {
  it('analyst edit rights use readable field names; masked contacts are explained', async () => {
    const own = await db.find<Task>('tasks', (t) => t.assignee_user_id === USERS.analyst && t.project_id === PROJECT);
    const ctx = { type: 'task' as const, projectId: PROJECT, taskId: own[0].task_id };
    const auth = await authFor(db, USERS.analyst);
    const edit = await answerPiku(db, auth, { message: 'Can I edit this task?', language: 'en', context: ctx });
    expect(edit.answer).toContain('% complete');
    expect(edit.answer).not.toMatch(/percent_complete|done_notes/);
    const phone = await answerPiku(db, auth, { message: "Give me the client's phone number", language: 'en', context: actCtx });
    expect(phone.answer).toMatch(/masked/i);
    expect(phone.answer).not.toMatch(/\+\d{2} \d{5} \d{5}/);
  });

  it('no "1 task(s)" / "1 people" grammar and no repeated decisions', async () => {
    const r = await answerPiku(db, await authFor(db, USERS.manager), { message: 'What are the biggest risks?', language: 'en', context: actCtx });
    expect(r.answer).not.toMatch(/task\(s\)|item\(s\)|1 people/);
    const decisions = r.answer.split('\n').filter((l) => /Agreed|approved|decided/i.test(l));
    expect(new Set(decisions.map((l) => l.replace(/\(.*\)$/, '').trim())).size).toBe(decisions.length);
  });
});

describe('screen chips', () => {
  it('never truncate the activity name on its own screen', async () => {
    const r = await answerPiku(db, await authFor(db, USERS.manager), { message: 'What is overdue?', language: 'en', context: actCtx });
    for (const s of r.suggestedActions ?? []) expect(s.label).not.toContain('…');
  });
});

describe('Gemini path', () => {
  it('the prompt names the task the question is about', async () => {
    const task = await firstOpenTask();
    const prompts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).includes('?pageSize=')) return { ok: true, status: 200, json: async () => ({ models: [] }), text: async (): Promise<string> => '' };
      prompts.push(JSON.parse(init.body).contents[0].parts[0].text);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'It is due soon [1].' }] } }] }), text: async (): Promise<string> => '' };
    }));
    process.env.GEMINI_API_KEY = 'k-test';
    await answerPiku(db, await authFor(db, USERS.manager), { message: `When is ${task.title} due?`, language: 'en', context: actCtx });
    expect(prompts.join('\n')).toContain(`The user is asking about task "${task.title}"`);
  });

  it('JSON-mode summary still parses a Gemini answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('?pageSize=')) return { ok: true, status: 200, json: async () => ({ models: [] }), text: async (): Promise<string> => '' };
      return { ok: true, status: 200, text: async (): Promise<string> => '', json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"summary":"All good.","highlights":["h"],"risks":["r"],"nextSteps":["n"]}' }] } }] }) };
    }));
    process.env.GEMINI_API_KEY = 'k-test';
    const s = await summarize(db, await authFor(db, USERS.manager), 'activity', ACTIVITY);
    expect(s.summary).toBe('All good.');
    expect(s.mode).not.toBe('offline');
  });
});

describe('decisions', () => {
  it('lists recorded decisions for roles that see communications, and explains when the role cannot', async () => {
    const m = await answerPiku(db, await authFor(db, USERS.manager), { message: 'What decisions were taken?', language: 'en', context: actCtx });
    expect(m.answer).toMatch(/^(Decisions recorded here:|No decisions are recorded)/);
    const c = await answerPiku(db, await authFor(db, USERS.client), { message: 'What decisions were taken in recent meetings?', language: 'en', context: { type: 'project', projectId: PROJECT } });
    expect(c.answer).toMatch(/cannot see meeting notes/);
  });
});
