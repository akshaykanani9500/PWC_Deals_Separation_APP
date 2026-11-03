/**
 * v1.3: finance workspace + two-level access governance.
 * Rioja = PRJ-0002 (Partner Rajiv, Manager Daniel, Lead Rohan, Analysts Sneha & Aditya, Client Kenji). Phoenix = PRJ-0001.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, USERS } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => { t = await makeTestApp(); }, 60000);
afterAll(() => t.cleanup());

const RIOJA = 'PRJ-0002';
const PHOENIX = 'PRJ-0001';

describe('finance workspace', () => {
  it('gives the manager the full picture, read-only', async () => {
    const r = await t.as(USERS.daniel).get(`/api/projects/${RIOJA}/finance`);
    expect(r.status).toBe(200);
    const w = r.body;
    expect(w.effort.byStage.length).toBeGreaterThan(0);
    expect(w.effort.byPerson.some((p: any) => p.hours > 0 && p.value > 0)).toBe(true);
    expect(w.effort.byPerson.some((p: any) => p.billedBy > 0)).toBe(true); // who billed what
    expect(w.invoices.length).toBeGreaterThan(0);
    expect(w.costItems.length).toBeGreaterThan(0);
    expect(w.fundingSources.length).toBeGreaterThan(0);
    expect(w.sourcesUses.usesTotal).toBeGreaterThan(0);
    expect(w.sourcesUses.unfunded).toBe(Math.max(0, w.sourcesUses.usesTotal - w.sourcesUses.secured));
    expect(w.totals.fee_budget).toBeGreaterThan(0); // v1.2 keys still there
    expect(w.perms.canEdit).toBe(false);
    const add = await t.as(USERS.daniel).post(`/api/projects/${RIOJA}/finance/funding`, { source_type: 'Bridge loan', amount: 1, status: 'Identified' });
    expect(add.status).toBe(403);
  });

  it('lets the partner add, change and remove funding, costs and invoices (audited, validated)', async () => {
    const api = t.as(USERS.rajiv);
    const f = await api.post(`/api/projects/${RIOJA}/finance/funding`, { source_type: 'Term loan', provider: 'Northbridge Bank (demo)', amount: 500000, status: 'In discussion', interest_rate_pct: 10, tenor_months: 36 });
    expect(f.status).toBe(201);
    const up = await api.patch(`/api/projects/${RIOJA}/finance/funding/${f.body.funding_id}`, { status: 'Committed' });
    expect(up.status).toBe(200);
    expect(up.body.status).toBe('Committed');
    const w = (await api.get(`/api/projects/${RIOJA}/finance`)).body;
    expect(w.perms.canEdit).toBe(true);
    expect(w.fundingSources.find((x: any) => x.funding_id === f.body.funding_id)).toBeTruthy();

    const c = await api.post(`/api/projects/${RIOJA}/finance/costs`, { category: 'Data migration', amount: 120000, status: 'Planned', payer: 'Buyer' });
    expect(c.status).toBe(201);
    const inv = await api.post(`/api/projects/${RIOJA}/finance/invoices`, { invoice_no: 'RIO-TEST', amount: 9000, status: 'Draft', period_month: '2026-11' });
    expect(inv.status).toBe(201);

    // a stage from another project is refused
    const phoenixStage = t.data.stages.find((s) => s.project_id === PHOENIX)!;
    expect((await api.post(`/api/projects/${RIOJA}/finance/costs`, { category: 'Contingency', amount: 1, status: 'Planned', stage_id: phoenixStage.stage_id })).status).toBe(400);
    // bad enum
    expect((await api.post(`/api/projects/${RIOJA}/finance/funding`, { source_type: 'Crypto', amount: 1, status: 'Identified' })).status).toBe(400);
    // a row of another project cannot be patched through this project
    const other = t.data.funding_sources.find((x) => x.project_id === PHOENIX)!;
    expect((await api.patch(`/api/projects/${RIOJA}/finance/funding/${other.funding_id}`, { amount: 1 })).status).toBe(404);

    expect((await api.del(`/api/projects/${RIOJA}/finance/funding/${f.body.funding_id}`)).status).toBe(200);
    const after = (await api.get(`/api/projects/${RIOJA}/finance`)).body;
    expect(after.fundingSources.find((x: any) => x.funding_id === f.body.funding_id)).toBeUndefined();
    const auditRows = (await t.as(USERS.fatima).get(`/api/audit?projectId=${RIOJA}`)).body as any[];
    expect(auditRows.some((a) => a.action === 'finance.funding.create')).toBe(true);
    expect(auditRows.some((a) => a.action === 'finance.funding.delete')).toBe(true);
  });

  it('keeps finance away from analysts, leads without a grant and clients', async () => {
    expect((await t.as(USERS.sneha).get(`/api/projects/${RIOJA}/finance`)).status).toBe(403);
    expect((await t.as(USERS.aditya).get(`/api/projects/${RIOJA}/finance`)).status).toBe(403);
    expect((await t.as(USERS.kenji).get(`/api/projects/${RIOJA}/finance`)).status).toBe(403);
    expect((await t.as(USERS.sneha).post(`/api/projects/${RIOJA}/finance/costs`, { category: 'Contingency', amount: 1, status: 'Planned' })).status).toBe(403);
  });
});

describe('two-level access governance', () => {
  it('seeded: Rohan (Lead) has active finance.view on Rioja only, and only inside Rioja', async () => {
    const rohan = t.as(USERS.rohan);
    expect((await rohan.get(`/api/projects/${RIOJA}/finance`)).status).toBe(200);
    const detail = (await rohan.get(`/api/projects/${RIOJA}`)).body;
    expect(detail.project.fee_budget).toBeGreaterThan(0);
    expect(detail.grants.map((g: any) => g.permission_code)).toContain('finance.view');
    expect(detail.perms.canEditFinance).toBe(false);
    // another project he is on: still no finance
    const other = t.data.project_members.find((m) => m.user_id === USERS.rohan && m.project_id !== RIOJA)!;
    expect((await rohan.get(`/api/projects/${other.project_id}/finance`)).status).toBe(403);
    expect((await rohan.get(`/api/projects/${other.project_id}`)).body.project.fee_budget).toBeUndefined();
    // portfolio screens never use grants
    expect((await rohan.get('/api/dashboard')).body.kpis.feeBudget).toBeNull();
    expect((await rohan.get('/api/projects')).body.every((p: any) => p.fee_budget === undefined)).toBe(true);
  });

  it('L1 then L2 approval switches access on; revoke switches it off', async () => {
    const pending = (await t.as(USERS.fatima).get('/api/access/requests?view=inbox')).body as any[];
    const req = pending.find((g) => g.grantee_user_id === USERS.sneha && g.project_id === RIOJA);
    expect(req?.state).toBe('Pending L2');
    expect(req.can.approveL2).toBe(true);
    // the L1 manager cannot also give L2, and the analyst cannot approve her own
    expect((await t.as(USERS.daniel).post(`/api/access/requests/${req.grant_id}/decision`, { decision: 'approve' })).status).toBe(403);
    expect((await t.as(USERS.sneha).post(`/api/access/requests/${req.grant_id}/decision`, { decision: 'approve' })).status).toBe(403);

    const ok = await t.as(USERS.fatima).post(`/api/access/requests/${req.grant_id}/decision`, { decision: 'approve', note: 'Need-to-know confirmed.' });
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe('Active');
    expect(ok.body.expires_at).toBeTruthy();

    const sneha = t.as(USERS.sneha);
    expect((await sneha.get(`/api/projects/${RIOJA}/finance`)).status).toBe(200);
    expect((await sneha.get(`/api/projects/${RIOJA}`)).body.project.fee_budget).toBeGreaterThan(0);
    // view only: no edit
    expect((await sneha.post(`/api/projects/${RIOJA}/finance/costs`, { category: 'Contingency', amount: 1, status: 'Planned' })).status).toBe(403);
    // Piku sees it too, on Rioja
    const piku = await sneha.post('/api/ai/piku', { message: 'Can I see the fees?', language: 'en', context: { type: 'project', projectId: RIOJA } });
    expect(piku.status).toBe(200);
    expect(piku.body.answer.toLowerCase()).not.toMatch(/cannot see|can't see|not allowed/);

    const rev = await t.as(USERS.daniel).post(`/api/access/requests/${req.grant_id}/revoke`, { reason: 'Scenarios delivered.' });
    expect(rev.status).toBe(200);
    expect(rev.body.state).toBe('Revoked');
    expect((await sneha.get(`/api/projects/${RIOJA}/finance`)).status).toBe(403);
  });

  it('enforces who may ask and who may approve', async () => {
    // analyst asks for herself -> Pending L1
    const self = await t.as(USERS.aditya).post('/api/access/requests', { project_id: RIOJA, permission_code: 'contacts.view.full', justification: 'Need to call the seller network owners directly.', duration_days: 7 });
    expect(self.status).toBe(201);
    expect(self.body.state).toBe('Pending L1');
    // duplicate
    expect((await t.as(USERS.aditya).post('/api/access/requests', { project_id: RIOJA, permission_code: 'contacts.view.full', justification: 'Need to call the seller network owners directly.', duration_days: 7 })).status).toBe(409);
    // a manager NOT on Rioja cannot approve it (cannot even see it)
    expect([403, 404]).toContain((await t.as(USERS.kavya).post(`/api/access/requests/${self.body.grant_id}/decision`, { decision: 'approve' })).status);
    // reject needs a reason
    expect((await t.as(USERS.daniel).post(`/api/access/requests/${self.body.grant_id}/decision`, { decision: 'reject' })).status).toBe(400);
    const l1 = await t.as(USERS.daniel).post(`/api/access/requests/${self.body.grant_id}/decision`, { decision: 'approve', note: 'OK for one week.' });
    // v1.4 risk tiers: full contacts are level-1 only, so the manager's approval switches it on straight away
    expect(l1.body.state).toBe('Active');

    // manager cannot sponsor a permission he does not hold (finance.edit) ...
    expect((await t.as(USERS.daniel).post('/api/access/requests', { project_id: RIOJA, grantee_user_id: USERS.rohan, permission_code: 'finance.edit', justification: 'Rohan should maintain the cost lines.', duration_days: 30 })).status).toBe(403);
    // ... the partner can, and that counts as level 1
    const sp = await t.as(USERS.rajiv).post('/api/access/requests', { project_id: RIOJA, grantee_user_id: USERS.rohan, permission_code: 'finance.edit', justification: 'Rohan should maintain the cost lines.', duration_days: 30 });
    expect(sp.status).toBe(201);
    expect(sp.body.state).toBe('Pending L2');
    expect(sp.body.l1_approver_id).toBe(USERS.rajiv);
    await t.as(USERS.fatima).post(`/api/access/requests/${sp.body.grant_id}/decision`, { decision: 'approve' });
    const w = (await t.as(USERS.rohan).get(`/api/projects/${RIOJA}/finance`)).body;
    expect(w.perms.canEdit).toBe(true);
    expect(w.perms.viaGrant).toBe(true);
    expect((await t.as(USERS.rohan).post(`/api/projects/${RIOJA}/finance/costs`, { category: 'Contingency', amount: 5000, status: 'Planned' })).status).toBe(201);

    // analysts cannot sponsor others; clients cannot ask; role-only rights cannot be requested
    expect((await t.as(USERS.sneha).post('/api/access/requests', { project_id: RIOJA, grantee_user_id: USERS.aditya, permission_code: 'task.edit', justification: 'Please let Aditya edit the tasks.', duration_days: 7 })).status).toBe(403);
    expect((await t.as(USERS.kenji).post('/api/access/requests', { project_id: RIOJA, permission_code: 'finance.view', justification: 'I would like to see the fees please.', duration_days: 7 })).status).toBe(403);
    expect((await t.as(USERS.sneha).post('/api/access/requests', { project_id: RIOJA, permission_code: 'stage.gate.approve', justification: 'I would like to approve gates.', duration_days: 7 })).status).toBe(400);
    // too short a reason, bad duration
    expect((await t.as(USERS.sneha).post('/api/access/requests', { project_id: RIOJA, permission_code: 'task.edit', justification: 'pls', duration_days: 7 })).status).toBe(400);
    expect((await t.as(USERS.sneha).post('/api/access/requests', { project_id: RIOJA, permission_code: 'task.edit', justification: 'Need to re-plan the network tasks.', duration_days: 365 })).status).toBe(400);
    // a project you are not on
    expect([403, 404]).toContain((await t.as(USERS.sneha).post('/api/access/requests', { project_id: 'PRJ-0004', permission_code: 'finance.view', justification: 'Need to see the Borealis fees.', duration_days: 7 })).status);
  });

  it('an expired grant is not applied', async () => {
    await t.db.insert('access_grants', {
      project_id: RIOJA, grantee_user_id: USERS.aditya, permission_code: 'finance.view', justification: 'old access', duration_days: 7, status: 'Active',
      requested_by: USERS.aditya, l1_approver_id: USERS.daniel, l2_approver_id: USERS.fatima, starts_at: new Date(Date.now() - 20 * 864e5).toISOString(), expires_at: new Date(Date.now() - 864e5).toISOString(),
    });
    expect((await t.as(USERS.aditya).get(`/api/projects/${RIOJA}/finance`)).status).toBe(403);
    const mine = (await t.as(USERS.aditya).get('/api/access/requests?view=mine')).body as any[];
    expect(mine.some((g) => g.state === 'Expired')).toBe(true);
  });

  it('lists only what each person may see, and every step is audited', async () => {
    const analyst = (await t.as(USERS.karan).get('/api/access/requests')).body as any[];
    expect(analyst.every((g) => g.grantee_user_id === USERS.karan || g.requested_by === USERS.karan)).toBe(true);
    const client = await t.as(USERS.kenji).get('/api/access/requests');
    expect(client.body).toEqual([]);
    const summary = (await t.as(USERS.fatima).get('/api/access/summary')).body;
    expect(summary.inbox).toBeGreaterThan(0);
    const auditRows = (await t.as(USERS.fatima).get(`/api/audit?projectId=${RIOJA}`)).body as any[];
    for (const a of ['access.request', 'access.approve.l1', 'access.approve.l2', 'access.revoke']) expect(auditRows.some((x) => x.action === a), a).toBe(true);
  });
});
