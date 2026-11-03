/**
 * v1.4 (C): AI suggestions use the typed form values and return options; custom widget specs and data;
 * meeting / email / call saving with permission checks.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { suggest } from '../src/ai/suggest';
import { parseWidgetRequest } from '../src/ai/widgetSuggest';
import { resetGeminiState } from '../src/ai/gemini';
import { makeDb, authFor, USERS } from './aiFixtures';
import { makeTestApp, USERS as APP } from './helpers';
import type { LocalJsonAdapter } from '../src/db/adapters/LocalJsonAdapter';
import type { Activity, Communication, Stage, SuggestResponse } from '../../shared/types';

let db: LocalJsonAdapter;
beforeAll(async () => { delete process.env.GEMINI_API_KEY; db = await makeDb(); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.GEMINI_API_KEY; resetGeminiState(); });

const run = async (req: any, user = USERS.manager) => suggest(db, await authFor(db, user), req);
const allActivityNames = (r: SuggestResponse) => ((r.draft as any).stages as any[]).flatMap((s) => s.activities.map((a: any) => a.name as string));

describe('AI suggest uses the typed form values', () => {
  it('project: SAP S/4 + plants in Germany -> ERP, OT and GDPR / works council activities, 2-3 options, draft = recommended', async () => {
    const r = await run({
      kind: 'project',
      hints: { deal_type: 'Sell-side carve-out', industry: 'Industrial Manufacturing', name: 'Project Kestrel' },
      current: { code_name: 'Project Kestrel', description: 'SAP S/4 carve-out, 3 plants in Germany', deal_type: 'Sell-side carve-out', industry: 'Industrial Manufacturing' },
    });
    const names = allActivityNames(r).join(' | ');
    expect(names).toMatch(/ERP clone & data carve-out/);
    expect(names).toMatch(/Plant \/ OT cut-over/);
    expect(names).toMatch(/works council/i);
    expect(r.options!.length).toBeGreaterThanOrEqual(2);
    expect(r.options!.length).toBeLessThanOrEqual(3);
    const rec = r.options!.find((o) => o.id === r.recommendedId)!;
    expect(rec.recommended).toBe(true);
    expect(r.draft).toEqual(rec.draft);
    expect(rec.fromInputs.join(' ')).toMatch(/SAP/);
    expect(r.inputSignals!.map((s) => s.id)).toEqual(expect.arrayContaining(['erp', 'ot', 'eu_privacy']));
    expect((r.draft as any).name).toBe('Project Kestrel'); // the name field the panel reads
    // every task carries effort so new projects are not created with 0 h
    const hours = ((r.draft as any).stages as any[]).flatMap((s) => s.activities.flatMap((a: any) => a.tasks)).reduce((n: number, t: any) => n + (t.effort_hours ?? 0), 0);
    expect(hours).toBeGreaterThan(0);
    // labels differ and the lean option is smaller
    const lean = r.options!.find((o) => o.id === 'lean')!;
    expect(lean.stats!.tasks!).toBeLessThan(rec.stats!.tasks!);
  });

  it('project: healthcare inputs get the Healthcare overlay and GxP activities (overlays are not cut by the limit)', async () => {
    const r = await run({ kind: 'project', hints: { deal_type: 'Spin-off', industry: 'Healthcare & Life Sciences' }, current: { description: 'Pharma spin-off with FDA validated systems' } });
    const names = allActivityNames(r).join(' | ');
    expect(names).toMatch(/GxP validated systems & CSV plan/);
    expect(names).toMatch(/Validated systems re-qualification/);
    expect(r.sources.map((s) => s.label)).toContain('Healthcare & Life Sciences overlay');
  });

  it('sources are deduplicated and only list knowledge actually used', async () => {
    const r = await run({ kind: 'project', hints: { deal_type: 'TSA exit', industry: 'Financial Services & Payments' } });
    for (const o of r.options!) {
      const ids = o.sources.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(o.sources.map((s) => s.label)).size).toBe(o.sources.length);
    }
    const std = r.options!.find((o) => o.id === 'standard');
    if (std) expect(std.sources.some((s) => s.id.startsWith('KNW'))).toBe(false); // the standard option uses no past deals
  });

  it('stages: diffs against the unsaved rows in the panel (current), not only the DB', async () => {
    // the panel removed "TSA Exit" locally (not saved yet) -> it is suggested again
    const saved = (await db.find<Stage>('stages', (s) => s.project_id === 'PRJ-0001')).map((s) => s.name);
    const r = await run({ kind: 'stages', projectId: 'PRJ-0001', current: { stages: saved.filter((n) => n !== 'TSA Exit') } });
    expect((r.draft as any[]).map((s) => s.name)).toContain('TSA Exit');
    const r2 = await run({ kind: 'stages', projectId: 'PRJ-0001', current: { stages: saved } });
    expect((r2.draft as any[]).map((s) => s.name)).not.toContain('TSA Exit');
    expect(r.options!.length).toBeGreaterThanOrEqual(2);
  });

  it('activities: diffs against current rows and uses keywords typed in the project', async () => {
    const stage = (await db.find<Stage>('stages', (s) => s.project_id === 'PRJ-0001' && s.name === 'Day-1 Readiness'))[0];
    const saved = (await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id)).map((a) => a.name);
    const r = await run({ kind: 'activities', projectId: 'PRJ-0001', stageId: stage.stage_id, current: { activities: [...saved, 'Microsoft 365 tenant split & mailbox migration'] } });
    const names = (r.draft as any[]).map((a) => a.name);
    expect(names).not.toContain('Microsoft 365 tenant split & mailbox migration');
    for (const n of saved) expect(names).not.toContain(n);
    expect(r.options!.map((o) => o.id)).toEqual(['tailored', 'standard', 'lean']);
  });

  it('task: reads the typed form, not only the saved task', async () => {
    const t = (await db.find<any>('tasks', (x) => x.project_id === 'PRJ-0001' && x.status !== 'Done' && !!x.due_date))[0];
    const r = await run({ kind: 'task', taskId: t.task_id, current: { dependency_notes: 'Waiting on vendor consent from the seller', status: 'In Progress' } });
    expect((r.draft as any).status).toBe('Blocked');
  });

  it('project_fields: field suggestions for the edit panel (description, tags, sensitivity, residency, clean team, risks)', async () => {
    const r = await run({ kind: 'project_fields', projectId: 'PRJ-0001', current: { description: 'Card unit carve-out with 40 applications in India; competitor buyer', tags: '', sensitivity: 'Confidential', clean_team_required: 'N' } });
    const d = r.draft as any;
    expect(d.sensitivity).toBe('Restricted');
    expect(d.clean_team_required).toBe('Y');
    expect(String(d.tags)).toMatch(/PCI/);
    expect(Array.isArray(d.risks)).toBe(true);
    expect(r.options![0].fieldReasons?.sensitivity).toBeTruthy();
    expect(Array.isArray(r.draft)).toBe(false);
    expect(d.stages).toBeUndefined(); // not a 5-stage plan any more
  });

  it('project_fields needs project.edit', async () => {
    await expect(run({ kind: 'project_fields', projectId: 'PRJ-0001' }, USERS.analyst)).rejects.toMatchObject({ status: 403 });
  });

  it('Gemini prompt carries the typed values; bad Gemini output falls back to the offline options', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"options": [{"id": "tailored", "draft": {"bad": 1}}]}' }] }, finishReason: 'STOP' }] }) });
    vi.stubGlobal('fetch', f);
    const r = await run({ kind: 'project', hints: { deal_type: 'Spin-off', industry: 'Consumer & Retail' }, current: { description: 'Move 2,000 mailboxes to a new M365 tenant' } });
    expect(r.mode).toBe('offline');
    expect(r.options!.length).toBeGreaterThanOrEqual(2);
    const gen = f.mock.calls.find((c) => String(c[0]).includes(':generateContent'));
    if (gen) expect(JSON.parse(gen[1].body).contents[0].parts[0].text).toContain('2,000 mailboxes');
  });
});

describe('custom widget specs', () => {
  it('parses a sensible request into a valid spec', () => {
    const { spec } = parseWidgetRequest('overdue tasks by workstream lead for my at-risk deals', true);
    expect(spec).toMatchObject({ metric: 'overdue_tasks', groupBy: 'stage_owner', filter: { atRisk: true } });
  });
  it('finance requests without finance.view are not possible', () => {
    expect(parseWidgetRequest('fee budget by project', false).spec).toBeNull();
    expect(parseWidgetRequest('fee budget by project', true).spec).toMatchObject({ metric: 'fee_budget', groupBy: 'project' });
  });
});

describe('widget API and comms log (HTTP)', () => {
  let t: Awaited<ReturnType<typeof makeTestApp>>;
  beforeAll(async () => { t = await makeTestApp(); });

  it('suggest: valid spec, and possible:false with alternatives for nonsense', async () => {
    const ok = await (await t.as(APP.ananya)).post('/api/dashboard/widgets/suggest', { text: 'blocked tasks by project as a table' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ possible: true, spec: { metric: 'blocked_tasks', groupBy: 'project', chart: 'table' } });
    const no = await (await t.as(APP.ananya)).post('/api/dashboard/widgets/suggest', { text: 'stock price of PwC' });
    expect(no.body.possible).toBe(false);
    expect(no.body.suggestion).toBe('Ask the analytics team');
    expect(no.body.closestAlternatives.length).toBeGreaterThan(0);
  });

  it('widget request is recorded in the audit log', async () => {
    const r = await (await t.as(APP.ananya)).post('/api/dashboard/widgets/request', { text: 'stock price of PwC' });
    expect(r.status).toBe(201);
    const audit = await t.db.find<any>('audit_log', (a) => a.action === 'dashboard.widget_request');
    expect(audit.some((a) => String(a.details).includes('stock price'))).toBe(true);
  });

  it('widget-data: analyst cannot get finance metrics; manager can', async () => {
    const spec = { title: 'Fees', metric: 'fee_budget', groupBy: 'project', chart: 'bar' };
    expect((await (await t.as(APP.neha)).post('/api/dashboard/widget-data', { spec })).status).toBe(403);
    const m = await (await t.as(APP.ananya)).post('/api/dashboard/widget-data', { spec });
    expect(m.status).toBe(200);
    expect(m.body.unit).toBe('money');
    expect(m.body.rows.length).toBeGreaterThan(0);
  });

  it('widget-data: the client sees only their own project and no people groupings', async () => {
    const c = await (await t.as(APP.lisa)).post('/api/dashboard/widget-data', { spec: { title: 'Tasks by project', metric: 'task_count', groupBy: 'project', chart: 'bar' } });
    expect(c.status).toBe(200);
    const visible = (await (await t.as(APP.lisa)).get('/api/projects')).body.map((p: any) => p.project_id);
    expect(c.body.rows.map((r: any) => r.key).every((k: string) => visible.includes(k))).toBe(true);
    expect(c.body.rows.length).toBeLessThanOrEqual(visible.length);
    expect((await (await t.as(APP.lisa)).post('/api/dashboard/widget-data', { spec: { title: 'x', metric: 'task_count', groupBy: 'assignee', chart: 'bar' } })).status).toBe(403);
    expect((await (await t.as(APP.lisa)).post('/api/dashboard/widget-data', { spec: { title: 'x', metric: 'fee_billed', groupBy: 'none', chart: 'kpi' } })).status).toBe(403);
  });

  it('widget-data rejects specs outside the catalogue', async () => {
    const r = await (await t.as(APP.ananya)).post('/api/dashboard/widget-data', { spec: { title: 'x', metric: 'DROP TABLE', groupBy: 'none', chart: 'kpi' } });
    expect(r.status).toBe(400);
  });

  it('meeting / email / call save to communications, linked to the activity; permissions enforced', async () => {
    const act = (await t.db.find<Activity>('activities', (a) => a.project_id === 'PRJ-0001'))[0];
    const mgr = await t.as(APP.ananya);
    const ctx = await mgr.post('/api/ai/comms/context', { scope: 'activity', id: act.activity_id });
    expect(ctx.status).toBe(200);
    expect(ctx.body.canSave).toBe(true);
    expect(ctx.body.people.some((p: any) => p.kind === 'team')).toBe(true);
    for (const channel of ['Meeting', 'Email', 'Call']) {
      const r = await mgr.post('/api/ai/comms/log', { scope: 'activity', id: act.activity_id, channel, subject: `${channel} v14 test`, body: 'Agenda / body', duration_min: 30, aiDrafted: true });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ channel, activity_id: act.activity_id, stage_id: act.stage_id, project_id: 'PRJ-0001' });
    }
    const detail = await mgr.get(`/api/activities/${act.activity_id}`);
    expect(detail.body.communications.map((c: Communication) => c.subject)).toEqual(expect.arrayContaining(['Meeting v14 test', 'Email v14 test', 'Call v14 test']));
    // the client viewer: read-only (no meetings saved, no emails)
    const client = await t.as(APP.lisa);
    const cctx = await client.post('/api/ai/comms/context', { scope: 'activity', id: act.activity_id });
    expect(cctx.body.canSave).toBe(false);
    expect(cctx.body.people.filter((p: any) => p.kind === 'contact')).toHaveLength(0);
    expect((await client.post('/api/ai/comms/log', { scope: 'activity', id: act.activity_id, channel: 'Meeting', subject: 'x' })).status).toBe(403);
    expect((await client.post('/api/ai/draft-email', { scope: 'activity', id: act.activity_id })).status).toBe(403);
    // the analyst sees masked contacts
    const actx = await (await t.as(APP.neha)).post('/api/ai/comms/context', { scope: 'activity', id: act.activity_id });
    expect(actx.status).toBe(200);
    for (const p of actx.body.people) if (p.email) expect(p.email).toContain('•');
    // KM has no notes.add and does not see the project log
    const km = await t.as(APP.meera);
    expect((await km.post('/api/ai/comms/log', { scope: 'activity', id: act.activity_id, channel: 'Call', subject: 'x' })).status).toBe(403);
    // a project the user cannot see -> 404
    expect((await (await t.as(APP.neha)).post('/api/ai/comms/log', { scope: 'project', id: 'PRJ-0002', channel: 'Call', subject: 'x' })).status).toBe(404);
  });

  it('meeting suggestion has slots with ISO starts and invites next-step owners', async () => {
    const r = await (await t.as(APP.ananya)).post('/api/ai/meeting', { scope: 'project', id: 'PRJ-0001' });
    expect(r.status).toBe(200);
    expect(r.body.slots).toHaveLength(3);
    expect(Date.parse(r.body.slots[0].start)).toBeGreaterThan(Date.now());
    expect(r.body.mode).toBe('offline');
    expect(r.body.attendeeIds.length).toBe(r.body.attendees.length);
  });
});
