/**
 * v1.4 access governance: risk tiers, sponsor shortcut, ageing (escalation / expiry), no-approver guard, member removal,
 * acting roles (role elevation per project), next-approver names, admin reset.
 * Rioja PRJ-0002 (clean team; Partner Rajiv, Manager Daniel, Lead Rohan, Analysts Sneha & Aditya[Day-1 Readiness]).
 * Falcon PRJ-0008 (not clean team; Rajiv, Daniel, Rohan, Sneha). Phoenix PRJ-0001 (not clean; Sarah, Ananya, Karan, Neha).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, USERS } from './helpers';
import { GRANTABLE, NEVER_GRANT, durationsFor, grantActions, grantState, isEscalated, needsLevel2, roleBundle } from '../../shared/access';
import { PERMISSIONS } from '../../shared/permissions';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => { t = await makeTestApp(); }, 60000);
afterAll(() => t.cleanup());

const RIOJA = 'PRJ-0002';
const FALCON = 'PRJ-0008';
const PHOENIX = 'PRJ-0001';
const COBALT = 'PRJ-0005';
const DAY = 864e5;
const ask = (who: string, body: Record<string, unknown>) => t.as(who).post('/api/access/requests', { justification: 'Needed for the separation work this week.', duration_days: 7, ...body });
const decide = (who: string, id: string, decision: 'approve' | 'reject', note?: string) => t.as(who).post(`/api/access/requests/${id}/decision`, { decision, note });
const names = (row: any) => (row.next_approvers ?? []).map((a: any) => a.name);

describe('policy table (shared/access.ts)', () => {
  it('has the agreed tiers and limits', () => {
    const by = Object.fromEntries(GRANTABLE.map((g) => [g.code, g]));
    expect(by['task.edit'].approvals).toBe('L1');
    expect(by['activity.edit'].approvals).toBe('L1');
    expect(by['contacts.view.full'].approvals).toBe('L1');
    expect(durationsFor('contacts.view.full')).toEqual([7, 30]);
    expect(needsLevel2('finance.view', { clean_team_required: 'Y' })).toBe(true);
    expect(needsLevel2('finance.view', { clean_team_required: 'N' })).toBe(false);
    expect(needsLevel2('finance.edit', { clean_team_required: 'N' })).toBe(true);
    expect(by['finance.edit'].l1Personas).toEqual(['PARTNER']);
    for (const r of ['role.LEAD', 'role.MANAGER', 'role.PARTNER']) {
      expect(by[r].approvals).toBe('L1+L2');
      expect(by[r].maxDays).toBe(30);
      expect(by[r].l1Personas).toEqual(['PARTNER']);
    }
    expect(by['role.LEAD'].eligible).toEqual(['ANALYST']);
    expect(by['role.MANAGER'].eligible).toEqual(['ANALYST', 'LEAD']);
    expect(by['role.PARTNER'].eligible).toEqual(['ANALYST', 'LEAD', 'MANAGER']);
  });

  it('acting-role bundles never carry role-only rights', () => {
    for (const role of ['LEAD', 'MANAGER', 'PARTNER'] as const) {
      const b = grantActions(`role.${role}`);
      expect(b).toEqual(roleBundle(role));
      for (const a of NEVER_GRANT) expect(b, `${role} bundle has ${a}`).not.toContain(a);
      for (const a of PERMISSIONS[role].actions) if (!NEVER_GRANT.includes(a)) expect(b).toContain(a);
    }
    expect(grantActions('role.PARTNER')).toContain('finance.edit');
  });

  it('computes escalation and pending expiry on read', () => {
    const now = Date.now();
    const at = (d: number) => new Date(now - d * DAY).toISOString();
    expect(isEscalated({ status: 'Pending L1', created_at: at(2) }, now)).toBe(false);
    expect(isEscalated({ status: 'Pending L1', created_at: at(4) }, now)).toBe(true);
    expect(grantState({ status: 'Pending L2', created_at: at(8) }, now)).toBe('Expired');
    expect(isEscalated({ status: 'Pending L2', created_at: at(8) }, now)).toBe(false);
    expect(grantState({ status: 'Active', created_at: at(40), expires_at: new Date(now + DAY).toISOString() }, now)).toBe('Active');
  });
});

describe('risk-tiered approvals through the API', () => {
  it('L1-only goes live on level 1, with approver names in the row and the notice', async () => {
    const r = await ask(USERS.sneha, { project_id: FALCON, permission_code: 'task.edit' });
    expect(r.status).toBe(201);
    expect(r.body.state).toBe('Pending L1');
    expect(r.body.policy).toBe('Level 1 only');
    expect(names(r.body)).toEqual(['Daniel Brooks', 'Rajiv Khanna']);
    expect(r.body.notice).toContain('Daniel Brooks (Manager) or Rajiv Khanna (Partner)');
    // the inbox of Daniel shows the same names
    const inbox = (await t.as(USERS.daniel).get('/api/access/requests?view=inbox')).body as any[];
    const row = inbox.find((g) => g.grant_id === r.body.grant_id);
    expect(row.can.approveL1).toBe(true);
    expect(row.next_level).toBe(1);
    const ok = await decide(USERS.daniel, r.body.grant_id, 'approve');
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe('Active');
    expect(ok.body.notice).toMatch(/live until/);
    const task = t.data.tasks.find((x) => x.project_id === FALCON && x.assignee_user_id !== USERS.sneha && x.is_deleted !== 'Y')!;
    expect((await t.as(USERS.sneha).get(`/api/tasks/${task.task_id}`)).body.perms.canEdit).toBe(true);
    // v1.4.1: a single task.edit grant edits but never deletes
    expect((await t.as(USERS.sneha).get(`/api/tasks/${task.task_id}`)).body.perms.canDelete).toBe(false);
    expect((await t.as(USERS.sneha).del(`/api/tasks/${task.task_id}`)).status).toBe(403);
    expect((await t.as(USERS.sneha).patch(`/api/tasks/${task.task_id}`, { priority: 'High' })).status).toBe(200);
  });

  it('finance.view needs Risk & Quality only on a clean-team project', async () => {
    const plain = await ask(USERS.sneha, { project_id: FALCON, permission_code: 'finance.view' });
    expect(plain.body.policy).toBe('Level 1 only');
    expect((await decide(USERS.daniel, plain.body.grant_id, 'approve')).body.state).toBe('Active');
    expect((await t.as(USERS.sneha).get(`/api/projects/${FALCON}/finance`)).status).toBe(200);

    const clean = await ask(USERS.aditya, { project_id: RIOJA, permission_code: 'finance.view' });
    expect(clean.body.policy).toMatch(/Risk & Quality/);
    expect(clean.body.notice).toContain('Then Risk & Quality (Fatima Sheikh)');
    const l1 = await decide(USERS.daniel, clean.body.grant_id, 'approve');
    expect(l1.body.state).toBe('Pending L2');
    expect(l1.body.notice).toBe('Approved. Now with Risk & Quality: Fatima Sheikh.');
    expect(names(l1.body)).toEqual(['Fatima Sheikh']);
    expect((await t.as(USERS.aditya).get(`/api/projects/${RIOJA}/finance`)).status).toBe(403);
    await decide(USERS.fatima, clean.body.grant_id, 'reject', 'Not on the clean team.');
  });

  it('finance.edit needs the Partner at level 1, then Risk & Quality', async () => {
    const r = await ask(USERS.rohan, { project_id: FALCON, permission_code: 'finance.edit' });
    expect(r.status).toBe(201);
    expect(names(r.body)).toEqual(['Rajiv Khanna']);
    expect((await decide(USERS.daniel, r.body.grant_id, 'approve')).status).toBe(403);
    expect((await decide(USERS.rajiv, r.body.grant_id, 'approve')).body.state).toBe('Pending L2');
    const live = await decide(USERS.fatima, r.body.grant_id, 'approve');
    expect(live.body.state).toBe('Active');
    expect((await t.as(USERS.rohan).get(`/api/projects/${FALCON}/finance`)).body.perms.canEdit).toBe(true);
  });

  it('caps full contacts at 30 days', async () => {
    const r90 = await ask(USERS.karan, { project_id: PHOENIX, permission_code: 'contacts.view.full', duration_days: 90 });
    expect(r90.status).toBe(400);
    expect(r90.body.error).toMatch(/30 days at most/);
    const r30 = await ask(USERS.karan, { project_id: PHOENIX, permission_code: 'contacts.view.full', duration_days: 30 });
    expect(r30.status).toBe(201);
    expect(names(r30.body)).toEqual(['Ananya Rao', 'Sarah Whitfield']);
  });

  it('a sponsor who qualifies as level 1 makes an L1-only item live immediately', async () => {
    const r = await ask(USERS.rajiv, { project_id: FALCON, permission_code: 'activity.edit', grantee_user_id: USERS.sneha });
    expect(r.status).toBe(201);
    expect(r.body.state).toBe('Active');
    expect(r.body.l1_approver_id).toBe(USERS.rajiv);
    expect(r.body.notice).toMatch(/^Live now — sponsored by you \(level 1 only\)/);
    // v1.4.1: the activity.edit grant adds and edits activities but cannot delete them
    const act = t.data.activities.find((x) => x.project_id === FALCON && x.is_deleted !== 'Y')!;
    const stage = (await t.as(USERS.sneha).get(`/api/stages/${act.stage_id}`)).body;
    const row = stage.activities.find((x: any) => x.activity_id === act.activity_id);
    expect(row.perms).toEqual({ canEdit: true, canDelete: false });
    expect((await t.as(USERS.sneha).del(`/api/activities/${act.activity_id}`)).status).toBe(403);
    expect((await t.as(USERS.sneha).patch(`/api/activities/${act.activity_id}`, { name: `${act.name} (re-planned)` })).status).toBe(200);
  });
});

describe('ageing, no-approver guard', () => {
  it('escalates after 3 days (Deals Leader may then approve) and expires after 7', async () => {
    const fresh = await t.db.insert<any>('access_grants', {
      project_id: PHOENIX, grantee_user_id: USERS.neha, permission_code: 'contacts.view.full', justification: 'Fresh request for the vendor calls.', duration_days: 7,
      status: 'Pending L1', requested_by: USERS.neha, created_at: new Date(Date.now() - DAY).toISOString(),
    });
    const freshRow = (await t.as(USERS.exec).get('/api/access/requests')).body.find((g: any) => g.grant_id === fresh.grant_id);
    expect(freshRow.escalated).toBe(false);
    expect(freshRow.age_days).toBe(1);
    expect(names(freshRow)).not.toContain('Vikram Mehta');
    expect((await decide(USERS.exec, fresh.grant_id, 'approve')).status).toBe(403);
    await t.db.update('access_grants', fresh.grant_id, { status: 'Cancelled' });

    const old = await t.db.insert<any>('access_grants', {
      project_id: PHOENIX, grantee_user_id: USERS.neha, permission_code: 'contacts.view.full', justification: 'Old request for the vendor calls.', duration_days: 7,
      status: 'Pending L1', requested_by: USERS.neha, created_at: new Date(Date.now() - 4 * DAY).toISOString(),
    });
    const row = (await t.as(USERS.exec).get('/api/access/requests')).body.find((g: any) => g.grant_id === old.grant_id);
    expect(row.escalated).toBe(true);
    expect(row.state).toBe('Pending L1');
    const exec = t.data.users.find((u) => u.user_id === USERS.exec)!.full_name;
    expect(names(row)).toContain(exec);
    expect(row.status_line).toMatch(/escalated/);
    expect((await decide(USERS.exec, old.grant_id, 'approve')).body.state).toBe('Active');

    const stale = await t.db.insert<any>('access_grants', {
      project_id: PHOENIX, grantee_user_id: USERS.karan, permission_code: 'task.edit', justification: 'Very old request for task edits.', duration_days: 7,
      status: 'Pending L1', requested_by: USERS.karan, created_at: new Date(Date.now() - 8 * DAY).toISOString(),
    });
    const mine = (await t.as(USERS.karan).get('/api/access/requests?view=mine')).body.find((g: any) => g.grant_id === stale.grant_id);
    expect(mine.state).toBe('Expired');
    expect(mine.expired_pending).toBe(true);
    const late = await decide(USERS.ananya, stale.grant_id, 'approve');
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/expired/);
    // an expired request no longer blocks a new one
    expect((await ask(USERS.karan, { project_id: PHOENIX, permission_code: 'task.edit' })).status).toBe(201);
  });

  it('refuses with 409 when nobody could approve, naming who must be added', async () => {
    const p = await t.db.insert<any>('projects', { code_name: 'Project Quartz', status: 'Active', manager_user_id: USERS.daniel, partner_user_id: null, clean_team_required: 'N' });
    await t.db.insert('project_members', { project_id: p.project_id, user_id: USERS.daniel, member_role: 'Manager' });
    await t.db.insert('project_members', { project_id: p.project_id, user_id: USERS.rohan, member_role: 'Workstream Lead' });
    const r = await ask(USERS.rohan, { project_id: p.project_id, permission_code: 'finance.edit' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('No Partner on Project Quartz can approve "Edit project finance" for Rohan Desai. Ask the Deals Leader to add a Partner to the team.');
    const prev = await t.as(USERS.rohan).get(`/api/access/preview?projectId=${p.project_id}&permission=finance.edit`);
    expect(prev.body.blocked).toMatch(/No Partner on Project Quartz/);

    // no active Risk & Quality user -> L2 items are refused up front
    await t.db.update('users', USERS.fatima, { is_active: 'N' });
    try {
      const r2 = await ask(USERS.sneha, { project_id: RIOJA, permission_code: 'role.LEAD' });
      expect(r2.status).toBe(409);
      expect(r2.body.error).toMatch(/No active Risk & Quality reviewer/);
    } finally { await t.db.update('users', USERS.fatima, { is_active: 'Y' }); }
  });
});

describe('acting roles', () => {
  it('the Deals Leader cannot sponsor (not staffed); only escalated requests let them in', async () => {
    const r = await ask(USERS.exec, { project_id: FALCON, permission_code: 'contacts.view.full', grantee_user_id: USERS.sneha });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/not staffed on Project Falcon/);
    expect((await t.as(USERS.exec).get(`/api/projects/${FALCON}`)).body.perms.canSponsorAccess).toBe(false);
    expect((await t.as(USERS.rajiv).get(`/api/projects/${FALCON}`)).body.perms.canSponsorAccess).toBe(true);
  });

  it('only a Partner may give level 1 for an acting role', async () => {
    expect((await ask(USERS.daniel, { project_id: RIOJA, permission_code: 'role.LEAD', grantee_user_id: USERS.sneha })).status).toBe(403);
    expect((await ask(USERS.sneha, { project_id: RIOJA, permission_code: 'role.LEAD', duration_days: 90 })).status).toBe(400);
    expect((await ask(USERS.rohan, { project_id: RIOJA, permission_code: 'role.LEAD' })).status).toBe(400); // already a Lead
  });

  it('acting Engagement Manager: project-wide edit on that project only, never role-only rights', async () => {
    const sp = await ask(USERS.rajiv, { project_id: RIOJA, permission_code: 'role.MANAGER', grantee_user_id: USERS.sneha, duration_days: 30 });
    expect(sp.status).toBe(201);
    expect(sp.body.state).toBe('Pending L2');
    expect(sp.body.notice).toBe('Sponsored — level 1 is done. Now with Risk & Quality: Fatima Sheikh.');
    expect((await decide(USERS.fatima, sp.body.grant_id, 'approve')).body.state).toBe('Active');

    const sneha = t.as(USERS.sneha);
    const d = (await sneha.get(`/api/projects/${RIOJA}`)).body;
    expect(d.perms.canEditProject).toBe(true);
    expect(d.perms.canEditStages).toBe(true);
    expect(d.perms.canClose).toBe(false);
    expect(d.perms.canApproveGate).toBe(false);
    expect(d.perms.canViewFinance).toBe(true);
    expect(d.perms.canEditFinance).toBe(false);
    expect(d.perms.canSponsorAccess).toBe(false);
    expect(d.grants.some((g: any) => g.acting_role === 'MANAGER')).toBe(true);
    // edits any task, in any stage
    const task = t.data.tasks.find((x) => x.project_id === RIOJA && x.stage_id === 'STG-0006' && x.is_deleted !== 'Y')!;
    const up = await sneha.patch(`/api/tasks/${task.task_id}`, { title: `${task.title} (re-planned)` });
    expect(up.status).toBe(200);
    expect((await sneha.get(`/api/tasks/${task.task_id}`)).body.perms.canDelete).toBe(true); // acting role: like the role itself
    // staffing and governance fields stay with the real Partner / Manager (and stay put after the grant ends)
    expect(d.perms.canChangeStaffing).toBe(false);
    const before = t.data.projects.find((p) => p.project_id === RIOJA)!;
    for (const body of [{ manager_user_id: USERS.sneha }, { partner_user_id: USERS.sarah }, { clean_team_required: 'N' }]) {
      const r = await sneha.patch(`/api/projects/${RIOJA}`, body);
      expect(r.status, JSON.stringify(body)).toBe(403);
      expect(r.body.error).toMatch(/acting role cannot change/);
    }
    const desc = await sneha.patch(`/api/projects/${RIOJA}`, { description: 'Updated by the acting manager.', manager_user_id: before.manager_user_id });
    expect(desc.status).toBe(200);
    const after = await t.db.get<any>('projects', RIOJA);
    expect([after.manager_user_id, after.partner_user_id, after.clean_team_required]).toEqual([before.manager_user_id, before.partner_user_id, 'Y']);
    expect((await sneha.post(`/api/projects/${RIOJA}/members`, { user_id: USERS.karan })).status).toBe(403);
    const someone = (await t.db.find<any>('project_members', (m) => m.project_id === RIOJA && m.user_id === USERS.aditya))[0];
    expect((await sneha.del(`/api/projects/${RIOJA}/members/${someone.member_id}`)).status).toBe(403);
    expect((await sneha.del(`/api/projects/${RIOJA}`)).status).toBe(403);
    const denied = (await t.as(USERS.fatima).get(`/api/audit?projectId=${RIOJA}`)).body as any[];
    expect(denied.filter((a) => a.action === 'access.denied' && /acting role/.test(a.details ?? '')).length).toBeGreaterThanOrEqual(5);
    // the real manager still can
    expect((await t.as(USERS.daniel).get(`/api/projects/${RIOJA}`)).body.perms.canChangeStaffing).toBe(true);
    // gate approval stays with the Partner
    expect((await sneha.post('/api/stages/STG-0006/gate', { action: 'approve' })).status).toBe(403);
    // another project: still an analyst
    expect((await sneha.get(`/api/projects/${COBALT}`)).body.perms.canEditProject).toBe(false);
    const other = t.data.tasks.find((x) => x.project_id === COBALT && x.assignee_user_id !== USERS.sneha && x.is_deleted !== 'Y')!;
    expect((await sneha.get(`/api/tasks/${other.task_id}`)).body.perms.canEdit).toBe(false);
    // portfolio screens never use grants
    expect((await sneha.get('/api/dashboard')).body.kpis?.feeBudget ?? null).toBeNull();
    expect((await sneha.get('/api/projects')).body.every((p: any) => p.fee_budget === undefined)).toBe(true);
    // Piku knows
    const piku = await sneha.post('/api/ai/piku', { message: 'What can I do here?', language: 'en', context: { type: 'project', projectId: RIOJA } });
    expect(piku.status).toBe(200);
    expect(piku.body.answer).toMatch(/acting as Engagement Manager on this project/);
  });

  it('acting Workstream Lead follows the Lead row rule (only stages of their workstream)', async () => {
    // seeded: Rajiv sponsored Aditya as acting Workstream Lead on Rioja, waiting for Risk & Quality
    const inbox = (await t.as(USERS.fatima).get('/api/access/requests?view=inbox')).body as any[];
    const req = inbox.find((g) => g.grantee_user_id === USERS.aditya && g.permission_code === 'role.LEAD')!;
    expect(req.state).toBe('Pending L2');
    expect(req.acting_role).toBe('LEAD');
    expect((await decide(USERS.fatima, req.grant_id, 'approve')).body.state).toBe('Active');
    const aditya = t.as(USERS.aditya);
    const own = t.data.tasks.find((x) => x.project_id === RIOJA && x.stage_id === 'STG-0008' && x.assignee_user_id !== USERS.aditya && x.is_deleted !== 'Y')!; // Day-1 Readiness
    const notOwn = t.data.tasks.find((x) => x.project_id === RIOJA && x.stage_id === 'STG-0006' && x.assignee_user_id !== USERS.aditya && x.is_deleted !== 'Y')!; // Diligence
    expect((await aditya.get(`/api/tasks/${own.task_id}`)).body.perms.editableFields).toContain('title');
    expect((await aditya.get(`/api/tasks/${notOwn.task_id}`)).body.perms.canEdit).toBe(false);
    expect((await aditya.patch(`/api/tasks/${notOwn.task_id}`, { title: 'x' })).status).toBe(403);
    expect((await aditya.patch(`/api/tasks/${own.task_id}`, { title: `${own.title} (cover)` })).status).toBe(200);
    // not on Atlas, where he is an analyst too
    const atlasTask = t.data.tasks.find((x) => x.project_id === 'PRJ-0003' && x.assignee_user_id !== USERS.aditya && x.is_deleted !== 'Y')!;
    expect((await aditya.get(`/api/tasks/${atlasTask.task_id}`)).body.perms.canEdit).toBe(false);
  });
});

describe('member removal and the bell feed', () => {
  it('feed lists what waits for me and my latest changes', async () => {
    const r = await ask(USERS.neha, { project_id: PHOENIX, permission_code: 'activity.edit' });
    expect(r.status).toBe(201);
    const feed = (await t.as(USERS.ananya).get('/api/access/feed')).body;
    expect(feed.waiting.some((g: any) => g.grant_id === r.body.grant_id)).toBe(true);
    await decide(USERS.ananya, r.body.grant_id, 'reject', 'Not needed this phase.');
    const mine = (await t.as(USERS.neha).get('/api/access/feed')).body;
    const u = mine.updates.find((g: any) => g.grant_id === r.body.grant_id);
    expect(u.last_event_kind).toBe('rejected');
    expect(u.last_event_by).toBe(USERS.ananya);
    expect(u.status_line).toMatch(/^Rejected by Ananya Rao: Not needed this phase\./);
  });

  it('removing someone cancels their pending requests and revokes their live access on that project', async () => {
    // Sneha on Falcon: task.edit + finance.view + activity.edit live; add a pending one
    const pend = await ask(USERS.sneha, { project_id: FALCON, permission_code: 'contacts.view.full' });
    expect(pend.status).toBe(201);
    const member = (await t.db.find<any>('project_members', (m) => m.project_id === FALCON && m.user_id === USERS.sneha))[0];
    const del = await t.as(USERS.daniel).del(`/api/projects/${FALCON}/members/${member.member_id}`);
    expect(del.status).toBe(200);
    expect(del.body.withdrawn).toBe(4);
    const rows = await t.db.find<any>('access_grants', (g) => g.project_id === FALCON && g.grantee_user_id === USERS.sneha);
    expect(rows.find((g) => g.grant_id === pend.body.grant_id).status).toBe('Cancelled');
    expect(rows.filter((g) => g.status === 'Revoked')).toHaveLength(3);
    expect(rows.some((g) => g.status === 'Active' || g.status.startsWith('Pending'))).toBe(false);
    expect((await t.as(USERS.sneha).get(`/api/projects/${FALCON}`)).status).toBe(403);
    const auditRows = (await t.as(USERS.fatima).get(`/api/audit?projectId=${FALCON}`)).body as any[];
    expect(auditRows.some((a) => a.action === 'member.remove' && JSON.parse(a.details).accessWithdrawn === 4)).toBe(true);
    expect(auditRows.filter((a) => a.action === 'access.revoke' && JSON.parse(a.details).auto).length).toBe(3);
  });
});

describe('admin reset demo data', () => {
  it('is admin-only, needs the confirm word and restores the demo exactly', async () => {
    expect((await t.as(USERS.rajiv).post('/api/admin/db/reset', { confirm: 'RESET' })).status).toBe(403);
    expect((await t.as(USERS.fatima).post('/api/admin/db/reset', { confirm: 'RESET' })).status).toBe(403);
    expect((await t.as(USERS.rahul).post('/api/admin/db/reset', {})).status).toBe(400);
    const auditBefore = await t.db.all<any>('audit_log');
    const ok = await t.as(USERS.rahul).post('/api/admin/db/reset', { confirm: 'RESET' });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    // Sneha is back on Falcon, the quartz test project is gone, the 5 demo requests are back
    expect((await t.as(USERS.sneha).get(`/api/projects/${FALCON}`)).status).toBe(200);
    expect((await t.db.all<any>('projects')).some((p) => p.code_name === 'Project Quartz')).toBe(false);
    const grants = await t.db.all<any>('access_grants');
    expect(grants.map((g) => `${g.permission_code}:${g.status}`).sort()).toEqual(
      ['contacts.view.full:Pending L1', 'finance.view:Active', 'finance.view:Pending L2', 'role.LEAD:Pending L2', 'task.edit:Rejected']);
    // the reset itself is audited (after the reseed)
    const auditRows = (await t.as(USERS.fatima).get('/api/audit')).body as any[];
    expect(auditRows.some((a) => a.action === 'admin.db.reset')).toBe(true);
    // the audit trail survives a reset: every earlier entry is still there, ids stay unique
    const auditAfter = await t.db.all<any>('audit_log');
    const ids = new Set(auditAfter.map((a) => a.audit_id));
    expect(ids.size).toBe(auditAfter.length);
    for (const a of auditBefore) expect(ids.has(a.audit_id), a.audit_id).toBe(true);
    expect(auditAfter.some((a) => a.action === 'member.remove' && a.project_id === FALCON)).toBe(true);
    expect(auditAfter.length).toBeGreaterThan(auditBefore.length);
    // existing tokens keep working
    expect((await t.as(USERS.rahul).get('/api/admin/db')).status).toBe(200);
  });
});
