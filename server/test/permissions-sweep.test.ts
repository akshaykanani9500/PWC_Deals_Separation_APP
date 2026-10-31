/**
 * Leak sweep: every user x every project x every read endpoint.
 * Asserts scope, finance stripping, contact masking and CLIENT communication limits hold everywhere.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers';
import { PERMISSIONS, FINANCE_FIELDS } from '../../shared/permissions';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => { t = await makeTestApp(); }, 60000);
afterAll(() => t.cleanup());

const FIN = FINANCE_FIELDS as readonly string[];
const RAW_PHONE = /\+?\d[\d\s-]{8,}\d/; // an unmasked phone number

function personaOf(userId: string) {
  const u = t.data.users.find((x) => x.user_id === userId)!;
  return t.data.personas.find((p) => p.persona_id === u.persona_id)!.code as keyof typeof PERMISSIONS;
}

function expectedVisible(userId: string): Set<string> {
  const code = personaOf(userId);
  const live = t.data.projects.filter((p) => p.is_deleted !== 'Y');
  if (PERMISSIONS[code].scope === 'all') return new Set(live.map((p) => p.project_id));
  const ids = new Set<string>();
  for (const m of t.data.project_members) if (m.user_id === userId && m.is_deleted !== 'Y') ids.add(m.project_id);
  for (const p of live) if (p.partner_user_id === userId || p.manager_user_id === userId) ids.add(p.project_id);
  return ids;
}

function noFinance(obj: Record<string, unknown>) {
  for (const f of FIN) expect(obj[f], `finance field ${f} leaked`).toBeUndefined();
}

describe('permission leak sweep', () => {
  it('holds for every persona, project and read endpoint', async () => {
    const projects = t.data.projects.filter((p) => p.is_deleted !== 'Y');
    for (const user of t.data.users) {
      const code = personaOf(user.user_id);
      const acts = PERMISSIONS[code].actions as string[];
      const finance = acts.includes('finance.view');
      const fullContacts = acts.includes('contacts.view.full');
      const api = t.as(user.user_id);
      const expected = expectedVisible(user.user_id);
      const label = `${user.user_id} (${code})`;

      // list
      const list = await api.get('/api/projects?includeClosed=1');
      expect(list.status, label).toBe(200);
      expect(new Set(list.body.map((p: any) => p.project_id)), `${label} project list`).toEqual(expected);
      if (!finance) list.body.forEach(noFinance);

      // dashboard
      const dash = await api.get('/api/dashboard');
      if (acts.includes('portfolio.view') || dash.status === 200) {
        expect(dash.status, label).toBe(200);
        if (!finance) {
          expect(dash.body.kpis.feeBudget, label).toBeNull();
          expect(dash.body.financeTrend, label).toBeNull();
        }
        for (const u of dash.body.upcoming ?? []) expect(expected.has(u.project_id), `${label} upcoming leak ${u.project_id}`).toBe(true);
        for (const a of dash.body.recentActivity ?? []) if (a.project_id) expect(expected.has(a.project_id), `${label} activity feed leak`).toBe(true);
      }

      for (const p of projects) {
        const pid = p.project_id;
        const stage = t.data.stages.find((s) => s.project_id === pid && s.is_deleted !== 'Y');
        const act = t.data.activities.find((a) => a.project_id === pid && a.is_deleted !== 'Y');
        const task = t.data.tasks.find((x) => x.project_id === pid && x.is_deleted !== 'Y');
        const urls = [`/api/projects/${pid}`, `/api/projects/${pid}/members`, `/api/projects/${pid}/contacts`,
          `/api/projects/${pid}/communications`, `/api/stages/${stage!.stage_id}`, `/api/activities/${act!.activity_id}`, `/api/tasks/${task!.task_id}`];
        if (!expected.has(pid)) {
          for (const u of urls) {
            const r = await api.get(u);
            expect([403, 404], `${label} should NOT read ${u} (got ${r.status})`).toContain(r.status);
          }
          const fin = await api.get(`/api/projects/${pid}/finance`);
          expect([403, 404]).toContain(fin.status);
          const sum = await api.post('/api/ai/summary', { scope: 'project', id: pid });
          expect([403, 404], `${label} AI summary of invisible ${pid}`).toContain(sum.status);
          continue;
        }
        const detail = await api.get(`/api/projects/${pid}`);
        expect(detail.status, `${label} ${pid}`).toBe(200);
        if (!finance) noFinance(detail.body.project);
        const fin = await api.get(`/api/projects/${pid}/finance`);
        expect(fin.status, `${label} finance ${pid}`).toBe(finance ? 200 : 403);

        const contacts = await api.get(`/api/projects/${pid}/contacts`);
        expect(contacts.status).toBe(200);
        if (code === 'CLIENT') expect(contacts.body).toEqual([]);
        else if (!fullContacts) for (const c of contacts.body) {
          if (c.email) expect(c.email, `${label} email not masked`).toContain('•');
          if (c.phone) expect(c.phone, `${label} phone not masked`).toContain('•');
        }

        const comms = await api.get(`/api/projects/${pid}/communications`);
        expect(comms.status).toBe(200);
        if (code === 'CLIENT') {
          for (const c of comms.body) {
            expect(c.channel).toBe('Meeting');
            expect(RAW_PHONE.test(`${c.subject ?? ''} ${c.body ?? ''}`), `${label} phone in client meeting`).toBe(false);
          }
        } else if (!fullContacts) {
          for (const c of comms.body) expect(RAW_PHONE.test(`${c.subject ?? ''} ${c.body ?? ''}`), `${label} raw phone in comms`).toBe(false);
        }

        const ad = await api.get(`/api/activities/${act!.activity_id}`);
        expect(ad.status).toBe(200);
        if (code === 'CLIENT') {
          expect(ad.body.contacts).toEqual([]);
          expect(ad.body.notes).toEqual([]);
          for (const c of ad.body.communications) expect(c.channel).toBe('Meeting');
        } else if (!fullContacts) {
          for (const c of ad.body.contacts) if (c.phone) expect(c.phone).toContain('•');
        }
        const td = await api.get(`/api/tasks/${task!.task_id}`);
        expect(td.status).toBe(200);
        if (code === 'CLIENT') {
          for (const c of td.body.communications) expect(c.channel).toBe('Meeting');
          expect(td.body.notes).toEqual([]);
        }
      }
    }
  }, 120000);

  it("other people's AI use never shows up in a client's or teammate's history and feed", async () => {
    const task = t.data.tasks.find((x) => x.project_id === 'PRJ-0001' && x.is_deleted !== 'Y')!;
    await t.as('USR-0004').post('/api/ai/summary', { scope: 'task', id: task.task_id });
    await t.as('USR-0004').post('/api/ai/piku', { message: 'secret question about fees', language: 'en',
      context: { type: 'task', projectId: 'PRJ-0001', stageId: task.stage_id, activityId: task.activity_id, taskId: task.task_id } });
    for (const uid of ['USR-0016', 'USR-0010']) { // client, analyst
      const td = await t.as(uid).get(`/api/tasks/${task.task_id}`);
      expect(td.status).toBe(200);
      for (const h of td.body.history) expect(h.action.startsWith('ai.'), `${uid} sees ${h.action}`).toBe(false);
      expect(JSON.stringify(td.body.history)).not.toContain('secret question');
    }
    const dash = await t.as('USR-0016').get('/api/dashboard');
    for (const a of dash.body.recentActivity) expect(a.action).toMatch(/^(task|stage|activity)\./);
    const own = await t.as('USR-0004').get(`/api/tasks/${task.task_id}`);
    expect(own.body.history.some((h: any) => h.action.startsWith('ai.'))).toBe(true); // the asker still sees their own
  });

  it('knowledge items never expose source_project_id', async () => {
    for (const user of t.data.users) {
      const r = await t.as(user.user_id).get('/api/knowledge');
      if (r.status !== 200) continue;
      for (const k of r.body) expect(k.source_project_id, `${user.user_id} knowledge leak`).toBeUndefined();
    }
  });

  it('Piku never answers with another project when asked by name', async () => {
    const invisibleFor = (uid: string) => t.data.projects.filter((p) => !expectedVisible(uid).has(p.project_id));
    for (const uid of ['USR-0010', 'USR-0016']) { // analyst, client
      const others = invisibleFor(uid);
      for (const p of others.slice(0, 4)) {
        const name = String(p.code_name).replace(/^Project\s+/i, '');
        for (const q of [`What is the status of ${p.code_name}?`, `${name} ka status batao`]) {
          const r = await t.as(uid).post('/api/ai/piku', { message: q, language: 'auto', context: { type: 'global' } });
          expect(r.status).toBe(200);
          for (const s of r.body.sources) expect(s.href ?? '', `${uid} source leak`).not.toContain(p.project_id);
          const facts = [p.client_alias, String(p.fee_budget ?? 'zzz-none'), String(p.percent_complete ?? 'zzz')].filter((x) => x && x.length > 3);
          expect(r.body.answer, `${uid} leaked client alias of ${p.project_id}`).not.toContain(p.client_alias);
          void facts;
        }
      }
    }
  });
});
