import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeTestApp, USERS } from './helpers';
import { issueToken, verifyToken } from '../src/middleware/auth';

let t: Awaited<ReturnType<typeof makeTestApp>>;
const phoenix = 'PRJ-0001';
const rioja = 'PRJ-0002';
beforeAll(async () => { t = await makeTestApp(); });
afterAll(() => t.cleanup());

const stageOf = (projectId: string, name: string) => t.data.stages.find((s) => s.project_id === projectId && s.name === name)!;

describe('auth', () => {
  it('lists personas publicly and logs in', async () => {
    const res = await request(t.app).get('/api/auth/personas');
    expect(res.status).toBe(200);
    expect(res.body.personas).toHaveLength(9);
    expect(res.body.users.length).toBeGreaterThanOrEqual(18);
    const s = await request(t.app).post('/api/auth/login').send({ userId: USERS.ananya });
    expect(s.body.persona.code).toBe('MANAGER');
    expect(s.body.actions).toContain('task.edit');
    const me = await request(t.app).get('/api/auth/me').set('Authorization', `Bearer ${s.body.token}`);
    expect(me.body.user.user_id).toBe(USERS.ananya);
  });
  it('rejects missing or forged tokens', async () => {
    expect((await request(t.app).get('/api/projects')).status).toBe(401);
    const forged = issueToken(USERS.exec).replace(/.$/, 'x');
    expect((await request(t.app).get('/api/projects').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    expect(verifyToken(issueToken('USR-0001'))).toBe('USR-0001');
  });
});

describe('project visibility (scope)', () => {
  it('EXEC sees all active projects, analyst only staffed ones', async () => {
    const exec = await t.as(USERS.exec).get('/api/projects');
    expect(exec.body.length).toBe(8);
    const neha = await t.as(USERS.neha).get('/api/projects');
    expect(neha.body.map((p: any) => p.project_id).sort()).toEqual(['PRJ-0001', 'PRJ-0004', 'PRJ-0006']);
  });
  it('blocks a member-scope user from an unstaffed project and audits it', async () => {
    const res = await t.as(USERS.neha).get(`/api/projects/${rioja}`);
    expect(res.status).toBe(403);
    const denied = (await t.db.all('audit_log')).filter((a: any) => a.action === 'access.denied' && a.actor_user_id === USERS.neha);
    expect(denied.length).toBeGreaterThan(0);
  });
  it('CLIENT sees exactly one project, without finance, contacts or internal emails', async () => {
    const list = await t.as(USERS.lisa).get('/api/projects');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].fee_budget).toBeUndefined();
    expect(list.body[0].tsa_monthly_cost).toBeUndefined();
    expect((await t.as(USERS.lisa).get(`/api/projects/${phoenix}/finance`)).status).toBe(403);
    expect((await t.as(USERS.lisa).get(`/api/projects/${phoenix}/contacts`)).body).toEqual([]);
    const comms = await t.as(USERS.lisa).get(`/api/projects/${phoenix}/communications`);
    expect(comms.body.length).toBeGreaterThan(0);
    expect(comms.body.every((c: any) => c.channel === 'Meeting')).toBe(true);
    const dash = await t.as(USERS.lisa).get('/api/dashboard');
    expect(dash.body.kpis.feeBudget).toBeNull();
    expect(dash.body.financeTrend).toBeNull();
  });
  it('ANALYST sees masked contacts; MANAGER sees them in full', async () => {
    const a = await t.as(USERS.neha).get(`/api/projects/${phoenix}/contacts`);
    expect(a.body[0].phone).toContain('••');
    const m = await t.as(USERS.ananya).get(`/api/projects/${phoenix}/contacts`);
    expect(m.body[0].phone).not.toContain('••');
  });
});

