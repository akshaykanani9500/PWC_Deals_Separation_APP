import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { answerPiku } from '../src/ai/piku';
import { makeDb, authFor, USERS } from './aiFixtures';
import type { LocalJsonAdapter } from '../src/db/adapters/LocalJsonAdapter';
import type { Contact, Project } from '../../shared/types';

let db: LocalJsonAdapter;
beforeAll(async () => { db = await makeDb(); });
beforeEach(() => { delete process.env.GEMINI_API_KEY; });

async function ask(userId: string, message: string, context: any = { type: 'global' }, language: any = 'auto') {
  return answerPiku(db, await authFor(db, userId), { message, language, context });
}

describe('Piku permissions', () => {
  it('a member-scope analyst only gets facts from staffed projects', async () => {
    const projects = await db.all<Project>('projects');
    const auth = await authFor(db, USERS.analyst);
    const { visibleProjectIds } = await import('../src/services/access');
    const visible = await visibleProjectIds(db, auth);
    const hidden = projects.filter((p) => !visible.has(p.project_id));
    expect(hidden.length).toBeGreaterThan(0);

    const r = await ask(USERS.analyst, 'What is the status of all projects?');
    for (const h of hidden) expect(r.answer).not.toContain(h.code_name);
    for (const s of r.sources) if (s.type === 'project') expect(visible.has(s.id)).toBe(true);

    // asking by name about a hidden project, or passing its id as context, reveals nothing
    const target = hidden[0];
    const byName = await ask(USERS.analyst, `What is the status of ${target.code_name}?`);
    expect(byName.answer).not.toMatch(new RegExp(`\\*\\*${target.code_name}\\*\\* is`));
    const byId = await ask(USERS.analyst, 'What is the status here?', { type: 'project', projectId: target.project_id });
    expect(byId.sources.find((s) => s.id === target.project_id)).toBeUndefined();
  });

  it('CLIENT never receives phone numbers, emails or finance', async () => {
    const contacts = await db.all<Contact>('contacts');
    const auth = await authFor(db, USERS.client);
    const { visibleProjectIds } = await import('../src/services/access');
    const pid = [...(await visibleProjectIds(db, auth))][0];
    const ctx = { type: 'project', projectId: pid };
    const c = await ask(USERS.client, 'Give me the phone numbers and emails of the contacts', ctx);
    for (const k of contacts.filter((x) => x.project_id === pid)) {
      if (k.phone) expect(c.answer).not.toContain(k.phone);
      if (k.email) expect(c.answer).not.toContain(k.email);
    }
    expect(c.answer).not.toMatch(/@/);
    const f = await ask(USERS.client, 'What is the fee budget and TSA cost?', ctx);
    expect(f.answer).not.toMatch(/\$\d/);
  });

  it('an analyst sees masked contact phones', async () => {
    const auth = await authFor(db, USERS.analyst);
    const { visibleProjectIds } = await import('../src/services/access');
    const pid = [...(await visibleProjectIds(db, auth))][0];
    const contacts = (await db.all<Contact>('contacts')).filter((c) => c.project_id === pid);
    const r = await ask(USERS.analyst, 'phone numbers of contacts', { type: 'project', projectId: pid });
    for (const k of contacts) if (k.phone) expect(r.answer).not.toContain(k.phone);
  });

  it('a manager without finance restrictions gets project finance', async () => {
    const r = await ask(USERS.manager, 'What is the fee budget?', { type: 'project', projectId: 'PRJ-0001' });
    expect(r.answer).toMatch(/\$/);
    expect(r.mode).toBe('offline');
  });
});

describe('Piku answers', () => {
  it('answers status for a project with sources and follow-ups', async () => {
    const r = await ask(USERS.manager, 'What is the status of this project?', { type: 'project', projectId: 'PRJ-0001' });
    expect(r.answer).toContain('Project Phoenix');
    expect(r.sources.some((s) => s.href?.startsWith('/projects/PRJ-0001'))).toBe(true);
    expect(r.suggestedActions?.length).toBeGreaterThan(0);
    expect(r.language).toBe('en');
  });

  it('answers in Hindi when asked in Hindi', async () => {
    const r = await ask(USERS.manager, 'इस प्रोजेक्ट का स्टेटस बताओ', { type: 'project', projectId: 'PRJ-0001' });
    expect(r.language).toBe('hi');
    expect(r.answer).toMatch(/[ऀ-ॿ]/);
  });

  it('finds a project mentioned by name from the global bubble', async () => {
    const r = await ask(USERS.exec, 'status of Rioja');
    expect(r.answer).toContain('Rioja');
  });

  it('lists my tasks, overdue items, knowledge and help', async () => {
    expect((await ask(USERS.analyst, 'What are my tasks?')).answer).toMatch(/task/i);
    expect((await ask(USERS.manager, 'What is overdue here?', { type: 'project', projectId: 'PRJ-0001' })).answer).toMatch(/overdue|Nothing is overdue/);
    expect((await ask(USERS.manager, 'What is a TSA?')).answer).toMatch(/Transition Services Agreement/);
    expect((await ask(USERS.manager, 'help')).answer).toMatch(/I can/);
  });

  it('drafts an email in context and stores the conversation', async () => {
    const before = (await db.all('chat_messages')).length;
    const r = await ask(USERS.manager, 'Draft a status email', { type: 'project', projectId: 'PRJ-0001' });
    expect(r.answer).toMatch(/Subject/);
    const after = await db.all<any>('chat_messages');
    expect(after.length).toBe(before + 2);
    expect(after.at(-1)!.sender).toBe('piku');
    const audits = await db.all<any>('audit_log');
    expect(audits.some((a) => a.action === 'ai.piku' && a.ai_generated === 'Y')).toBe(true);
  });
});
