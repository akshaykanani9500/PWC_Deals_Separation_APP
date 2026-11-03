/**
 * Funding need analysis (v1.4). Deterministic: the same cost lines, funding lines and SPA terms always give the same answer.
 *
 *   uses      = sum of the project's cost lines (or the one-time cost estimate when no lines exist yet)
 *   secured   = funding lines that are Committed or Drawn; split into seller-side (SPA contribution, escrow) and buyer-side
 *   pipeline  = funding lines that are Identified, In discussion or Term sheet (shown separately, never counted as secured)
 *   gap       = max(0, uses - secured)
 *
 * Four ways to share the cost lines (rules in shared/finance.ts GAP_RULES / GAP_SCENARIOS), each giving
 *   sellerShare + buyerShare = uses, then the SPA seller cap (excess moves to the buyer), then
 *   sellerGap = clamp(sellerShare - securedSeller, 0, gap),  buyerGap = gap - sellerGap.
 * Rules-based recommendation, funding routes from FUNDING_PLAYBOOK, next steps with owners and anonymised lessons.
 * Visibility only: nothing here contacts a lender.
 */
import type {
  CostItem, FundingSource, GapAnalysis, GapEvidence, GapLesson, GapNextStep, GapRoute, GapScenario, GapScenarioKey, KnowledgeItem, Project,
} from '../../../shared/types';
import { FUNDING_PLAYBOOK, GAP_RULES, GAP_SCENARIOS, PIPELINE_STATUSES, SECURED_STATUSES, fundingSide } from '../../../shared/finance';

