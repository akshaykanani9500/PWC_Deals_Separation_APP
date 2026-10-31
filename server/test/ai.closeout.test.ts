import { beforeAll, describe, expect, it } from 'vitest';
import { redactText, buildCloseoutPreview } from '../src/ai/contract';
import { summarize, draftEmail, suggestMeeting, nextSlots } from '../src/ai/summary';
import { makeDb, authFor, USERS } from './aiFixtures';
import type { LocalJsonAdapter } from '../src/db/adapters/LocalJsonAdapter';
import type { Contact, Project } from '../../shared/types';

let db: LocalJsonAdapter;
beforeAll(async () => { delete process.env.GEMINI_API_KEY; db = await makeDb(); });

describe('redaction', () => {
  it('removes names, emails, phones and orgs but keeps dates and amounts', () => {
    const r = redactText('On 2026-10-31 Ananya Rao (ananya@buyer.com, +91 98765 43210) told Acme Bank about US$1,740,000. Ananya agreed.',
      ['PERSON:Ananya Rao', 'ORG:Acme Bank', 'CLIENT:Project Phoenix']);
    expect(r.text).toBe('On 2026-10-31 [PERSON] ([EMAIL], [PHONE]) told [ORG] about US$1,740,000. [PERSON] agreed.');
    expect(r.redactions.length).toBe(5);
  });
});

describe('close-out preview', () => {
  it('builds metrics and redacted knowledge items', async () => {
    const auth = await authFor(db, USERS.manager);
    const project = (await db.get<Project>('projects', 'PRJ-0001'))!;
    const preview = await buildCloseoutPreview(db, auth, project);
    expect(Number(preview.metrics.tasks_total)).toBeGreaterThan(0);
    const types = new Set(preview.proposedItems.map((i) => i.item_type));
    expect(types.has('Stage Template')).toBe(true);
    expect(types.has('Lesson')).toBe(true);
    expect(types.has('Metric')).toBe(true);
    const contacts = (await db.all<Contact>('contacts')).filter((c) => c.project_id === 'PRJ-0001');
    const text = JSON.stringify(preview.proposedItems.map(({ source_project_id, ...rest }) => rest)) + preview.lessonsDraft;
    for (const c of contacts) {
      expect(text).not.toContain(c.full_name);
      if (c.email) expect(text).not.toContain(c.email);
    }
    expect(text).not.toContain('Project Phoenix');
    for (const i of preview.proposedItems) {
      expect(i.review_status).toBe('Pending Review');
      expect(i.source_label).not.toContain('Phoenix');
      if (i.payload) expect(() => JSON.parse(i.payload!)).not.toThrow();
    }
    expect(preview.mode).toBe('offline');
  });
});

describe('summary, email and meeting', () => {
  it('summarises a project deterministically', async () => {
    const s = await summarize(db, await authFor(db, USERS.manager), 'project', 'PRJ-0001');
    expect(s.summary).toMatch(/complete/);
    expect(Array.isArray(s.risks)).toBe(true);
    expect(s.mode).toBe('offline');
  });
  it('summary in Hindi', async () => {
    const s = await summarize(db, await authFor(db, USERS.manager), 'project', 'PRJ-0001', 'hi');
    expect(s.summary).toMatch(/[ऀ-ॿ]/);
  });
  it('drafts an email with subject and body', async () => {
    const e = await draftEmail(db, await authFor(db, USERS.manager), 'project', 'PRJ-0001', 'chase overdue items');
    expect(e.subject).toContain('Project Phoenix');
    expect(e.body).toMatch(/Ananya Rao/);
  });
  it('suggests a meeting on working days', async () => {
    const m = await suggestMeeting(db, await authFor(db, USERS.manager), 'project', 'PRJ-0001');
    expect(m.suggestedSlots).toHaveLength(3);
    expect(m.attendees.length).toBeGreaterThan(0);
    const slots = nextSlots(3, new Date('2026-10-30T06:00:00Z')); // a Friday
    expect(slots[0]).toMatch(/^Mon/);
  });
  it('hides scopes outside the user visibility', async () => {
    await expect(summarize(db, await authFor(db, USERS.analyst), 'project', 'PRJ-0002')).rejects.toMatchObject({ status: 404 });
  });
});