describe('row-level edit rules', () => {
  it('EXEC cannot edit tasks', async () => {
    const task = t.data.tasks.find((x) => x.project_id === phoenix && x.status !== 'Done')!;
    expect((await t.as(USERS.exec).patch(`/api/tasks/${task.task_id}`, { status: 'Done' })).status).toBe(403);
  });
  it('ANALYST can update status of own task but not its title, and not other people tasks', async () => {
    const own = t.data.tasks.find((x) => x.project_id === phoenix && x.assignee_user_id === USERS.neha && x.status !== 'Done')!;
    const other = t.data.tasks.find((x) => x.project_id === phoenix && x.assignee_user_id !== USERS.neha)!;
    const ok = await t.as(USERS.neha).patch(`/api/tasks/${own.task_id}`, { status: 'In Progress', percent_complete: 40, done_notes: 'Half done' });
    expect(ok.status).toBe(200);
    expect(ok.body.percent_complete).toBe(40);
    expect((await t.as(USERS.neha).patch(`/api/tasks/${own.task_id}`, { title: 'Renamed' })).status).toBe(403);
    expect((await t.as(USERS.neha).patch(`/api/tasks/${other.task_id}`, { status: 'Done' })).status).toBe(403);
    const detail = await t.as(USERS.neha).get(`/api/tasks/${own.task_id}`);
    expect(detail.body.perms.editableFields).toEqual(['status', 'percent_complete', 'done_notes', 'pending_notes', 'dependency_notes']);
  });
  it('LEAD can edit activities in the stage they lead but not in others', async () => {
    const tsa = stageOf(phoenix, 'TSA Exit');
    const dil = stageOf(phoenix, 'Diligence');
    const actOwn = t.data.activities.find((a) => a.stage_id === tsa.stage_id)!;
    const actOther = t.data.activities.find((a) => a.stage_id === dil.stage_id)!;
    expect((await t.as(USERS.arjun).patch(`/api/activities/${actOwn.activity_id}`, { description: 'Lead edit' })).status).toBe(200);
    expect((await t.as(USERS.arjun).patch(`/api/activities/${actOther.activity_id}`, { description: 'Nope' })).status).toBe(403);
    const sd = await t.as(USERS.arjun).get(`/api/stages/${tsa.stage_id}`);
    expect(sd.body.perms.canEditActivities).toBe(true);
    const sd2 = await t.as(USERS.arjun).get(`/api/stages/${dil.stage_id}`);
    expect(sd2.body.perms.canEditActivities).toBe(false);
    expect((await t.as(USERS.arjun).post(`/api/projects/${phoenix}/stages`, { name: 'Lead stage' })).status).toBe(403);
  });
  it('closed projects are read-only', async () => {
    const closedTask = t.data.tasks.find((x) => x.project_id === 'PRJ-0009')!;
    expect((await t.as(USERS.ananya).patch(`/api/tasks/${closedTask.task_id}`, { status: 'In Progress' })).status).toBe(403);
  });
});