const n = (v: unknown) => Number(v) || 0;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Compact money for sentences: "USD 1.74M", "USD 174K", "USD 950". */
export function fmtMoney(v: number, cur = 'USD'): string {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${+(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${+(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : `${Math.round(a)}`;
  return `${v < 0 ? '-' : ''}${cur} ${s}`;
}

export interface GapInput {
  project: Project;
  costItems: CostItem[];
  funding: FundingSource[];
  /** Client TSA run-rate per month (active services, else the project field). */
  tsaRunRate: number;
  partnerName?: string | null;
  managerName?: string | null;
  /** Knowledge hub rows; only Approved Lesson / Risk / Metric rows are used. */
  knowledge?: KnowledgeItem[];
}

const LESSON_RE = /fund|cost|shar|split|tsa|bridge|escrow|holdback|\bcap\b|budget|stranded|extension|seller|buyer/i;

export function similarLessons(items: KnowledgeItem[], excludeProjectId?: string): GapLesson[] {
  const ok = items.filter((k) => k.review_status === 'Approved' && ['Lesson', 'Risk', 'Metric'].includes(k.item_type) && k.source_project_id !== excludeProjectId && k.is_deleted !== 'Y');
  const out = new Map<string, GapLesson>();
  const metrics: { label: string; p: Record<string, any> }[] = [];
  for (const k of ok) {
    if (k.item_type === 'Metric') {
      try { const p = JSON.parse(k.payload || '{}'); if (p && (p.tsa_term_months != null || p.one_time_cost_pct_revenue != null)) metrics.push({ label: k.source_label || 'Past deal (anonymised)', p }); } catch { /* ignore */ }
      continue;
    }
    if (!LESSON_RE.test(`${k.title} ${k.body ?? ''} ${k.tags ?? ''}`)) continue;
    const cur = out.get(k.title) ?? { title: k.title, body: k.body ?? '', item_type: k.item_type, sources: [] };
    const label = k.source_label || 'Past deal (anonymised)';
    if (!cur.sources.includes(label)) cur.sources.push(label);
    out.set(k.title, cur);
  }
  // Funding-specific lessons first, then the rest.
  const funding = /fund|shar|split|bridge|escrow|holdback|\bcap\b/i;
  const lessons = [...out.values()].sort((a, b) => Number(funding.test(b.title + b.body)) - Number(funding.test(a.title + a.body)) || a.title.localeCompare(b.title));
  if (metrics.length) {
    const range = (k: string) => { const v = metrics.map((m) => Number(m.p[k])).filter((x) => Number.isFinite(x)); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
    const term = range('tsa_term_months'); const ext = range('extensions'); const otc = range('one_time_cost_pct_revenue'); const up = range('extension_uplift_pct');
    const parts = [term && `TSA term ${term[0]}-${term[1]} months`, ext && `${ext[0]}-${ext[1]} TSA extensions`, up && `extension uplift about ${up[1]}%`, otc && `one-time cost ${otc[0]}-${otc[1]}% of revenue`].filter(Boolean);
    lessons.push({ title: `Benchmarks from ${metrics.length} closed deal${metrics.length === 1 ? '' : 's'}`, body: `${parts.join('; ')}. Use them to sense-check the cost lines and the TSA months in the avoided-cost credit.`, item_type: 'Metric', sources: [...new Set(metrics.map((m) => m.label))] });
  }
  return lessons.slice(0, 5);
}

type LineKind = 'Seller' | 'Buyer' | 'Shared' | 'Untagged';
const kindOf = (c: CostItem): LineKind => (c.payer === 'Seller' || c.payer === 'Buyer' || c.payer === 'Shared' ? c.payer : 'Untagged');

export function analyseGap(input: GapInput): GapAnalysis {
  const { project, costItems, funding, tsaRunRate } = input;
  const cur = project.currency || 'USD';
  const m = (v: number) => fmtMoney(v, cur);
  const lines = costItems.filter((c) => c.is_deleted !== 'Y' && n(c.amount) > 0).sort((a, b) => n(b.amount) - n(a.amount));
  const fund = funding.filter((f) => f.is_deleted !== 'Y');
  const sum = (rows: FundingSource[]) => rows.reduce((s, f) => s + n(f.amount), 0);
  const securedRows = fund.filter((f) => SECURED_STATUSES.includes(f.status));
  const pipeRows = fund.filter((f) => PIPELINE_STATUSES.includes(f.status));
  const securedSeller = sum(securedRows.filter((f) => fundingSide(f.source_type) === 'Seller'));
  const securedBuyer = sum(securedRows) - securedSeller;
  const pipelineSeller = sum(pipeRows.filter((f) => fundingSide(f.source_type) === 'Seller'));
  const pipelineBuyer = sum(pipeRows) - pipelineSeller;
  const secured = securedSeller + securedBuyer;
  const pipeline = pipelineSeller + pipelineBuyer;
  const estimate = n(project.one_time_cost);
  const recordedGap = n(project.funding_gap);
  const cap = project.spa_seller_cap == null || (project.spa_seller_cap as unknown) === '' ? null : n(project.spa_seller_cap);
  const clause = project.spa_clause_ref || null;
  const partner = input.partnerName || 'Engagement Partner';
  const manager = input.managerName || 'Engagement Manager';
  const lessons = similarLessons(input.knowledge ?? [], project.project_id);

  const byKind = (k: LineKind) => lines.filter((c) => kindOf(c) === k).reduce((s, c) => s + n(c.amount), 0);
  const usesFromLines = lines.reduce((s, c) => s + n(c.amount), 0);
  // A partial breakdown never shrinks the need: the part of the estimate not yet broken into lines stays in uses (no payer agreed).
  const unallocated = lines.length ? Math.max(0, estimate - usesFromLines) : 0;
  const usesAll = usesFromLines + unallocated;
  const mixRaw = { seller: byKind('Seller'), buyer: byKind('Buyer'), shared: byKind('Shared'), untagged: byKind('Untagged') + unallocated };
  const pctOf = (v: number, tot: number) => (tot > 0 ? v / tot : 0);
  const mix = { ...mixRaw, taggedPct: Math.round(pctOf(mixRaw.seller + mixRaw.buyer, usesAll) * 100), sharedPct: Math.round(pctOf(mixRaw.shared + mixRaw.untagged, usesAll) * 100) };

  const base = {
    currency: cur, securedSeller, securedBuyer, pipelineSeller, pipelineBuyer, pipeline, recordedGap, oneTimeEstimate: estimate,
    spa: { cap, clause }, tsaRunRate, mix, lessons,
  };

  // ---- not enough data ----
  if (!lines.length) {
    if (!estimate) {
      return { ...base, state: 'no-data', uses: 0, secured, gap: 0, gapAfterPipeline: 0, scenarios: [], recommendation: null, routes: [], nextSteps: [
        { text: 'Set up finance: add the one-time cost estimate and the first cost lines with who pays.', owner: partner, role: 'Partner' },
        { text: 'Record the seller cap and clause from the sale agreement (SPA), if there is one.', owner: partner, role: 'Partner' },
        { text: 'Collect vendor quotes for the main cost lines so the split can be modelled.', owner: manager, role: 'Manager' },
      ], watch: [], assumptions: [], headline: 'Not enough finance data yet. Set up finance to see the funding need.' };
    }
    const sec = fund.length ? secured : recordedGap ? Math.max(0, estimate - recordedGap) : 0;
    const gap = fund.length ? Math.max(0, estimate - secured) : recordedGap || Math.max(0, estimate - sec);
    return { ...base, state: 'estimate-only', uses: estimate, secured: sec, gap, gapAfterPipeline: Math.max(0, gap - pipeline), scenarios: [], recommendation: null, routes: [], nextSteps: [
      { text: `Break the ${m(estimate)} estimate into cost lines and tag who pays each one, so the four split scenarios can be compared.`, owner: manager, role: 'Manager' },
      ...(cap == null ? [{ text: 'Record the seller cap and clause from the sale agreement (SPA).', owner: partner, role: 'Partner' as const }] : []),
      { text: 'Record the funding already committed (seller contribution, buyer cash, loans) as funding lines.', owner: manager, role: 'Manager' },
    ], watch: [], assumptions: [fund.length ? 'Secured comes from the funding lines.' : recordedGap ? 'Secured is the estimate minus the funding gap recorded on the project (no funding lines yet).' : 'No funding recorded yet.'],
    headline: gap > 0 ? `Estimated funding gap ${m(gap)} on a ${m(estimate)} one-time cost estimate. Add cost lines to model the split.` : `One-time cost estimate ${m(estimate)}. Add cost lines to model who pays.` };
  }

  // ---- full analysis ----
  const uses = usesAll;
  const gap = Math.max(0, uses - secured);
  const UNALLOC = '__unallocated__';
  const items: CostItem[] = unallocated > 0
    ? [...lines, { cost_id: UNALLOC, project_id: project.project_id, category: 'Contingency', description: 'Unallocated estimate', amount: unallocated, status: 'Planned', created_at: '', is_deleted: 'N' } as unknown as CostItem]
    : lines;
  const gapAfterPipeline = Math.max(0, gap - pipeline);
  const usageOf = (c: CostItem) => (c.buyer_usage_pct == null || (c.buyer_usage_pct as unknown) === '' ? null : clamp(n(c.buyer_usage_pct), 0, 100));
  const assumptions: string[] = [];
  const sharedLines = items.filter((c) => ['Shared', 'Untagged'].includes(kindOf(c)));
  const noUsage = sharedLines.filter((c) => usageOf(c) == null && c.cost_id !== UNALLOC);
  const untaggedLines = lines.filter((c) => kindOf(c) === 'Untagged');
  if (noUsage.length) assumptions.push(`${noUsage.length} shared or untagged line${noUsage.length === 1 ? ' has' : 's have'} no buyer usage %; ${GAP_RULES.defaultUsagePct}% is assumed.`);
  if (unallocated > 0) assumptions.push(`${m(unallocated)} of the ${m(estimate)} one-time cost estimate is not yet broken into cost lines; it is kept in the uses as "Unallocated estimate" with no payer agreed.`);
  if (untaggedLines.length) assumptions.push(`${untaggedLines.length} line${untaggedLines.length === 1 ? ' has' : 's have'} no payer agreed; treated as shared.`);
  assumptions.push('Seller-side funding = SPA seller contribution and escrow / holdback; everything else is buyer-side. Pipeline is not counted as secured.');

  const credit = Math.round(tsaRunRate * GAP_RULES.avoidedTsaMonths * GAP_RULES.avoidedCreditShare);

  const scenario = (key: GapScenarioKey): GapScenario => {
    const def = GAP_SCENARIOS.find((s) => s.key === key)!;
    const evidence: GapEvidence[] = [];
    let seller = 0;
    for (const c of items) {
      const a = n(c.amount);
      const k = kindOf(c);
      const u = usageOf(c);
      const uu = u ?? GAP_RULES.defaultUsagePct;
      const uLabel = `buyer use ${uu}%${u == null ? ' (assumed)' : ''}`;
      let f: number; let rule: string;
      if (k === 'Seller') { f = 1; rule = 'Tagged Seller: seller pays all'; }
      else if (k === 'Buyer') { f = 0; rule = 'Tagged Buyer: buyer pays all'; }
      else {
        const what = k === 'Shared' ? 'Shared' : 'No payer agreed';
        if (key === 'beneficiary') { f = uu >= 50 ? 0 : 1; rule = `${what}, ${uLabel}: ${uu >= 50 ? 'buyer' : 'seller'} is the main user and pays all`; }
        else if (key === 'even') { f = 0.5; rule = `${what}: split 50 / 50`; }
        else { f = (100 - uu) / 100; rule = `${what}, ${uLabel}: seller pays ${100 - uu}%`; }
      }
      const s = Math.round(a * f);
      seller += s;
      const un = c.cost_id === UNALLOC;
      evidence.push({ cost_id: un ? undefined : c.cost_id, label: un ? `Unallocated estimate (${m(estimate)} estimate minus ${m(usesFromLines)} in cost lines)` : `${c.category}${c.description ? `: ${c.description}` : ''}`, payer: un ? null : c.payer ?? null, amount: a, rule, seller: s, buyer: a - s });
    }
    const notes: string[] = [];
    if (key === 'avoided') {
      const cr = Math.min(seller, credit);
      if (cr > 0) {
        seller -= cr;
        evidence.push({ label: 'Avoided-cost credit', amount: cr, rule: `${GAP_RULES.avoidedTsaMonths} TSA months avoided × ${m(tsaRunRate)}/month × ${GAP_RULES.avoidedCreditShare * 100}%: moved from seller to buyer`, seller: -cr, buyer: cr });
      } else notes.push('No client TSA run-rate is recorded, so there is no avoided-cost credit; the result equals usage-based.');
    }
    const sellerBeforeCap = seller;
    let capExcess = 0;
    if (cap != null && seller > cap) {
      capExcess = seller - cap;
      seller = cap;
      evidence.push({ label: `SPA seller cap${clause ? ` (${clause})` : ''}`, amount: capExcess, rule: `Seller pays at most ${m(cap)}: the excess moves to the buyer unless renegotiated`, seller: -capExcess, buyer: capExcess });
      notes.push(`The seller share is ${m(capExcess)} above the SPA cap${clause ? ` (${clause})` : ''}; that part falls to the buyer unless the cap is renegotiated or released from escrow.`);
    }
    const buyer = uses - seller;
    const sellerGap = Math.round(clamp(seller - securedSeller, 0, gap));
    const buyerGap = gap - sellerGap;
    if (securedSeller > seller) notes.push(`The seller has already committed ${m(securedSeller)}, more than its ${m(seller)} share on this basis, so the buyer funds the whole gap.`);
    return { key, name: def.name, basis: def.basis, sellerShare: seller, buyerShare: buyer, sellerBeforeCap, capExcess, sellerGap, buyerGap, evidence, notes };
  };
  const scenarios = GAP_SCENARIOS.map((s) => scenario(s.key));

  // ---- recommendation (rules) ----
  let recommendation: GapAnalysis['recommendation'] = null;
  const taggedShare = pctOf(mixRaw.seller + mixRaw.buyer, uses);
  const sharedShare = pctOf(mixRaw.shared + mixRaw.untagged, uses);
  const sharedValue = sharedLines.reduce((s, c) => s + n(c.amount), 0);
  const usageRecordedShare = pctOf(sharedLines.filter((c) => usageOf(c) != null).reduce((s, c) => s + n(c.amount), 0), sharedValue);
  if (gap > 0) {
    const reasons: string[] = [];
    let key: GapScenarioKey;
    if (taggedShare >= GAP_RULES.taggedForBeneficiary) {
      key = 'beneficiary';
      reasons.push(`${Math.round(taggedShare * 100)}% of the cost (${m(mixRaw.seller + mixRaw.buyer)}) is already tagged to the side that benefits, so this basis needs the least negotiation.`);
      reasons.push(`Only ${sharedLines.length} shared or untagged line${sharedLines.length === 1 ? '' : 's'} (${m(mixRaw.shared + mixRaw.untagged)}) need a decision.`);
    } else if (sharedShare >= GAP_RULES.sharedForUsage && usageRecordedShare >= GAP_RULES.usageRecordedShare) {
      key = 'usage';
      reasons.push(`${Math.round(sharedShare * 100)}% of the cost (${m(mixRaw.shared + mixRaw.untagged)}) sits on shared or untagged lines; splitting them by actual use is the easiest basis to defend.`);
      reasons.push(noUsage.length ? `Usage % is recorded on ${sharedLines.length - noUsage.length} of ${sharedLines.length} shared lines (${Math.round(usageRecordedShare * 100)}% of their value); confirm the rest with the client.` : `Usage % is recorded on all ${sharedLines.length} shared lines.`);
    } else if (credit > 0) {
      key = 'avoided';
      reasons.push(`${Math.round(sharedShare * 100)}% of the cost is shared but usage is recorded for only ${Math.round(usageRecordedShare * 100)}% of it, so a usage split is hard to defend yet.`);
      reasons.push(`The buyer pays a TSA run-rate of ${m(tsaRunRate)}/month; finishing separation faster saves it real money, which supports crediting the seller ${m(Math.min(credit, scenarios.find((s) => s.key === 'usage')!.sellerShare))}.`);
    } else {
      key = 'even';
      reasons.push(`${Math.round(sharedShare * 100)}% of the cost is shared, usage is recorded for only ${Math.round(usageRecordedShare * 100)}% of it, and no TSA run-rate supports a credit, so a 50 / 50 split of the shared lines is the simplest fair basis.`);
    }
    const rec = scenarios.find((s) => s.key === key)!;
    reasons.push(`Seller ${m(rec.sellerShare)} / buyer ${m(rec.buyerShare)}: of the ${m(gap)} gap, the seller still funds ${m(rec.sellerGap)} and the buyer ${m(rec.buyerGap)}.`);
    if (rec.capExcess > 0) reasons.push(`The seller share hits the SPA cap${clause ? ` (${clause})` : ''}; ${m(rec.capExcess)} above the cap needs an escrow / holdback negotiation or buyer funding.`);
    recommendation = { key, name: rec.name, reasons };
  }

  // ---- routes (from the playbook) ----
  const play = (type: string) => FUNDING_PLAYBOOK.find((p) => p.type === type)!;
  const routes: GapRoute[] = [];
  const rec = recommendation ? scenarios.find((s) => s.key === recommendation!.key)! : null;
  if (rec) {
    const buyerStill = Math.max(0, rec.buyerGap - pipelineBuyer);
    const sellerStill = Math.max(0, rec.sellerGap - pipelineSeller);
    const add = (type: string, funder: 'Buyer' | 'Seller', amount: number, why: string) => { if (amount > 0) routes.push({ type, funder, amount: Math.round(amount), why, terms: play(type).terms, watch: play(type).watch }); };
    if (rec.buyerGap > 0) {
      if (buyerStill > 0) {
        const short = buyerStill <= Math.max(3000000, uses * 0.25);
        add(short ? 'Bridge loan' : 'Term loan', 'Buyer', buyerStill,
          `${short ? 'Short' : 'Large'} buyer gap: ${m(rec.buyerGap)} to fund${pipelineBuyer ? `, ${m(pipelineBuyer)} already in the pipeline` : ''}, ${m(buyerStill)} has no source yet.`);
      }
      const pricey = pipeRows.filter((f) => fundingSide(f.source_type) === 'Buyer' && n(f.interest_rate_pct) >= 11 && f.source_type !== 'Bridge loan')
        .sort((a, b) => n(b.amount) - n(a.amount))[0];
      if (buyerStill <= 0 && pricey) add('Bridge loan', 'Buyer', Math.min(rec.buyerGap, n(pricey.amount)),
        `The pipeline covers the buyer's ${m(rec.buyerGap)}, but the largest option (${pricey.provider || pricey.source_type}) is priced at ${pricey.interest_rate_pct}%; ask a bank for a cheaper bridge to compare.`);
      const vendorLines = rec.evidence.filter((e) => e.cost_id && lines.find((c) => c.cost_id === e.cost_id)?.vendor).reduce((s, e) => s + e.buyer, 0);
      const vendorInPipe = pipeRows.some((f) => f.source_type === 'Vendor / deferred payment');
      if (vendorLines > 0 && !vendorInPipe) add('Vendor / deferred payment', 'Buyer', Math.min(rec.buyerGap, vendorLines), `${m(vendorLines)} of buyer-paid cost sits with named vendors; spreading it over the service contract reduces the cash needed at Day-1.`);
    }
    if (rec.sellerGap > 0) {
      const headroom = cap == null ? sellerStill : Math.max(0, cap - securedSeller);
      add('Seller contribution (SPA)', 'Seller', Math.min(sellerStill, headroom), `The seller share is ${m(rec.sellerShare)} and ${m(securedSeller)} is committed; ask the seller to commit the remaining ${m(rec.sellerGap)}${cap != null ? ` within the ${m(cap)} cap` : ''}.`);
    }
    if (rec.capExcess > 0) add('Escrow / holdback release', 'Seller', rec.capExcess, `${m(rec.capExcess)} of the seller share is above the SPA cap${clause ? ` (${clause})` : ''}; negotiate a holdback release tied to the TSA exit milestones.`);
  }

  // ---- next steps ----
  const nextSteps: GapNextStep[] = [];
  if (rec) {
    nextSteps.push({ text: `Take the ${rec.name.toLowerCase()} split (seller ${m(rec.sellerShare)} / buyer ${m(rec.buyerShare)}) to the control board and record the agreed basis on each cost line.`, owner: partner, role: 'Partner' });
    if (unallocated > 0) nextSteps.push({ text: `Break the remaining ${m(unallocated)} of the estimate into cost lines with who pays.`, owner: manager, role: 'Manager' });
    if (untaggedLines.length) nextSteps.push({ text: `Agree who pays on ${untaggedLines.length} untagged cost line${untaggedLines.length === 1 ? '' : 's'} (${m(mixRaw.untagged)}).`, owner: manager, role: 'Manager' });
    if (noUsage.length) nextSteps.push({ text: `Confirm buyer usage % with the client on ${noUsage.length} shared line${noUsage.length === 1 ? '' : 's'} (50% assumed today).`, owner: manager, role: 'Manager' });
    if (rec.capExcess > 0) nextSteps.push({ text: `Raise the SPA cap${clause ? ` (${clause})` : ''} with the seller: ${m(rec.capExcess)} of the seller share is above it.`, owner: partner, role: 'Partner' });
    if (pipeRows.length) nextSteps.push({ text: `Move the ${pipeRows.length} pipeline option${pipeRows.length === 1 ? '' : 's'} (${m(pipeline)}) to a term sheet or commitment, comparing price.`, owner: manager, role: 'Manager' });
    const bankRoute = routes.find((x) => x.type === 'Bridge loan' || x.type === 'Term loan');
    if (bankRoute) nextSteps.push({ text: `Run the independence check, then ask a bank for about ${m(bankRoute.amount)} (${bankRoute.type.toLowerCase()}; Funding options, Ask a bank).`, owner: partner, role: 'Partner' });
    if (nextSteps.length < 3) nextSteps.push({ text: 'Update cost lines as vendor quotes firm up; the split recalculates automatically.', owner: manager, role: 'Manager' });
  } else {
    nextSteps.push({ text: 'Keep cost lines current as quotes firm up; any overrun reopens a gap.', owner: manager, role: 'Manager' });
    nextSteps.push({ text: 'Confirm the agreed sharing basis is written into the control-board minutes.', owner: partner, role: 'Partner' });
    if (pipeRows.length) nextSteps.push({ text: `Decide whether the ${m(pipeline)} pipeline options are still needed; release or keep them as headroom.`, owner: manager, role: 'Manager' });
  }

  // ---- what to watch ----
  const watch: string[] = [];
  const planned = lines.filter((c) => c.status === 'Planned').reduce((s, c) => s + n(c.amount), 0);
  if (planned) watch.push(`${m(planned)} of cost is still Planned (not committed); quotes can move.`);
  const contingency = lines.filter((c) => c.category === 'Contingency').reduce((s, c) => s + n(c.amount), 0);
  if (contingency) watch.push(`Contingency held: ${m(contingency)} (${Math.round(pctOf(contingency, uses) * 100)}% of the cost).`);
  if (tsaRunRate) watch.push(`Each month of TSA extension costs the buyer about ${m(tsaRunRate)} plus the extension uplift.`);
  if (cap != null) { const top = Math.max(...scenarios.map((s) => s.sellerBeforeCap)); watch.push(top > cap ? `On some bases the seller share exceeds the SPA cap of ${m(cap)}.` : `Seller share stays within the SPA cap of ${m(cap)} on every basis.`); }
  else watch.push('No SPA seller cap is recorded; check the sale agreement.');
  if (recordedGap && Math.abs(recordedGap - gap) >= 1000) watch.push(`The gap recorded on the project (${m(recordedGap)}) differs from the gap computed from cost and funding lines (${m(gap)}).`);

  const headline = gap > 0
    ? `Funding gap ${m(gap)}: ${m(secured)} of ${m(uses)} secured${pipeline ? `, ${m(pipeline)} in the pipeline` : ''}.`
    : `Fully funded: ${m(secured)} secured against ${m(uses)} of one-time cost.`;

  return { ...base, state: gap > 0 ? 'gap' : 'funded', uses, secured, gap, gapAfterPipeline, scenarios, recommendation, routes, nextSteps: nextSteps.slice(0, 5), watch, assumptions, headline };
}

/** Offline (deterministic) narrative built only from the computed figures. */
export function offlineGapSummary(a: GapAnalysis, codeName: string): string {
  const m = (v: number) => fmtMoney(v, a.currency);
  if (a.state === 'no-data') return `${codeName} has no finance data yet, so the funding need cannot be assessed. Set up finance with a one-time cost estimate and cost lines.`;
  if (a.state === 'estimate-only') return `${codeName} has a one-time cost estimate of ${m(a.uses)} but no cost lines yet. ${a.gap ? `The estimated funding gap is ${m(a.gap)}.` : ''} Break the estimate into cost lines with who pays to compare the split scenarios.`.replace(/\s+/g, ' ').trim();
  if (a.state === 'funded') return `${codeName} is fully funded: ${m(a.secured)} is secured against ${m(a.uses)} of one-time separation cost${a.pipeline ? `, with a further ${m(a.pipeline)} in the pipeline as headroom` : ''}. ${a.watch[0] ?? ''}`.trim();
  const rec = a.scenarios.find((s) => s.key === a.recommendation?.key);
  const parts = [
    `${codeName} has a funding gap of ${m(a.gap)}: ${m(a.secured)} of the ${m(a.uses)} one-time separation cost is secured${a.pipeline ? ` and ${m(a.pipeline)} is in the pipeline, leaving ${m(a.gapAfterPipeline)} with no source yet` : ''}.`,
    rec ? `The recommended basis is ${rec.name.toLowerCase()}: the seller carries ${m(rec.sellerShare)} and the buyer ${m(rec.buyerShare)}, so the seller still funds ${m(rec.sellerGap)} of the gap and the buyer ${m(rec.buyerGap)}.` : '',
    rec && rec.capExcess > 0 ? `The SPA cap moves ${m(rec.capExcess)} from the seller to the buyer on this basis.` : '',
    a.routes[0] ? `First route to explore: ${a.routes[0].type.toLowerCase()} for ${m(a.routes[0].amount)} (${a.routes[0].funder.toLowerCase()} side).` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

/** Every amount the AI narrative may quote (used to reject an AI text that invents numbers). */
export function allowedFigures(a: GapAnalysis): number[] {
  const out = [a.uses, a.secured, a.securedSeller, a.securedBuyer, a.pipeline, a.gap, a.gapAfterPipeline, a.recordedGap, a.tsaRunRate, a.oneTimeEstimate, a.spa.cap ?? 0, a.mix.seller, a.mix.buyer, a.mix.shared, a.mix.untagged];
  for (const s of a.scenarios) out.push(s.sellerShare, s.buyerShare, s.sellerGap, s.buyerGap, s.capExcess, s.sellerBeforeCap);
  for (const r of a.routes) out.push(r.amount);
  return out.filter((x) => x > 0);
}

/** True when every money amount in the text is within 1.5% of a computed figure. */
export function usesOnlyFigures(text: string, allowed: number[]): boolean {
  const re = /(?:US\$|USD|INR|EUR|GBP|\$|€|£|₹)\s?(\d[\d,]*(?:\.\d+)?)\s?(million|mn|m|k|thousand|bn|b)?\b/gi;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(text))) {
    let v = Number(mt[1].replace(/,/g, ''));
    const unit = (mt[2] || '').toLowerCase();
    if (unit === 'm' || unit === 'mn' || unit === 'million') v *= 1e6; else if (unit === 'k' || unit === 'thousand') v *= 1e3; else if (unit === 'b' || unit === 'bn') v *= 1e9;
    if (!allowed.some((x) => Math.abs(x - v) <= Math.max(1000, x * 0.015))) return false;
  }
  return true;
}
