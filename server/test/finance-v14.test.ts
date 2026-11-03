/**
 * v1.4 finance: funding need analysis (analyseGap), finance set-up, seed consistency and bank outreach.
 * Rioja = PRJ-0002 (Partner Rajiv, Manager Daniel, Analyst Sneha, Client Kenji).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, USERS } from './helpers';
import { analyseGap, similarLessons, usesOnlyFigures } from '../src/services/financeGap';
import { bankPerms, contactDetailIn } from '../src/services/financeBank';
import { SECURED_STATUSES } from '../../shared/finance';
import type { CostItem, FundingSource, Project } from '../../shared/types';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => { t = await makeTestApp(); }, 60000);
afterAll(() => t.cleanup());
const RIOJA = 'PRJ-0002';

const proj = (x: Partial<Project> = {}): Project => ({ project_id: 'PRJ-T', code_name: 'Project Test', status: 'Active', currency: 'USD', created_at: '', is_deleted: 'N', ...x } as Project);
const cost = (id: string, amount: number, payer: CostItem['payer'] | null, usage: number | null = null): CostItem =>
  ({ cost_id: id, project_id: 'PRJ-T', category: 'IT infrastructure', amount, payer: payer ?? undefined, buyer_usage_pct: usage, status: 'Planned', created_at: '', is_deleted: 'N' } as CostItem);
const fund = (type: string, amount: number, status = 'Committed'): FundingSource =>
  ({ funding_id: `F-${type}-${amount}`, project_id: 'PRJ-T', source_type: type, amount, status, created_at: '', is_deleted: 'N' } as FundingSource);

describe('analyseGap', () => {
  // uses 1,000 = seller 300 + buyer 200 + shared 500 (buyer use 80%). Seller committed 200, buyer cash 300 -> secured 500, gap 500.
  const costs = [cost('C1', 300, 'Seller'), cost('C2', 200, 'Buyer'), cost('C3', 500, 'Shared', 80)];
  const funding = [fund('Seller contribution (SPA)', 200), fund('Buyer balance-sheet cash', 300), fund('Bridge loan', 100, 'Term sheet')];
  const a = analyseGap({ project: proj(), costItems: costs, funding, tsaRunRate: 100 });
  const by = (k: string) => a.scenarios.find((s) => s.key === k)!;

  it('computes uses, secured (by side), pipeline and the gap', () => {
    expect(a.state).toBe('gap');
    expect(a.uses).toBe(1000);
    expect(a.securedSeller).toBe(200);
    expect(a.securedBuyer).toBe(300);
    expect(a.pipeline).toBe(100);
    expect(a.gap).toBe(500);
    expect(a.gapAfterPipeline).toBe(400);
  });

  it('gets the four scenario splits right', () => {
    expect(by('beneficiary').sellerShare).toBe(300);            // shared line goes to the buyer (80% use)
    expect(by('even').sellerShare).toBe(300 + 250);
    expect(by('usage').sellerShare).toBe(300 + 100);             // seller 20% of 500
    expect(by('avoided').sellerShare).toBe(400 - 150);           // credit = 100/mo x 3 months x 50%
    for (const s of a.scenarios) {
      expect(s.sellerShare + s.buyerShare).toBe(a.uses);
      expect(s.sellerGap + s.buyerGap).toBe(a.gap);
      expect(s.sellerGap).toBe(Math.max(0, Math.min(a.gap, s.sellerShare - a.securedSeller)));
    }
    expect(by('usage').sellerGap).toBe(200);
    expect(by('usage').buyerGap).toBe(300);
  });

  it('applies the SPA seller cap and records it as evidence', () => {
    const c = analyseGap({ project: proj({ spa_seller_cap: 350, spa_clause_ref: 'SPA cl. 7.4' }), costItems: costs, funding, tsaRunRate: 100 });
    const even = c.scenarios.find((s) => s.key === 'even')!;
    expect(even.sellerBeforeCap).toBe(550);
    expect(even.sellerShare).toBe(350);
    expect(even.capExcess).toBe(200);
    expect(even.buyerShare).toBe(650);
    expect(even.evidence.some((e) => e.label.includes('SPA seller cap') && e.label.includes('7.4'))).toBe(true);
    expect(c.scenarios.find((s) => s.key === 'beneficiary')!.capExcess).toBe(0);
  });

  it('evidence rows reference the real cost lines and add up', () => {
    for (const s of a.scenarios) {
      const lines = s.evidence.filter((e) => e.cost_id);
      expect(lines.map((e) => e.cost_id).sort()).toEqual(['C1', 'C2', 'C3']);
      expect(s.evidence.reduce((x, e) => x + e.seller, 0)).toBe(s.sellerShare);
      expect(s.evidence.reduce((x, e) => x + e.buyer, 0)).toBe(s.buyerShare);
    }
  });

  it('recommends by rule: usage-based for many shared lines, beneficiary when tagged, avoided credit when usage is unknown', () => {
    expect(a.recommendation?.key).toBe('usage');
    const tagged = analyseGap({ project: proj(), costItems: [cost('A', 800, 'Seller'), cost('B', 200, 'Shared')], funding: [], tsaRunRate: 0 });
    expect(tagged.recommendation?.key).toBe('beneficiary');
    const unknown = analyseGap({ project: proj(), costItems: [cost('A', 400, 'Buyer'), cost('B', 600, 'Shared')], funding: [], tsaRunRate: 50 });
    expect(unknown.recommendation?.key).toBe('avoided');
    const even = analyseGap({ project: proj(), costItems: [cost('A', 400, 'Buyer'), cost('B', 600, null)], funding: [], tsaRunRate: 0 });
    expect(even.recommendation?.key).toBe('even');
    expect(a.recommendation!.reasons.length).toBeGreaterThan(1);
    expect(a.nextSteps.length).toBeGreaterThanOrEqual(3);
    expect(a.nextSteps.every((s) => ['Partner', 'Manager'].includes(s.role))).toBe(true);
    expect(a.routes.length).toBeGreaterThan(0);
  });

  it('handles fully funded and no-data projects', () => {
    const funded = analyseGap({ project: proj(), costItems: costs, funding: [fund('Buyer balance-sheet cash', 1000)], tsaRunRate: 0 });
    expect(funded.state).toBe('funded');
    expect(funded.gap).toBe(0);
    expect(funded.recommendation).toBeNull();
    expect(funded.watch.length).toBeGreaterThan(0);
    const none = analyseGap({ project: proj(), costItems: [], funding: [], tsaRunRate: 0 });
    expect(none.state).toBe('no-data');
    expect(none.scenarios).toEqual([]);
    expect(none.headline).toMatch(/Not enough finance data/);
    const est = analyseGap({ project: proj({ one_time_cost: 2000000, funding_gap: 500000 }), costItems: [], funding: [], tsaRunRate: 0 });
    expect(est.state).toBe('estimate-only');
    expect(est.gap).toBe(500000);
    expect(est.secured).toBe(1500000);
  });

  it('only accepts AI text that quotes computed figures', () => {
    expect(usesOnlyFigures('The gap is USD 500 and USD 1,000 is the cost.', [500, 1000])).toBe(true);
    expect(usesOnlyFigures('The gap is USD 2.5M.', [500, 1000])).toBe(false);
  });

  it('pulls Approved, anonymised funding lessons only', () => {
    const lessons = similarLessons(t.data.knowledge_items as any);
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.some((l) => /fund|split|cap|bridge/i.test(l.title + l.body))).toBe(true);
    expect(JSON.stringify(lessons)).not.toContain('source_project_id');
    expect(JSON.stringify(lessons)).not.toMatch(/Project (Granite|Horizon|Indigo)/);
  });
});

describe('seed consistency', () => {
  it('holds for every project', () => {
    const d = t.data;
    let gaps = 0;
    for (const p of d.projects) {
      const pid = p.project_id;
      const costs = d.cost_items.filter((c) => c.project_id === pid);
      if (p.one_time_cost) expect(costs.reduce((s, c) => s + c.amount, 0), `${p.code_name} cost lines`).toBe(p.one_time_cost);
      const inv = d.invoices.filter((i) => i.project_id === pid && i.status !== 'Draft').reduce((s, i) => s + i.amount, 0);
      expect(inv, `${p.code_name} invoiced`).toBe(p.fee_billed || 0);
      const secured = d.funding_sources.filter((f) => f.project_id === pid && SECURED_STATUSES.includes(f.status)).reduce((s, f) => s + f.amount, 0);
      expect(secured, `${p.code_name} secured`).toBeLessThanOrEqual(p.one_time_cost || 0);
      expect(Math.max(0, (p.one_time_cost || 0) - secured), `${p.code_name} gap`).toBe(p.funding_gap || 0);
      if (p.funding_gap) gaps++;
      const tsa = d.tsa_services.filter((s) => s.project_id === pid);
      const active = tsa.filter((s) => ['Active', 'Exiting', 'Extended'].includes(s.status));
      if (p.status === 'Closed') expect(active.length, `${p.code_name} closed TSA`).toBe(0);
      else if (p.tsa_monthly_cost) expect(active.reduce((s, x) => s + x.monthly_fee, 0), `${p.code_name} TSA`).toBe(p.tsa_monthly_cost);
    }
    expect(gaps).toBeGreaterThanOrEqual(4);
    expect(d.projects.find((p) => p.project_id === RIOJA)!.funding_gap).toBe(1740000);
  });

  it('closed projects have no work in progress; Rioja has cost on its Funding Gap Resolution stage', async () => {
    const closed = t.data.projects.filter((p) => p.status === 'Closed');
    for (const p of closed) {
      const w = (await t.as(USERS.exec).get(`/api/projects/${p.project_id}/finance`)).body;
      expect(w.billing.wip).toBe(0);
      expect(w.totals.tsa_services_active).toBe(0);
    }
    const w = (await t.as(USERS.daniel).get(`/api/projects/${RIOJA}/finance`)).body;
    const stage = w.effort.byStage.find((s: any) => /Funding Gap/.test(s.label));
    expect(w.costItems.some((c: any) => c.stage_id === stage.key && c.amount > 0)).toBe(true);
    expect(w.totals.tsa_run_rate).toBe(w.totals.tsa_monthly_active);
    expect(w.gap.state).toBe('gap');
    expect(w.gap.gap).toBe(1740000);
    expect(w.gap.scenarios).toHaveLength(4);
    expect(w.gap.recommendation).toBeTruthy();
  });
});

describe('new projects and finance set-up', () => {
  it('creates a project with finance fields and shows the estimate', async () => {
    const res = await t.as(USERS.rajiv).post('/api/projects', { code_name: 'Project Quartz', fee_budget: 500000, one_time_cost: 2000000, tsa_monthly_cost: 40000, funding_gap: 300000, spa_seller_cap: 900000, spa_clause_ref: 'SPA cl. 4.1' });
    expect(res.status).toBe(201);
    const pid = res.body.project.project_id;
    expect(res.body.project.spa_seller_cap).toBe(900000);
    const w = (await t.as(USERS.rajiv).get(`/api/projects/${pid}/finance`)).body;
    expect(w.setup.isEmpty).toBe(true);
    expect(w.gap.state).toBe('estimate-only');
    expect(w.gap.gap).toBe(300000);
    expect(w.totals.tsa_run_rate).toBe(40000);
    // a project created without finance figures has nothing to analyse
    const lead = await t.as(USERS.rajiv).post('/api/projects', { code_name: 'Project Plain' });
    expect((await t.as(USERS.rajiv).get(`/api/projects/${lead.body.project.project_id}/finance`)).body.gap.state).toBe('no-data');
  });

  it('lets only finance editors run the set-up', async () => {
    const res = await t.as(USERS.rajiv).post('/api/projects', { code_name: 'Project Onyx', members: [{ user_id: USERS.daniel, member_role: 'Manager' }] });
    const pid = res.body.project.project_id;
    const body = { fee_budget: 400000, one_time_cost: 1000000, spa_seller_cap: 300000, seller_committed: 200000, buyer_committed: 300000,
      cost_lines: [{ category: 'IT infrastructure', amount: 400000, payer: 'Seller' }, { category: 'Network and sites', amount: 600000, payer: 'Shared', buyer_usage_pct: 60 }] };
    expect((await t.as(USERS.daniel).post(`/api/projects/${pid}/finance/setup`, body)).status).toBe(403);
    const ok = await t.as(USERS.rajiv).post(`/api/projects/${pid}/finance/setup`, body);
    expect(ok.status).toBe(200);
    expect(ok.body.gap.uses).toBe(1000000);
    expect(ok.body.gap.gap).toBe(500000);
    expect(ok.body.gap.scenarios.find((s: any) => s.key === 'usage').sellerShare).toBe(300000); // 400K + 40% of 600K = 640K, capped at 300K
    const p = (await t.as(USERS.rajiv).get(`/api/projects/${pid}`)).body.project;
    expect(p.funding_gap).toBe(500000);
  });
});

describe('bank outreach', () => {
  let rid = '';
  it('lets the manager draft (no client name or contacts) and save, but not send', async () => {
    const d = await t.as(USERS.daniel).post(`/api/projects/${RIOJA}/finance/bank-requests/draft-email`, { bank_code: 'BANK1', product: 'Bridge loan', amount: 174000 });
    expect(d.status).toBe(200);
    expect(d.body.mode).toBe('offline');
    expect(d.body.body).toContain('Project Rioja');
    const rioja = t.data.projects.find((p) => p.project_id === RIOJA)!;
    expect(d.body.body).not.toContain(rioja.client_alias);
    for (const c of t.data.contacts.filter((x) => x.project_id === RIOJA)) {
      expect(d.body.body).not.toContain(c.email);
      expect(d.body.body).not.toContain(c.phone);
    }
    expect(d.body.body).not.toMatch(/@/);
    const saved = await t.as(USERS.daniel).post(`/api/projects/${RIOJA}/finance/bank-requests`, { bank_code: 'BANK1', product: 'Bridge loan', amount: 174000, email_subject: d.body.subject, email_body: d.body.body });
    expect(saved.status).toBe(201);
    expect(saved.body.status).toBe('Draft');
    expect(saved.body.can.markSent).toBe(false);
    rid = saved.body.request_id;
    expect((await t.as(USERS.daniel).post(`/api/projects/${RIOJA}/finance/bank-requests/${rid}/status`, { status: 'Sent' })).status).toBe(403);
  });

  it('partner marks it sent (communications row) and records a term sheet (funding line created and linked)', async () => {
    const api = t.as(USERS.rajiv);
    const sent = await api.post(`/api/projects/${RIOJA}/finance/bank-requests/${rid}/status`, { status: 'Sent' });
    expect(sent.status).toBe(200);
    expect(sent.body.sent_at).toBeTruthy();
    const comms = (await api.get(`/api/projects/${RIOJA}/communications`)).body as any[];
    expect(comms.some((c) => c.channel === 'Email' && /Financing enquiry sent to Northbridge/.test(c.subject))).toBe(true);
    // content of a sent request is frozen
    expect((await api.patch(`/api/projects/${RIOJA}/finance/bank-requests/${rid}`, { amount: 1 })).status).toBe(409);
    const ts = await api.post(`/api/projects/${RIOJA}/finance/bank-requests/${rid}/status`, { status: 'Term sheet', term: { amount: 170000, interest_rate_pct: 9.75, tenor_months: 12 } });
    expect(ts.status).toBe(200);
    expect(ts.body.funding_id).toBeTruthy();
    const w = (await api.get(`/api/projects/${RIOJA}/finance`)).body;
    const f = w.fundingSources.find((x: any) => x.funding_id === ts.body.funding_id);
    expect(f.status).toBe('Term sheet');
    expect(f.amount).toBe(170000);
    expect(f.provider).toMatch(/Bank 1/);
    expect(w.bankRequests.find((r: any) => r.request_id === rid).funding_status).toBe('Term sheet');
    const auditRows = (await t.as(USERS.fatima).get(`/api/audit?projectId=${RIOJA}`)).body as any[];
    expect(auditRows.some((a) => a.action === 'finance.bankreq.status')).toBe(true);
    expect(auditRows.some((a) => a.action === 'finance.bankreq.create')).toBe(true);
  });

  it('keeps analysts and clients out', async () => {
    for (const u of [USERS.sneha, USERS.kenji]) {
      expect((await t.as(u).post(`/api/projects/${RIOJA}/finance/bank-requests/draft-email`, { bank_code: 'BANK1', product: 'Bridge loan', amount: 1000 })).status).toBe(403);
      expect((await t.as(u).post(`/api/projects/${RIOJA}/finance/bank-requests`, { bank_code: 'BANK1', product: 'Bridge loan', amount: 1000 })).status).toBe(403);
      expect((await t.as(u).get(`/api/projects/${RIOJA}/finance/gap`)).status).toBe(403);
    }
    // the exec can view but not draft
    expect((await t.as(USERS.exec).post(`/api/projects/${RIOJA}/finance/bank-requests`, { bank_code: 'BANK1', product: 'Bridge loan', amount: 1000 })).status).toBe(403);
  });

  it('serves an offline AI gap summary that uses only computed figures', async () => {
    const r = await t.as(USERS.daniel).post(`/api/projects/${RIOJA}/finance/gap/summary`, {});
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('offline');
    expect(r.body.text).toMatch(/Project Rioja/);
    expect(r.body.text).toMatch(/1\.74M/);
  });
});

// ---------------- v1.4 fix round ----------------
describe('partial cost breakdown keeps the estimate', () => {
  it('uses max(lines, estimate) with an Unallocated estimate evidence row', () => {
    const a = analyseGap({ project: proj({ one_time_cost: 2000000 }), costItems: [cost('C1', 500000, 'Seller')], funding: [fund('Buyer balance-sheet cash', 800000)], tsaRunRate: 0 });
    expect(a.state).toBe('gap');
    expect(a.uses).toBe(2000000);
    expect(a.gap).toBe(1200000);
    for (const s of a.scenarios) {
      const un = s.evidence.find((e) => e.label.startsWith('Unallocated estimate'));
      expect(un?.amount).toBe(1500000);
      expect(un?.cost_id).toBeUndefined();
      expect(s.sellerShare + s.buyerShare).toBe(2000000);
    }
    expect(a.nextSteps.some((x) => /remaining USD 1.5M/.test(x.text))).toBe(true);
    // lines above the estimate win
    expect(analyseGap({ project: proj({ one_time_cost: 100 }), costItems: [cost('C1', 500, 'Seller')], funding: [], tsaRunRate: 0 }).uses).toBe(500);
  });

  it('keeps projects.funding_gap in sync: estimate only, partial lines, lines removed', async () => {
    const api = t.as(USERS.rajiv);
    const pid = (await api.post('/api/projects', { code_name: 'Project Garnet', one_time_cost: 1000000 })).body.project.project_id;
    const gap = async () => (await api.get(`/api/projects/${pid}`)).body.project.funding_gap ?? 0;
    await api.post(`/api/projects/${pid}/finance/setup`, { buyer_committed: 400000 });
    expect(await gap()).toBe(600000); // estimate only, with funding
    const line = await api.post(`/api/projects/${pid}/finance/costs`, { category: 'Data migration', amount: 300000, status: 'Planned', payer: 'Buyer' });
    expect(await gap()).toBe(600000); // partial breakdown does not erase the gap
    expect((await api.get(`/api/projects/${pid}/finance`)).body.sourcesUses.usesTotal).toBe(1000000);
    await api.post(`/api/projects/${pid}/finance/costs`, { category: 'IT infrastructure', amount: 1200000, status: 'Planned', payer: 'Seller' });
    expect(await gap()).toBe(1100000); // lines now exceed the estimate
    await api.patch(`/api/projects/${pid}`, { one_time_cost: 2000000 });
    expect(await gap()).toBe(1600000);
    await api.del(`/api/projects/${pid}/finance/costs/${line.body.cost_id}`);
    expect(await gap()).toBe(1600000); // estimate still governs
    const dash = (await t.as(USERS.exec).get('/api/dashboard')).body;
    expect(dash.kpis.fundingGap).toBeGreaterThanOrEqual(1600000);
  });
});

describe('bank-request rights follow the role on the project', () => {
  const p = proj({ project_id: 'PRJ-X' });
  const auth = (code: string, actions: string[], acting?: string) => ({ code, actions, actingCode: acting, grantProjectId: acting ? 'PRJ-X' : null, user: { user_id: 'U' } } as any);
  it('drafting needs Partner/Manager (acting counts); sending also needs finance.edit', () => {
    expect(bankPerms(auth('PARTNER', ['finance.view', 'finance.edit']), p)).toMatchObject({ canDraft: true, canSend: true });
    expect(bankPerms(auth('MANAGER', ['finance.view']), p)).toMatchObject({ canDraft: true, canSend: false });
    expect(bankPerms(auth('ANALYST', ['finance.view'], 'MANAGER'), p)).toMatchObject({ canDraft: true, canSend: false });
    expect(bankPerms(auth('MANAGER', ['finance.view', 'finance.edit'], 'PARTNER'), p)).toMatchObject({ canDraft: true, canSend: true });
    expect(bankPerms(auth('LEAD', ['finance.view', 'finance.edit']), p)).toMatchObject({ canDraft: false, canSend: false });
    expect(bankPerms(auth('ANALYST', ['finance.view']), p)).toMatchObject({ canDraft: false, canSend: false });
    expect(bankPerms(auth('EXEC', ['finance.view']), p).canDraft).toBe(false);
  });

  it('an analyst acting as Engagement Manager on Rioja can draft there, not send', async () => {
    const now = Date.now();
    await t.db.insert('access_grants', {
      project_id: RIOJA, grantee_user_id: USERS.aditya, permission_code: 'role.MANAGER', justification: 'Covering for the manager this month.',
      duration_days: 30, status: 'Active', requested_by: USERS.rajiv, l1_approver_id: USERS.rajiv, l2_approver_id: USERS.fatima,
      starts_at: new Date(now - 86400000).toISOString(), expires_at: new Date(now + 20 * 86400000).toISOString(),
    });
    const r = await t.as(USERS.aditya).post(`/api/projects/${RIOJA}/finance/bank-requests`, { bank_code: 'BANK2', product: 'Bridge loan', amount: 100000 });
    expect(r.status).toBe(201);
    expect(r.body.can.markSent).toBe(false);
    expect((await t.as(USERS.aditya).post(`/api/projects/${RIOJA}/finance/bank-requests/${r.body.request_id}/status`, { status: 'Sent' })).status).toBe(403);
  });
});

describe('saved bank emails carry no contact details', () => {
  it('detects emails and phone numbers but not dates or amounts', () => {
    expect(contactDetailIn('Call me on +91 98200 11201')).toBe('phone number');
    expect(contactDetailIn('write to kenji@client-rioja.example')).toBe('email address');
    expect(contactDetailIn('By 2026-11-30, about USD 1,740,000 (USD 174000).')).toBeNull();
  });
  it('rejects them on create and update with 400', async () => {
    const api = t.as(USERS.daniel);
    const base = { bank_code: 'BANK1', product: 'Bridge loan', amount: 174000 };
    const bad = await api.post(`/api/projects/${RIOJA}/finance/bank-requests`, { ...base, email_subject: 'Enquiry', email_body: 'Reach the CFO at cfo@rioja-buyer.example' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/email address/);
    const ok = await api.post(`/api/projects/${RIOJA}/finance/bank-requests`, { ...base, email_subject: 'Enquiry', email_body: 'Draft for 2026-11-30.' });
    expect(ok.status).toBe(201);
    const up = await api.patch(`/api/projects/${RIOJA}/finance/bank-requests/${ok.body.request_id}`, { email_body: 'Call Kenji on +1 408 555 0126' });
    expect(up.status).toBe(400);
    expect(up.body.error).toMatch(/phone number/);
  });
});

// ---------------- v1.4.1 ----------------
describe('v1.4.1 wording and consistency', () => {
  it('splits a 50% shared line 50 / 50 under beneficiary pays', () => {
    const a = analyseGap({ project: proj(), costItems: [cost('A', 800, 'Seller'), cost('B', 200, 'Shared', 50)], funding: [], tsaRunRate: 0 });
    const ev = a.scenarios.find((s) => s.key === 'beneficiary')!.evidence.find((e) => e.cost_id === 'B')!;
    expect(ev.seller).toBe(100);
    expect(ev.rule).toMatch(/no main user, split 50 \/ 50/);
    expect(a.recommendation!.reasons.join(' ')).toMatch(/Only 1 shared or untagged line \(USD 200\) needs a decision/);
  });

  it('only recommends a back-up when the pipeline already covers the buyer gap', () => {
    const costs = [cost('A', 1000, 'Buyer')];
    const funding = [fund('Buyer balance-sheet cash', 400), { ...fund('Venture / private credit', 700, 'Term sheet'), interest_rate_pct: 12.5, provider: 'Arcadia' } as FundingSource];
    const a = analyseGap({ project: proj(), costItems: costs, funding, tsaRunRate: 0 });
    expect(a.gapAfterPipeline).toBe(0);
    const bank = a.routes.filter((r) => r.type === 'Bridge loan');
    expect(bank).toHaveLength(1);
    expect(bank[0].fallback).toBe(true);
    expect(bank[0].why).toMatch(/Back-up only.*already covered/);
    expect(a.nextSteps.some((s) => /ask a bank/.test(s.text))).toBe(false);
    expect(a.nextSteps.some((s) => /back-up/.test(s.text))).toBe(true);
  });

  it('flags open drafts that ask for more than still needs a source', async () => {
    const api = t.as(USERS.daniel);
    const r = await api.post(`/api/projects/${RIOJA}/finance/bank-requests`, { bank_code: 'BANK3', product: 'Term loan', amount: 99000000 });
    expect(r.status).toBe(201);
    const w = (await api.get(`/api/projects/${RIOJA}/finance`)).body;
    expect(w.bankRequests.find((x: any) => x.request_id === r.body.request_id).outdated).toMatch(/^Outdated/);
    expect(w.banks.map((b: any) => b.name)).toContain('Bank 1 (demo) – Northbridge Bank');
  });
});