describe('roll-up', () => {
  it('completing every task of an activity rolls up to activity, stage and project', async () => {
    const stage = stageOf(phoenix, 'TSA Exit');
    const act = t.data.activities.find((a) => a.stage_id === stage.stage_id)!;
    const before = (await t.as(USERS.ananya).get(`/api/projects/${phoenix}`)).body.project.percent_complete;
    const tasks = t.data.tasks.filter((x) => x.activity_id === act.activity_id);
    for (const task of tasks) expect((await t.as(USERS.ananya).patch(`/api/tasks/${task.task_id}`, { status: 'Done' })).status).toBe(200);
    const ad = await t.as(USERS.ananya).get(`/api/activities/${act.activity_id}`);
    expect(ad.body.activity.percent_complete).toBe(100);
    expect(ad.body.activity.status).toBe('Done');
    const after = (await t.as(USERS.ananya).get(`/api/projects/${phoenix}`)).body.project.percent_complete;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe('create and edit flows', () => {
  it('MANAGER creates a project with default stages; EXEC creates with a nested template', async () => {
    const res = await t.as(USERS.ananya).post('/api/projects', { code_name: 'Project Test', deal_type: 'Spin-off', industry: 'Telecom & Media' });
    expect(res.status).toBe(201);
    expect(res.body.stages.map((s: any) => s.name)).toEqual(['Diligence', 'Signing', 'Day-1 Readiness', 'TSA Exit', 'Close-out']);
    expect(res.body.project.current_stage_id).toBe(res.body.stages[0].stage_id);
    const res2 = await t.as(USERS.exec).post('/api/projects', {
      code_name: 'Project Tree', stages: [{ name: 'Plan', activities: [{ name: 'Kick-off', tasks: [{ title: 'Agenda' }, { title: 'Invite', day1_critical: 'Y' }] }] }],
    });
    expect(res2.status).toBe(201);
    const st = await t.as(USERS.exec).get(`/api/stages/${res2.body.stages[0].stage_id}`);
    expect(st.body.activities[0].task_count).toBe(2);
    expect((await t.as(USERS.neha).post('/api/projects', { code_name: 'Nope' })).status).toBe(403);
  });
  it('stage add, reorder, gate approve moves current stage; bulk activities + tasks', async () => {
    const p = (await t.as(USERS.ananya).post('/api/projects', { code_name: 'Project Gate' })).body;
    const pid = p.project.project_id;
    const ids = p.stages.map((s: any) => s.stage_id);
    const re = await t.as(USERS.ananya).post(`/api/projects/${pid}/stages/reorder`, { stageIds: [ids[1], ids[0], ...ids.slice(2)] });
    expect(re.body[0].stage_id).toBe(ids[1]);
    const bulk = await t.as(USERS.ananya).post(`/api/stages/${ids[1]}/activities/bulk`, { activities: [{ name: 'A1', tasks: [{ title: 'T1' }] }, { name: 'A2' }] });
    expect(bulk.status).toBe(201);
    const tb = await t.as(USERS.ananya).post(`/api/activities/${bulk.body[0].activity_id}/tasks/bulk`, { tasks: [{ title: 'T2' }, { title: 'T3', status: 'Done' }] });
    expect(tb.body[1].percent_complete).toBe(100);
    expect((await t.as(USERS.ananya).post(`/api/stages/${ids[1]}/gate`, { action: 'approve' })).status).toBe(403); // manager cannot approve
    expect((await t.as(USERS.ananya).post(`/api/stages/${ids[1]}/gate`, { action: 'request' })).body.gate_status).toBe('Pending Approval');
    const sarahAdd = await t.as(USERS.ananya).post(`/api/projects/${pid}/members`, { user_id: USERS.sarah, member_role: 'Partner' });
    expect(sarahAdd.status).toBe(201);
    expect((await t.as(USERS.sarah).post(`/api/stages/${ids[1]}/gate`, { action: 'approve' })).body.gate_status).toBe('Approved');
    const proj = await t.as(USERS.sarah).get(`/api/projects/${pid}`);
    expect(proj.body.project.current_stage_id).toBe(ids[0]);
    expect((await t.as(USERS.ananya).del(`/api/stages/${ids[4]}`)).status).toBe(200);
    expect((await t.as(USERS.ananya).get(`/api/projects/${pid}`)).body.stages).toHaveLength(4);
  });
  it('notes, communications, finance, dashboard, users, meta', async () => {
    const n = await t.as(USERS.neha).post('/api/notes', { project_id: phoenix, body: 'Analyst note' });
    expect(n.status).toBe(201);
    expect((await t.as(USERS.ananya).del(`/api/notes/${n.body.note_id}`)).status).toBe(403);
    expect((await t.as(USERS.neha).del(`/api/notes/${n.body.note_id}`)).status).toBe(200);
    const c = await t.as(USERS.ananya).post(`/api/projects/${phoenix}/communications`, { channel: 'Call', subject: 'Call with seller', body: 'Discussed exits' });
    expect(c.status).toBe(201);
    const fin = await t.as(USERS.sarah).get(`/api/projects/${phoenix}/finance`);
    expect(fin.body.entries.length).toBeGreaterThan(0);
    expect(fin.body.tsaServices.length).toBe(10);
    expect((await t.as(USERS.neha).get(`/api/projects/${phoenix}/finance`)).status).toBe(403);
    const dash = await t.as(USERS.exec).get('/api/dashboard');
    expect(dash.body.kpis.activeProjects).toBeGreaterThanOrEqual(8);
    expect(dash.body.financeTrend.length).toBeGreaterThan(0);
    expect((await t.as(USERS.exec).get('/api/users')).body.length).toBe(18);
    expect((await request(t.app).get('/api/meta')).body.enums.workStatus).toContain('Blocked');
    const pref = await request(t.app).put('/api/users/me/preferences').set('Authorization', `Bearer ${issueToken(USERS.exec)}`).send({ dashboard_layout: [{ i: 'kpis' }] });
    expect(pref.body.dashboard_layout).toBe('[{"i":"kpis"}]');
  });
});

describe('close-out and knowledge hub', () => {
  it('preview, submit with consent -> Pending Review items; KM approves', async () => {
    const everest = 'PRJ-0007';
    expect((await t.as(USERS.karan).get(`/api/projects/${everest}/closeout/preview`)).status).toBe(403);
    const prev = await t.as(USERS.ananya).get(`/api/projects/${everest}/closeout/preview`);
    expect(prev.status).toBe(200);
    expect(prev.body.proposedItems.length).toBeGreaterThan(0);
    expect(typeof prev.body.lessonsDraft).toBe('string');
    const sub = await t.as(USERS.ananya).post(`/api/projects/${everest}/closeout`, { consent: 'Granted', lessons: 'Plan freeze windows early.', items: prev.body.proposedItems });
    expect(sub.status).toBe(200);
    expect(sub.body.project.status).toBe('Closed');
    expect(sub.body.knowledgeItems.length).toBeGreaterThan(0);
    expect(sub.body.knowledgeItems.every((k: any) => k.review_status === 'Pending Review' && k.source_project_id === undefined)).toBe(true);
    // analysts only see approved items
    const neha = await t.as(USERS.neha).get('/api/knowledge');
    expect(neha.body.every((k: any) => k.review_status === 'Approved')).toBe(true);
    const pending = (await t.as(USERS.meera).get('/api/knowledge?status=Pending%20Review')).body;
    expect(pending.length).toBeGreaterThanOrEqual(sub.body.knowledgeItems.length);
    const ap = await t.as(USERS.meera).patch(`/api/knowledge/${pending[0].knowledge_id}`, { review_status: 'Approved' });
    expect(ap.body.review_status).toBe('Approved');
    expect(ap.body.reviewed_by).toBe(USERS.meera);
    expect((await t.as(USERS.neha).patch(`/api/knowledge/${pending[1].knowledge_id}`, { review_status: 'Approved' })).status).toBe(403);
  });
  it('archive-only when consent is not granted', async () => {
    const res = await t.as(USERS.daniel).post('/api/projects/PRJ-0006/closeout', { consent: 'Not Granted', lessons: '', items: [] });
    expect(res.status).toBe(200);
    expect(res.body.knowledgeItems).toHaveLength(0);
  });
});

describe('audit and admin', () => {
  it('RISK sees the audit log; ANALYST does not; ADMIN exports', async () => {
    expect((await t.as(USERS.fatima).get('/api/audit')).body.length).toBeGreaterThan(0);
    expect((await t.as(USERS.neha).get('/api/audit')).status).toBe(403);
    const dbInfo = await t.as(USERS.rahul).get('/api/admin/db');
    expect(dbInfo.body.driver).toBe('local');
    const sql = await t.as(USERS.rahul).get('/api/admin/export/oracle');
    expect(sql.text).toContain('CREATE TABLE projects');
    expect(sql.text).toContain('INSERT INTO tasks');
    const xlsx = await t.as(USERS.rahul).get('/api/admin/export/xlsx');
    expect(xlsx.status).toBe(200);
    expect((await t.as(USERS.ananya).get('/api/admin/db')).status).toBe(403);
  });
});
