/**
 * Finance workspace (v1.3): one read model per project that answers
 *   - where the time and money go (effort by stage, activity and person, valued at the demo rate card),
 *   - who billed what (invoices, billed vs budget, outstanding and overdue),
 *   - what the separation costs and who pays (cost lines by category, stage and payer),
 *   - how it is funded (sources & uses: secured vs pipeline vs unfunded).
 * Visibility only: the app records and explains funding; it never applies for or arranges financing.
 */
import type { Db, Row } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type {
  Activity, CostItem, EffortRow, FinanceEntry, FinanceWorkspace, FundingSource, Invoice, Persona, Project, ProjectMember, Stage, Task, TsaService, User, AccessGrant,
} from '../../../shared/types';
import { COST_CATEGORIES } from '../../../shared/schema';
import { RATE_CARD, rateFor, SECURED_STATUSES, PIPELINE_STATUSES } from '../../../shared/finance';
import { viaGrant } from './grants';

const n = (v: unknown) => Number(v) || 0;
const r0 = (v: number) => Math.round(v);
const todayIso = () => new Date().toISOString().slice(0, 10);

export async function buildFinanceWorkspace(db: Db, auth: AuthContext, project: Project): Promise<FinanceWorkspace> {
  const pid = project.project_id;
  const [entries, tsaServices, stages, activities, tasks, users, personas, invoices, costItems, funding] = await Promise.all([
    db.find<FinanceEntry>('finance_entries', (f) => f.project_id === pid),
    db.find<TsaService>('tsa_services', (s) => s.project_id === pid),
    db.find<Stage>('stages', (s) => s.project_id === pid),
    db.find<Activity>('activities', (a) => a.project_id === pid),
    db.find<Task>('tasks', (t) => t.project_id === pid),
    db.all<User>('users', { includeDeleted: true }),
    db.all<Persona>('personas'),
    db.find<Invoice>('invoices', (i) => i.project_id === pid),
    db.find<CostItem>('cost_items', (c) => c.project_id === pid),
    db.find<FundingSource>('funding_sources', (f) => f.project_id === pid),
  ]);
  entries.sort((a, b) => a.period_month.localeCompare(b.period_month));
  stages.sort((a, b) => a.sort_order - b.sort_order);
  const pcode = new Map(personas.map((p) => [p.persona_id, p.code]));
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const personaOf = (uid?: string | null) => (uid ? pcode.get(userById.get(uid)?.persona_id || '') : undefined);
  const nameOf = (uid?: string | null) => (uid ? userById.get(uid)?.full_name : undefined);
  const stageName = new Map(stages.map((s) => [s.stage_id, s.name]));
  const actName = new Map(activities.map((a) => [a.activity_id, a.name]));

  // ---- effort (time and its value) ----
  const blank = (key: string, label: string, extra: Partial<EffortRow> = {}): EffortRow & { _people: Set<string> } =>
    ({ key, label, hours: 0, doneHours: 0, value: 0, tasks: 0, _people: new Set(), ...extra });
  const byStage = new Map(stages.map((s) => [s.stage_id, blank(s.stage_id, s.name, { start: s.start_date, end: s.end_date })]));
  const byAct = new Map<string, ReturnType<typeof blank>>();
  const byPerson = new Map<string, ReturnType<typeof blank> & { persona?: string }>();
  for (const t of tasks) {
    const hours = n(t.effort_hours);
    const done = t.status === 'Done' ? hours : hours * (n(t.percent_complete) / 100);
    const persona = personaOf(t.assignee_user_id);
    const value = hours * rateFor(persona);
    const add = (row: ReturnType<typeof blank>) => { row.hours += hours; row.doneHours += done; row.value += value; row.tasks += 1; if (t.assignee_user_id) row._people.add(t.assignee_user_id); };
    const s = byStage.get(t.stage_id); if (s) add(s);
    if (!byAct.has(t.activity_id)) byAct.set(t.activity_id, blank(t.activity_id, actName.get(t.activity_id) || t.activity_id, { sub: stageName.get(t.stage_id) }));
    add(byAct.get(t.activity_id)!);
    const pk = t.assignee_user_id || 'unassigned';
    if (!byPerson.has(pk)) byPerson.set(pk, { ...blank(pk, nameOf(t.assignee_user_id) || 'Unassigned'), persona });
    add(byPerson.get(pk)!);
  }
  const finish = <T extends ReturnType<typeof blank>>(r: T) => {
    const { _people, ...rest } = r;
    return { ...rest, hours: r0(rest.hours), doneHours: r0(rest.doneHours), value: r0(rest.value), people: _people.size };
  };

  // ---- billing ----
  const billedBy = new Map<string, number>();
  for (const i of invoices) if (i.status !== 'Draft' && i.billed_by_user_id) billedBy.set(i.billed_by_user_id, (billedBy.get(i.billed_by_user_id) || 0) + n(i.amount));
  const today = todayIso();
  const invoiceRows = invoices
    .map((i) => ({ ...i, status: (i.status === 'Sent' && i.due_date && i.due_date < today ? 'Overdue' : i.status) as Invoice['status'], billed_by_name: nameOf(i.billed_by_user_id), stage_name: stageName.get(i.stage_id || '') }))
    .sort((a, b) => (b.period_month || b.issued_date || '').localeCompare(a.period_month || a.issued_date || '') || b.invoice_no.localeCompare(a.invoice_no));
  const sumWhere = (pred: (i: Invoice) => boolean) => invoiceRows.filter(pred).reduce((s, i) => s + n(i.amount), 0);
  const invoiced = sumWhere((i) => i.status !== 'Draft');
  const paid = sumWhere((i) => i.status === 'Paid');
  const people = [...byPerson.values()].map((p) => ({ ...finish(p), persona: p.persona, billedBy: r0(billedBy.get(p.key) || 0) }));
  // Partners/managers who raised invoices but have no tasks still appear in "who billed what".
  for (const [uid, amt] of billedBy) if (!byPerson.has(uid)) people.push({ key: uid, label: nameOf(uid) || uid, hours: 0, doneHours: 0, value: 0, tasks: 0, people: 0, persona: personaOf(uid), billedBy: r0(amt) });

  // ---- sources & uses ----
  const uses = COST_CATEGORIES.map((category) => {
    const rows = costItems.filter((c) => c.category === category);
    const by = (st: string) => rows.filter((c) => c.status === st).reduce((s, c) => s + n(c.amount), 0);
    const planned = by('Planned'); const committed = by('Committed'); const spent = by('Spent');
    return { category, planned, committed, spent, total: planned + committed + spent };
  }).filter((u) => u.total > 0);
  const payers = new Map<string, number>();
  for (const c of costItems) payers.set(c.payer || 'Not agreed', (payers.get(c.payer || 'Not agreed') || 0) + n(c.amount));
  const usesTotal = uses.reduce((s, u) => s + u.total, 0);
  const secured = funding.filter((f) => SECURED_STATUSES.includes(f.status)).reduce((s, f) => s + n(f.amount), 0);
  const pipeline = funding.filter((f) => PIPELINE_STATUSES.includes(f.status)).reduce((s, f) => s + n(f.amount), 0);

  const sum = (k: keyof FinanceEntry) => entries.reduce((s, e) => s + n(e[k]), 0);
  const activeTsa = tsaServices.filter((s) => s.status === 'Active' || s.status === 'Exiting' || s.status === 'Extended');
  const totalHours = tasks.reduce((s, t) => s + n(t.effort_hours), 0);
  const effortValue = [...byStage.values()].reduce((s, x) => s + x.value, 0);
  const closed = project.status === 'Closed';
  const hasEdit = auth.actions.includes('finance.edit');

  return {
    project: { project_id: pid, code_name: project.code_name, currency: project.currency || 'USD', client_alias: project.client_alias, status: project.status, clean_team_required: project.clean_team_required },
    entries, tsaServices,
    totals: {
      // v1.2 keys (kept for compatibility)
      fee_budget: n(project.fee_budget), fee_billed: n(project.fee_billed), fee_planned_to_date: sum('fee_planned'), fee_actual_to_date: sum('fee_actual'),
      tsa_cost_to_date: sum('tsa_cost'), one_time_cost_to_date: sum('one_time_cost'), hours_logged: sum('hours_logged'),
      tsa_monthly_active: activeTsa.reduce((s, x) => s + n(x.monthly_fee), 0), tsa_services_active: activeTsa.length,
      funding_gap: n(project.funding_gap), one_time_cost_estimate: n(project.one_time_cost),
      // v1.3
      planned_hours: r0(totalHours), effort_value: r0(effortValue), tsa_run_rate: n(project.tsa_monthly_cost),
    },
    rateCard: RATE_CARD.map((r) => ({ persona: r.persona, label: r.label, rate: r.rate })),
    effort: {
      byStage: [...byStage.values()].map(finish),
      byActivity: [...byAct.values()].map(finish).sort((a, b) => b.value - a.value),
      byPerson: people.sort((a, b) => b.value + (b.billedBy || 0) - (a.value + (a.billedBy || 0))),
    },
    invoices: invoiceRows,
    costItems: costItems.map((c) => ({ ...c, stage_name: stageName.get(c.stage_id || ''), activity_name: actName.get(c.activity_id || '') }))
      .sort((a, b) => n(b.amount) - n(a.amount)),
    fundingSources: funding.map((f) => ({ ...f, owner_name: nameOf(f.owner_user_id) })).sort((a, b) => n(b.amount) - n(a.amount)),
    sourcesUses: {
      uses, byPayer: [...payers.entries()].map(([payer, total]) => ({ payer, total })),
      usesTotal, secured, pipeline, unfunded: Math.max(0, usesTotal - secured), recordedGap: n(project.funding_gap),
    },
    billing: {
      budget: n(project.fee_budget), invoiced, paid, outstanding: invoiced - paid, overdue: sumWhere((i) => i.status === 'Overdue'),
      wip: Math.max(0, sum('fee_actual') - invoiced),
    },
    perms: {
      canEdit: hasEdit && !closed,
      editReason: closed ? 'This project is closed; finance is read-only.' : hasEdit ? undefined : 'Your role can view finance but not change it. Ask the Engagement Partner, or raise an access request.',
      viaGrant: viaGrant(auth, 'finance.view') || viaGrant(auth, 'finance.edit'),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Demo data for the finance workspace and access governance (used by the seed and by the one-time upgrade top-up).
// ---------------------------------------------------------------------------------------------------------------

function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const pad = (i: number) => String(i).padStart(4, '0');
const DAY = 86400000;

export interface FinanceDemoInput { projects: Row[]; stages: Row[]; tasks: Row[]; finance_entries: Row[]; project_members: Row[]; users: Row[]; personas: Row[] }

export function generateFinanceDemo(input: FinanceDemoInput, now = new Date()): { funding_sources: Row[]; cost_items: Row[]; invoices: Row[]; access_grants: Row[] } {
  const out = { funding_sources: [] as Row[], cost_items: [] as Row[], invoices: [] as Row[], access_grants: [] as Row[] };
  const ids: Record<string, number> = {};
  const id = (p: string) => `${p}-${pad((ids[p] = (ids[p] || 0) + 1))}`;
  const nowMs = now.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const d = (ms: number) => iso(ms).slice(0, 10);
  const base = (by: string | null, at = nowMs - 30 * DAY) => ({ created_at: iso(at), created_by: by, updated_at: null, updated_by: null, is_deleted: 'N' });
  const today = d(nowMs);

  for (const p of input.projects) {
    if (p.is_deleted === 'Y') continue;
    const pid = p.project_id as string;
    const rnd = (() => { let s = hash(pid); return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s / 4294967296; }; })();
    const stages = input.stages.filter((s) => s.project_id === pid && s.is_deleted !== 'Y').sort((a, b) => a.sort_order - b.sort_order);
    const byName = (re: RegExp) => stages.find((s) => re.test(s.name)) ?? stages[0];
    const closed = p.status === 'Closed';
    const stageState = (s?: Row) => (closed || s?.status === 'Done' ? 'Spent' : s?.status === 'In Progress' || s?.status === 'Blocked' ? 'Committed' : 'Planned');

    // Uses: one-time separation cost split by category.
    const oneTime = Number(p.one_time_cost) || 0;
    if (oneTime > 0) {
      const plan: [string, number, RegExp, string, string][] = [
        ['IT infrastructure', 0.24, /day-1|readiness/i, 'Seller', 'Stand-up hosting and end-user devices'],
        ['Applications and licences', 0.2, /signing|day-1|readiness/i, 'Buyer', 'New licences and app clones for the stand-alone business'],
        ['Data migration', 0.14, /tsa|exit/i, 'Buyer', 'Data extraction and migration waves'],
        ['Network and sites', 0.12, /day-1|readiness/i, 'Shared', 'New circuits and site re-addressing'],
        ['People and retention', 0.08, /signing/i, 'Seller', 'Retention for key IT staff through Day-1'],
        ['Third-party advisors', 0.08, /diligence|signing/i, 'Shared', 'Legal, tax and specialist advisors'],
        ['TSA and extensions', 0.09, /tsa|exit/i, 'Buyer', 'Extension uplift on late TSA exits'],
        ['Contingency', 0.05, /close/i, 'Shared', 'Contingency held by the control board'],
      ];
      for (const [category, share, re, payer, desc] of plan) {
        const st = byName(re);
        out.cost_items.push({
          cost_id: id('CST'), project_id: pid, stage_id: st?.stage_id ?? null, activity_id: null, category, description: desc,
          amount: Math.round((oneTime * share * (0.85 + rnd() * 0.3)) / 1000) * 1000, status: category === 'Contingency' && !closed ? 'Planned' : stageState(st),
          payer, vendor: category === 'Network and sites' ? 'Carrier (demo)' : category === 'IT infrastructure' ? 'Cloudline Managed Services (demo vendor)' : null, ...base(p.manager_user_id),
        });
      }
      // Sources: secured = one-time cost - recorded gap; part of the gap is in the pipeline.
      const gap = Number(p.funding_gap) || 0;
      const usesTotal = out.cost_items.filter((c) => c.project_id === pid).reduce((s, c) => s + c.amount, 0);
      const securedTarget = Math.max(0, usesTotal - gap);
      const secured: [string, string, number, string, number | null, number | null, string][] = [
        ['Seller contribution (SPA)', 'Seller, per SPA separation-cost clause', 0.45, closed ? 'Drawn' : 'Committed', null, null, 'Seller pays IT stand-up and retention up to an agreed cap.'],
        ['Buyer balance-sheet cash', 'Buyer treasury', 0.35, closed ? 'Drawn' : 'Committed', null, null, 'Approved separation budget in the buyer integration plan.'],
        ['Bridge loan', 'Northbridge Bank (demo)', 0.2, closed || rnd() < 0.5 ? 'Drawn' : 'Committed', 9.5, 12, 'Covers Day-1 spend until the term facility is in place.'],
      ];
      for (const [type, provider, share, status, rate, tenor, purpose] of secured) {
        if (securedTarget <= 0) break;
        out.funding_sources.push({
          funding_id: id('FND'), project_id: pid, source_type: type, provider, amount: Math.round((securedTarget * share) / 1000) * 1000, status,
          interest_rate_pct: rate, tenor_months: tenor, purpose, expected_date: p.start_date || null, owner_user_id: p.manager_user_id, notes: null, ...base(p.manager_user_id),
        });
      }
      if (gap > 0 && !closed) {
        out.funding_sources.push({
          funding_id: id('FND'), project_id: pid, source_type: 'Venture / private credit', provider: 'Arcadia Credit Fund (demo)', amount: Math.round((gap * 0.6) / 1000) * 1000,
          status: 'Term sheet', interest_rate_pct: 12.5, tenor_months: 24, purpose: 'Option to close the remaining funding gap on equipment and licences.',
          expected_date: d(nowMs + 30 * DAY), owner_user_id: p.partner_user_id, notes: 'Pricing high; compare with vendor deferred payment.', ...base(p.partner_user_id),
        });
        out.funding_sources.push({
          funding_id: id('FND'), project_id: pid, source_type: 'Vendor / deferred payment', provider: 'Cloudline Managed Services (demo vendor)', amount: Math.round((gap * 0.3) / 1000) * 1000,
          status: 'Identified', interest_rate_pct: null, tenor_months: 36, purpose: 'Spread hosting transition cost over the new 3-year contract.',
          expected_date: d(nowMs + 45 * DAY), owner_user_id: p.manager_user_id, notes: null, ...base(p.manager_user_id),
        });
      }
    }

    // Invoices: one per finance month, scaled so non-draft invoices add up to the recorded fee_billed.
    const fins = input.finance_entries.filter((f) => f.project_id === pid).sort((a, b) => a.period_month.localeCompare(b.period_month));
    if (fins.length) {
      const lastMonth = fins[fins.length - 1].period_month;
      const billable = fins.filter((f) => closed || f.period_month !== lastMonth);
      const actual = billable.reduce((s, f) => s + (Number(f.fee_actual) || 0), 0) || 1;
      const scale = (Number(p.fee_billed) || actual) / actual;
      fins.forEach((f, i) => {
        const draft = !closed && f.period_month === lastMonth;
        const [y, m] = f.period_month.split('-').map(Number);
        const issuedMs = Date.UTC(y, m, 3); // 3rd of the following month
        const dueMs = issuedMs + 45 * DAY;
        const prevMonths = fins.length - 1 - i;
        let status = draft ? 'Draft' : closed || prevMonths >= 3 ? 'Paid' : 'Sent';
        if (status === 'Sent' && d(dueMs) < today) status = rnd() < 0.5 ? 'Overdue' : 'Paid';
        const st = stages.find((s) => s.start_date && s.start_date.slice(0, 7) <= f.period_month && (!s.end_date || s.end_date.slice(0, 7) >= f.period_month)) ?? stages.find((s) => s.stage_id === p.current_stage_id);
        out.invoices.push({
          invoice_id: id('INV'), project_id: pid, invoice_no: `${String(p.code_name).replace(/^Project\s+/, '').slice(0, 3).toUpperCase()}-${f.period_month.replace('-', '')}`,
          period_month: f.period_month, stage_id: st?.stage_id ?? null, description: `Professional fees, ${st?.name ?? 'separation programme'}`,
          amount: Math.round(((Number(f.fee_actual) || 0) * (draft ? 1 : scale)) / 100) * 100, status,
          issued_date: draft ? null : d(Math.min(issuedMs, nowMs)), due_date: draft ? null : d(dueMs), paid_date: status === 'Paid' ? d(Math.min(dueMs - 10 * DAY, nowMs)) : null,
          billed_by_user_id: draft ? p.manager_user_id : p.partner_user_id, billed_to: p.client_alias || 'Client', ...base(draft ? p.manager_user_id : p.partner_user_id, Math.min(issuedMs, nowMs)),
        });
      });
    }
  }

  // Access governance examples (Rioja / Atlas), so the approval inbox is not empty in the demo.
  const proj = (code: string) => input.projects.find((p) => p.code_name === code);
  const user = (name: string) => input.users.find((u) => u.full_name === name)?.user_id;
  const rioja = proj('Project Rioja');
  const atlas = proj('Project Atlas');
  const fatima = user('Fatima Sheikh');
  if (rioja && fatima) {
    const daniel = user('Daniel Brooks'); const rajiv = user('Rajiv Khanna'); const sneha = user('Sneha Pillai'); const rohan = user('Rohan Desai'); const aditya = user('Aditya Joshi');
    if (rohan && rajiv) out.access_grants.push({
      grant_id: id('GRT'), project_id: rioja.project_id, grantee_user_id: rohan, permission_code: 'finance.view', duration_days: 30, status: 'Active',
      justification: 'Leads the funding-gap workstream; needs to see the cost lines and funding sources to split the US$1.74M gap.',
      requested_by: rajiv, l1_approver_id: rajiv, l1_decided_at: iso(nowMs - 6 * DAY), l1_note: 'Sponsored by the Engagement Partner.',
      l2_approver_id: fatima, l2_decided_at: iso(nowMs - 5 * DAY), l2_note: 'Need-to-know confirmed; on the clean team.', starts_at: iso(nowMs - 5 * DAY), expires_at: iso(nowMs + 25 * DAY),
      ...base(rajiv, nowMs - 6 * DAY),
    });
    if (sneha && daniel) out.access_grants.push({
      grant_id: id('GRT'), project_id: rioja.project_id, grantee_user_id: sneha, permission_code: 'finance.view', duration_days: 7, status: 'Pending L2',
      justification: 'Preparing the cost-sharing scenarios for the control board; I need the cost lines and who pays.',
      requested_by: sneha, l1_approver_id: daniel, l1_decided_at: iso(nowMs - 1 * DAY), l1_note: 'Agreed for one week, read-only.',
      ...base(sneha, nowMs - 2 * DAY),
    });
    if (aditya && daniel) out.access_grants.push({
      grant_id: id('GRT'), project_id: rioja.project_id, grantee_user_id: aditya, permission_code: 'task.edit', duration_days: 30, status: 'Rejected',
      justification: 'Want to re-plan due dates for the network tasks.', requested_by: aditya, l1_approver_id: daniel, l1_decided_at: iso(nowMs - 9 * DAY),
      l1_note: 'Editing your own tasks is enough; raise date changes with Rohan.', ...base(aditya, nowMs - 10 * DAY),
    });
  }
  if (atlas) {
    const karan = user('Karan Malhotra');
    if (karan && input.project_members.some((m) => m.project_id === atlas.project_id && m.user_id === karan)) out.access_grants.push({
      grant_id: id('GRT'), project_id: atlas.project_id, grantee_user_id: karan, permission_code: 'contacts.view.full', duration_days: 30, status: 'Pending L1',
      justification: 'Need to call the seller application owners directly to confirm the inventory.', requested_by: karan, ...base(karan, nowMs - 1 * DAY),
    });
  }
  return out;
}

/** One-time top-up after upgrading to v1.3: fills the new tables when they are all empty (existing local files or Sheets). */
export async function ensureFinanceDemo(db: Db): Promise<boolean> {
  const counts = await db.counts();
  if (counts.funding_sources || counts.cost_items || counts.invoices || counts.access_grants || !counts.projects) return false;
  const [projects, stages, tasks, finance_entries, project_members, users, personas] = await Promise.all([
    db.all('projects'), db.all('stages'), db.all('tasks'), db.all('finance_entries'), db.all('project_members'), db.all('users'), db.all('personas'),
  ]);
  const demo = generateFinanceDemo({ projects, stages, tasks, finance_entries, project_members, users, personas });
  if (demo.cost_items.length) await db.insertMany('cost_items', demo.cost_items);
  if (demo.funding_sources.length) await db.insertMany('funding_sources', demo.funding_sources);
  if (demo.invoices.length) await db.insertMany('invoices', demo.invoices);
  if (demo.access_grants.length) await db.insertMany('access_grants', demo.access_grants);
  return true;
}

export type { AccessGrant, ProjectMember };
