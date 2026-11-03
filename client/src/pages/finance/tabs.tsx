/** Finance workspace tabs. All numbers come from GET /api/projects/:id/finance (already permission-checked). */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Pencil, Plus, Landmark } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FinanceWorkspace } from '@shared/types';
import { DEMO_FUNDERS, FUNDING_PLAYBOOK } from '@shared/finance';
import { patch } from '../../lib/api';
import { useToast } from '../../components/toast';
import { Button, Pill, Select } from '../../components/ui';
import { date, num } from '../../lib/format';
import { money } from './fmt';
import { PERSONA_LABEL } from '../../hooks/useUsers';
import { CHART, legendText } from '../dashboard/widgets';
import type { EditTarget } from './FinancePage';
import { GapOverviewCard, SetupBanner } from './GapTab';
import { AskABank } from './BankOutreach';

type W = { w: FinanceWorkspace };
export const cur = (w: FinanceWorkspace) => w.project.currency || 'USD';
/** "Not set" instead of a misleading $0 when a figure was never entered. */
const NotSet = () => <span className="text-[16px] font-medium text-ink-muted">Not set</span>;
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const days = (a?: string | null, b?: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000)) : null);

export function Tile({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'amber' | 'rose' | 'green'; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={clsx('rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-card', onClick && 'transition-colors hover:border-ink-muted')}>
      <div className="text-[12px] text-ink-muted">{label}</div>
      <div className={clsx('num mt-0.5 text-[20px] font-semibold leading-tight', tone === 'amber' && 'text-amber', tone === 'rose' && 'text-rose', tone === 'green' && 'text-green')}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-ink-soft">{sub}</div>}
    </Comp>
  );
}

export function Card({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-xl border border-line bg-surface shadow-card', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-[14px] font-semibold">{title}</h2>{right}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function Share({ value, max, color = 'bg-blue' }: { value: number; max: number; color?: string }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <span className="block h-1.5 w-full overflow-hidden rounded-full bg-line/70" aria-hidden><span className={clsx('block h-full rounded-full', color)} style={{ width: `${p}%` }} /></span>;
}

/** Secured | pipeline | unfunded as one bar, with a text legend (meaning never depends on colour alone). */
function FundingMeter({ w }: W) {
  const su = w.sourcesUses;
  const total = Math.max(su.usesTotal, su.secured + su.pipeline, 1);
  const pipe = Math.min(su.pipeline, su.unfunded);
  const rest = Math.max(0, su.unfunded - pipe);
  const parts = [
    { k: 'Secured (committed or drawn)', v: Math.min(su.secured, total), c: 'bg-green' },
    { k: 'In the pipeline', v: pipe, c: 'bg-amber' },
    { k: 'Unfunded, no source yet', v: rest, c: 'bg-rose' },
  ];
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-line/60" role="img" aria-label={parts.map((x) => `${x.k} ${money(x.v, cur(w))}`).join(', ')}>
        {parts.map((x) => <span key={x.k} className={x.c} style={{ width: `${(x.v / total) * 100}%` }} />)}
      </div>
      <dl className="mt-2.5 grid gap-1.5 text-[12.5px]">
        {parts.map((x) => (
          <div key={x.k} className="flex items-center gap-1.5"><span className={clsx('h-2.5 w-2.5 rounded-sm', x.c)} aria-hidden /><dt className="text-ink-soft">{x.k}</dt><dd className="num ml-auto font-medium">{money(x.v, cur(w))}</dd></div>
        ))}
      </dl>
      <p className="mt-2 text-[12.5px] text-ink-muted">One-time separation cost (uses) {money(su.usesTotal, cur(w))}. {su.recordedGap ? `Funding gap recorded on the project: ${money(su.recordedGap, cur(w))}.` : ''}</p>
    </div>
  );
}

// ------------------------------------------------------------------ Overview
export function OverviewTab({ w, go, onSetup }: W & { go: (t: any, extra?: Record<string, string>) => void; onSetup: () => void }) {
  const c = cur(w);
  const st = w.setup;
  const b = w.billing;
  const su = w.sourcesUses;
  const stageCost = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of w.costItems) if (x.stage_id) m.set(x.stage_id, (m.get(x.stage_id) || 0) + (x.amount || 0));
    return m;
  }, [w.costItems]);
  const stageBilled = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of w.invoices) if (i.stage_id && i.status !== 'Draft') m.set(i.stage_id, (m.get(i.stage_id) || 0) + (i.amount || 0));
    return m;
  }, [w.invoices]);
  const chartRows = w.effort.byStage.map((s) => ({ name: s.label, billed: stageBilled.get(s.key) || 0, cost: stageCost.get(s.key) || 0 }));
  const entries = [...w.entries].sort((a, b2) => a.period_month.localeCompare(b2.period_month));

  return (
    <div className="space-y-4">
      {st.isEmpty && <SetupBanner w={w} onSetup={onSetup} />}
      <GapOverviewCard w={w} go={go} onSetup={onSetup} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Fee budget" value={st.feeBudgetSet ? money(b.budget, c) : <NotSet />} sub={st.feeBudgetSet ? `${pctOf(b.invoiced, b.budget)}% invoiced so far` : 'No PwC fee budget recorded'} onClick={() => go('billing')} />
        <Tile label="Invoiced to the client" value={st.hasInvoices ? money(b.invoiced, c) : <NotSet />} sub={st.hasInvoices ? `${money(b.paid, c)} paid` : 'No invoices yet'} onClick={() => go('billing')} />
        <Tile label="Outstanding" value={st.hasInvoices ? money(b.outstanding, c) : <NotSet />} tone={b.overdue ? 'rose' : undefined} sub={!st.hasInvoices ? 'No invoices yet' : b.overdue ? `${money(b.overdue, c)} overdue` : 'Nothing overdue'} onClick={() => go('billing')} />
        <Tile label="Planned effort" value={w.totals.planned_hours ? `${num(w.totals.planned_hours)} h` : <NotSet />} sub={w.totals.planned_hours ? `${money(w.totals.effort_value, c)} at standard rates` : 'No task hours planned yet'} onClick={() => go('effort')} />
        <Tile label={st.hasCostLines ? 'One-time separation cost' : 'One-time cost (estimate)'} value={st.hasCostLines ? money(su.usesTotal, c) : st.oneTimeEstimateSet ? money(w.totals.one_time_cost_estimate, c) : <NotSet />}
          sub={st.hasCostLines ? `${w.costItems.length} cost lines` : st.oneTimeEstimateSet ? 'From the project record; no cost lines yet' : 'No estimate or cost lines'} onClick={() => go('funding')} />
        <Tile label="Funding secured" value={st.hasFunding || w.gap.state === 'estimate-only' ? money(w.gap.secured, c) : <NotSet />} tone={st.hasFunding ? 'green' : undefined}
          sub={w.gap.uses ? `${pctOf(w.gap.secured, w.gap.uses)}% of the cost` : 'No funding lines'} onClick={() => go('funding')} />
        <Tile label="Unfunded" value={w.gap.state === 'no-data' ? <NotSet /> : money(w.gap.gap, c)} tone={w.gap.state === 'no-data' ? undefined : w.gap.gap ? 'amber' : 'green'}
          sub={w.gap.state === 'no-data' ? 'Set up finance first' : w.gap.pipeline ? `${money(w.gap.pipeline, c)} in the pipeline (not counted)` : 'No options in the pipeline'} onClick={() => go('gap')} />
        <Tile label="Client TSA run-rate" value={st.tsaRunRateSet ? `${money(w.totals.tsa_run_rate, c)}/mo` : <NotSet />}
          sub={w.totals.tsa_services_active ? `${w.totals.tsa_services_active} active TSA services` : st.tsaRunRateSet ? 'From the project record; no TSA services itemised' : 'No TSA recorded'} onClick={() => go('tsa')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Monthly fees and client TSA cost">
          {entries.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={entries} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.line} />
                  <XAxis dataKey="period_month" tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => money(v, c)} width={64} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => money(v, c, false)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
                  <Bar dataKey="fee_planned" name="Fees planned" fill="#C9CED6" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="fee_actual" name="Fees actual" fill={CHART.brand} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Line dataKey="tsa_cost" name="Client TSA cost" stroke={CHART.blue} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-[13px] text-ink-muted">No monthly figures recorded yet.</p>}
        </Card>
        <Card title="How the separation is funded" right={<button className="text-[12.5px] font-medium text-link hover:underline" onClick={() => go('funding')}>Sources &amp; uses</button>}>
          <FundingMeter w={w} />
          {su.byPayer.length > 0 && (
            <div className="mt-3 border-t border-line pt-2.5">
              <div className="mb-1.5 text-[12.5px] font-medium">Who pays the cost</div>
              <div className="flex flex-wrap gap-2">
                {su.byPayer.map((x) => <span key={x.payer} className="rounded-md bg-sunken px-2 py-1 text-[12.5px]"><span className="text-ink-muted">{x.payer}</span> <span className="num font-medium">{money(x.total, c)}</span></span>)}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Where the time and money go, stage by stage">
        <div className="mb-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART.line} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tickFormatter={(v) => money(v, c)} width={64} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => money(v, c, false)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
              <Bar dataKey="billed" name="PwC fees invoiced" fill={CHART.brand} radius={[3, 3, 0, 0]} maxBarSize={30} />
              <Bar dataKey="cost" name="One-time separation cost (client)" fill={CHART.amber} radius={[3, 3, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr>
              <th className="th">Stage</th><th className="th">Dates</th><th className="th text-right">Days</th><th className="th text-right">Tasks</th>
              <th className="th">Hours done / planned</th><th className="th text-right">Effort value</th><th className="th text-right">Invoiced</th><th className="th text-right">Separation cost</th>
            </tr></thead>
            <tbody>
              {w.effort.byStage.map((s) => (
                <tr key={s.key}>
                  <td className="td font-medium">{s.label}</td>
                  <td className="td num whitespace-nowrap">{s.start ? `${date(s.start, false)} – ${date(s.end, false)}` : '–'}</td>
                  <td className="td num text-right">{days(s.start, s.end) ?? '–'}</td>
                  <td className="td num text-right">{s.tasks}</td>
                  <td className="td min-w-[160px]"><div className="num mb-1">{num(s.doneHours)} / {num(s.hours)} h</div><Share value={s.doneHours} max={s.hours} /></td>
                  <td className="td num text-right">{money(s.value, c)}</td>
                  <td className="td num text-right">{stageBilled.has(s.key) ? money(stageBilled.get(s.key), c) : <span className="text-ink-muted">–</span>}</td>
                  <td className="td num text-right">{stageCost.has(s.key) ? money(stageCost.get(s.key), c) : <span className="text-ink-muted" title="No cost lines linked to this stage">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Time & fees
export function EffortTab({ w }: W) {
  const c = cur(w);
  const [by, setBy] = useState<'person' | 'activity'>('person');
  const people = w.effort.byPerson;
  const acts = w.effort.byActivity;
  const maxP = Math.max(...people.map((p) => p.value), 1);
  const maxA = Math.max(...acts.map((a) => a.value), 1);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[12.5px] text-ink-soft shadow-card">
        <Info size={15} className="mt-[1px] shrink-0 text-blue" />
        <div className="min-w-0 flex-1">
          Effort is the hours planned on each tracker task, valued at a standard rate for the person's role. <b>Billed</b> is what that person invoiced to the client.
          Fees are usually higher than tracked effort: they also cover partner time, client meetings and work that is not logged as tasks.
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {w.rateCard.map((r) => <span key={r.persona} className="rounded bg-sunken px-1.5 py-[1px]">{r.label}: <span className="num font-medium text-ink">{money(r.rate, 'USD', false)}/h</span></span>)}
            <span className="text-ink-muted">(demo rates, not real PwC rates)</span>
          </div>
        </div>
        <div className="flex rounded-md border border-line-strong p-0.5" role="radiogroup" aria-label="Group effort by">
          {(['person', 'activity'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={by === k} onClick={() => setBy(k)}
              className={clsx('rounded px-2.5 py-1 text-[12.5px] font-medium', by === k ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sunken')}>By {k}</button>
          ))}
        </div>
      </div>
      {by === 'person' ? (
        <Card title={`Who did the work and who billed it (${people.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr><th className="th">Person</th><th className="th">Role</th><th className="th text-right">Tasks</th><th className="th text-right">Hours planned</th><th className="th text-right">Hours done</th><th className="th">Effort value</th><th className="th text-right">Billed to client</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.key}>
                    <td className="td font-medium">{p.label}</td>
                    <td className="td text-ink-soft">{p.persona ? PERSONA_LABEL[p.persona] ?? p.persona : '–'}</td>
                    <td className="td num text-right">{p.tasks}</td>
                    <td className="td num text-right">{num(p.hours)}</td>
                    <td className="td num text-right">{num(p.doneHours)}</td>
                    <td className="td min-w-[160px]"><div className="num mb-1">{money(p.value, c)}</div><Share value={p.value} max={maxP} /></td>
                    <td className="td num text-right">{p.billedBy ? money(p.billedBy, c) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title={`Effort by activity (${acts.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr><th className="th">Activity</th><th className="th">Stage</th><th className="th text-right">People</th><th className="th text-right">Tasks</th><th className="th text-right">Hours (done / plan)</th><th className="th">Effort value</th></tr></thead>
              <tbody>
                {acts.map((a) => (
                  <tr key={a.key}>
                    <td className="td font-medium">{a.label}</td>
                    <td className="td text-ink-soft">{a.sub}</td>
                    <td className="td num text-right">{a.people}</td>
                    <td className="td num text-right">{a.tasks}</td>
                    <td className="td num text-right">{num(a.doneHours)} / {num(a.hours)}</td>
                    <td className="td min-w-[160px]"><div className="num mb-1">{money(a.value, c)}</div><Share value={a.value} max={maxA} color="bg-brand" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Billing
export function BillingTab({ w, onEdit, onChanged }: W & { onEdit: (t: EditTarget) => void; onChanged: () => void }) {
  const c = cur(w);
  const toast = useToast();
  const [status, setStatus] = useState('');
  const b = w.billing;
  const rows = w.invoices.filter((i) => !status || i.status === status);
  const byBiller = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of w.invoices) if (i.status !== 'Draft') m.set(i.billed_by_name || '–', (m.get(i.billed_by_name || '–') || 0) + (i.amount || 0));
    return [...m.entries()].sort((a, x) => x[1] - a[1]);
  }, [w.invoices]);
  const markPaid = async (id: string) => {
    try { await patch(`/projects/${w.project.project_id}/finance/invoices/${id}`, { status: 'Paid', paid_date: new Date().toISOString().slice(0, 10) }); toast.success('Marked as paid'); onChanged(); }
    catch (e) { toast.error(e); }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Fee budget" value={money(b.budget, c)} />
        <Tile label="Invoiced" value={money(b.invoiced, c)} sub={`${pctOf(b.invoiced, b.budget)}% of budget`} />
        <Tile label="Paid" value={money(b.paid, c)} tone="green" />
        <Tile label="Outstanding" value={money(b.outstanding, c)} />
        <Tile label="Overdue" value={money(b.overdue, c)} tone={b.overdue ? 'rose' : undefined} />
        <Tile label="Worked, not yet billed" value={money(b.wip, c)} sub={w.project.status === 'Closed' ? 'Project closed: final billing done' : 'Fees recorded minus invoiced'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card title={`Invoices (${rows.length})`} right={(
          <div className="flex items-center gap-2">
            <Select className="h-8 w-36 text-[12.5px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter invoices by status">
              <option value="">All statuses</option>{['Draft', 'Sent', 'Overdue', 'Paid'].map((s) => <option key={s}>{s}</option>)}
            </Select>
            {w.perms.canEdit && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => onEdit({ kind: 'invoices', initial: { status: 'Draft', billed_to: w.project.client_alias, period_month: new Date().toISOString().slice(0, 7) } })}>New invoice</Button>}
          </div>
        )}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr><th className="th">Invoice</th><th className="th">Period</th><th className="th">Stage</th><th className="th">Billed by</th><th className="th text-right">Amount</th><th className="th">Issued</th><th className="th">Due</th><th className="th">Status</th>{w.perms.canEdit && <th className="th"><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.invoice_id}>
                    <td className="td"><div className="font-medium">{i.invoice_no}</div>{i.description && <div className="text-[11.5px] text-ink-muted">{i.description}</div>}</td>
                    <td className="td num">{i.period_month || '–'}</td>
                    <td className="td text-ink-soft">{i.stage_name || '–'}</td>
                    <td className="td">{i.billed_by_name || '–'}</td>
                    <td className="td num text-right font-medium">{money(i.amount, c, false)}</td>
                    <td className="td num">{date(i.issued_date)}</td>
                    <td className="td num">{date(i.due_date)}</td>
                    <td className="td"><Pill>{i.status}</Pill></td>
                    {w.perms.canEdit && (
                      <td className="td whitespace-nowrap text-right">
                        {(i.status === 'Sent' || i.status === 'Overdue') && <Button size="sm" variant="ghost" icon={<CheckCircle2 size={14} />} onClick={() => markPaid(i.invoice_id)}>Paid</Button>}
                        <Button size="sm" variant="ghost" icon={<Pencil size={14} />} aria-label={`Edit invoice ${i.invoice_no}`} onClick={() => onEdit({ kind: 'invoices', row: i })}>Edit</Button>
                      </td>
                    )}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={9} className="td text-ink-muted">No invoices{status ? ` with status ${status}` : ''}.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Who billed what">
          <ul className="space-y-2">
            {byBiller.map(([name, amt]) => (
              <li key={name} className="text-[12.5px]">
                <div className="flex justify-between"><span>{name}</span><span className="num font-medium">{money(amt, c)}</span></div>
                <Share value={amt} max={byBiller[0]?.[1] || 1} color="bg-brand" />
              </li>
            ))}
            {!byBiller.length && <li className="text-[12.5px] text-ink-muted">Nothing invoiced yet.</li>}
          </ul>
          <p className="mt-3 text-[11.5px] text-ink-muted">Invoices are raised by the Engagement Partner; drafts are prepared by the Manager.</p>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Costs & funding (sources & uses)
export function FundingTab({ w, onEdit, focusCost }: W & { onEdit: (t: EditTarget) => void; focusCost?: string | null }) {
  const c = cur(w);
  useEffect(() => {
    if (!focusCost) return;
    const el = document.getElementById(`cost-${focusCost}`);
    el?.scrollIntoView({ block: 'center' });
    (el?.querySelector('td') as HTMLElement | null)?.focus?.();
  }, [focusCost]);
  const su = w.sourcesUses;
  const edit = w.perms.canEdit;
  return (
    <div className="space-y-4">
      <Card title="Sources and uses at a glance"><FundingMeter w={w} /></Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`Uses: one-time separation cost (${money(su.usesTotal, c)})`}>
          <table className="w-full text-[12.5px]">
            <thead><tr><th className="th">Category</th><th className="th text-right">Planned</th><th className="th text-right">Committed</th><th className="th text-right">Spent</th><th className="th text-right">Total</th></tr></thead>
            <tbody>
              {su.uses.map((u) => (
                <tr key={u.category}><td className="td font-medium">{u.category}</td><td className="td num text-right">{money(u.planned, c)}</td><td className="td num text-right">{money(u.committed, c)}</td><td className="td num text-right">{money(u.spent, c)}</td><td className="td num text-right font-medium">{money(u.total, c)}</td></tr>
              ))}
              {!su.uses.length && <tr><td colSpan={5} className="td text-ink-muted">No cost lines yet.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title={`Sources: funding (${w.fundingSources.length})`} right={edit && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => onEdit({ kind: 'funding', initial: { status: 'Identified' } })}>Add funding</Button>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr><th className="th">Source</th><th className="th text-right">Amount</th><th className="th">Terms</th><th className="th">Status</th>{edit && <th className="th"><span className="sr-only">Edit</span></th>}</tr></thead>
              <tbody>
                {w.fundingSources.map((f) => (
                  <tr key={f.funding_id}>
                    <td className="td"><div className="font-medium">{f.source_type}</div><div className="text-[11.5px] text-ink-muted">{f.provider || '–'}{f.owner_name ? ` · tracked by ${f.owner_name}` : ''}</div></td>
                    <td className="td num text-right font-medium">{money(f.amount, c)}</td>
                    <td className="td num text-ink-soft">{[f.interest_rate_pct != null && `${f.interest_rate_pct}%`, f.tenor_months && `${f.tenor_months} mo`, f.expected_date && date(f.expected_date)].filter(Boolean).join(' · ') || '–'}</td>
                    <td className="td"><Pill>{f.status}</Pill></td>
                    {edit && <td className="td text-right"><Button size="sm" variant="ghost" icon={<Pencil size={14} />} aria-label={`Edit ${f.source_type}`} onClick={() => onEdit({ kind: 'funding', row: f })}>Edit</Button></td>}
                  </tr>
                ))}
                {!w.fundingSources.length && <tr><td colSpan={5} className="td text-ink-muted">No funding recorded. See Funding options for the usual routes.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card title={`Cost lines (${w.costItems.length})`} right={edit && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => onEdit({ kind: 'costs', initial: { status: 'Planned' } })}>Add cost line</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr><th className="th">Category</th><th className="th">Description</th><th className="th">Stage</th><th className="th">Who pays</th><th className="th text-right">Buyer use</th><th className="th">Vendor</th><th className="th text-right">Amount</th><th className="th">Status</th>{edit && <th className="th"><span className="sr-only">Edit</span></th>}</tr></thead>
            <tbody>
              {w.costItems.map((x) => (
                <tr key={x.cost_id} id={`cost-${x.cost_id}`} className={clsx(focusCost === x.cost_id && 'bg-amber-soft/60 outline outline-2 outline-amber/60')}>
                  <td className="td font-medium" tabIndex={focusCost === x.cost_id ? -1 : undefined}>{x.category}</td>
                  <td className="td text-ink-soft">{x.description || '–'}</td>
                  <td className="td">{x.stage_name || '–'}</td>
                  <td className="td">{x.payer || <span className="text-amber">Not agreed</span>}</td>
                  <td className="td num text-right">{x.payer === 'Shared' || !x.payer ? (x.buyer_usage_pct != null ? `${x.buyer_usage_pct}%` : <span className="text-ink-muted" title="Not recorded; 50% is assumed in the split scenarios">50%*</span>) : '–'}</td>
                  <td className="td text-ink-soft">{x.vendor || '–'}</td>
                  <td className="td num text-right font-medium">{money(x.amount, c)}</td>
                  <td className="td"><Pill>{x.status}</Pill></td>
                  {edit && <td className="td text-right"><Button size="sm" variant="ghost" icon={<Pencil size={14} />} aria-label={`Edit ${x.category}`} onClick={() => onEdit({ kind: 'costs', row: x })}>Edit</Button></td>}
                </tr>
              ))}
              {!w.costItems.length && <tr><td colSpan={9} className="td text-ink-muted">No cost lines yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Funding options (playbook + demo partners)
export function OptionsTab({ w, onEdit, onChanged }: W & { onEdit: (t: EditTarget) => void; onChanged: () => void }) {
  const c = cur(w);
  const gap = w.sourcesUses.unfunded;
  // What still has no source once the options already in the pipeline are counted (not the full gap).
  const remaining = w.gap.gapAfterPipeline;
  return (
    <div className="space-y-4">
      <div className={clsx('flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px]', gap ? 'border-amber/50 bg-amber-soft/50' : 'border-green/40 bg-green-soft/50')}>
        {gap ? <AlertTriangle size={16} className="mt-[1px] shrink-0 text-amber" /> : <CheckCircle2 size={16} className="mt-[1px] shrink-0 text-green" />}
        <div>
          {gap ? <><b>{money(gap, c)}</b> of the one-time separation cost has no secured funding yet{w.gap.pipeline ? <>; {money(w.gap.pipeline, c)} is in the pipeline, so <b>{money(remaining, c)}</b> still has no source</> : ''}. The routes below are how deal teams usually close the gap.</>
            : <>The one-time separation cost is fully covered by secured funding.</>}
          <div className="mt-1 text-[12.5px] text-ink-soft">
            For visibility only: the app does not apply for, broker or arrange financing. PwC independence rules mean the firm cannot arrange finance for audit clients;
            any approach to a lender goes through the Engagement Partner and Risk &amp; Quality. All partners below are fictional demo names.
          </div>
        </div>
      </div>

      <AskABank w={w} onChanged={onChanged}
        onAddToPlan={(b) => onEdit({ kind: 'funding', initial: { source_type: b.products[0], provider: b.name, status: 'Identified', amount: remaining ? Math.round(remaining / 1000) * 1000 : '', purpose: 'Option to close the funding gap.' } })} />

      <Card title="Other funding partners (not banks)" right={!w.perms.canEdit && <span className="text-[12px] text-ink-muted">Only finance editors can add an option to the plan</span>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {DEMO_FUNDERS.map((f) => (
            <div key={f.name} className="flex flex-col rounded-lg border border-line px-3.5 py-3">
              <div className="flex items-center gap-2"><Landmark size={16} className="text-ink-muted" /><span className="text-[13.5px] font-semibold">{f.name}</span></div>
              <div className="mt-0.5 text-[12px] text-ink-muted">{f.kind}</div>
              <div className="mt-2 flex flex-wrap gap-1">{f.offers.map((o) => <span key={o} className="rounded bg-sunken px-1.5 py-[1px] text-[11.5px]">{o}</span>)}</div>
              <p className="mt-2 flex-1 text-[12.5px] text-ink-soft">{f.typical}</p>
              {w.perms.canEdit && (
                <Button size="sm" className="mt-2.5 self-start" icon={<Plus size={14} />}
                  onClick={() => onEdit({ kind: 'funding', initial: { source_type: f.offers[0], provider: f.name, status: 'Identified', amount: remaining ? Math.round(remaining / 1000) * 1000 : '', purpose: 'Option to close the funding gap.' } })}>
                  Add to funding plan
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="How M&A deal teams usually fund separation cost">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr><th className="th">Route</th><th className="th">Who provides it</th><th className="th">When it fits</th><th className="th">Typical terms</th><th className="th">Watch out for</th></tr></thead>
            <tbody>
              {FUNDING_PLAYBOOK.map((r) => (
                <tr key={r.type}><td className="td font-medium">{r.type}</td><td className="td">{r.who}</td><td className="td text-ink-soft">{r.when}</td><td className="td text-ink-soft">{r.terms}</td><td className="td text-ink-soft">{r.watch}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ TSA
export function TsaTab({ w }: W) {
  const c = cur(w);
  return (
    <Card title={`TSA services (${w.tsaServices.length})`} right={<span className="num text-[12.5px] text-ink-soft">Active run-rate {money(w.totals.tsa_monthly_active, c)}/month · {money(w.totals.tsa_cost_to_date, c)} paid to date</span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr><th className="th">Service</th><th className="th">Provider</th><th className="th text-right">Per month</th><th className="th">Planned exit</th><th className="th text-right">Extension uplift</th><th className="th">Status</th></tr></thead>
          <tbody>
            {w.tsaServices.map((s) => (
              <tr key={s.service_id}>
                <td className="td"><div className="font-medium">{s.name}</div>{s.linked_apps && <div className="text-[11px] text-ink-muted">{s.linked_apps}</div>}</td>
                <td className="td">{s.provider || '–'}</td>
                <td className="td num text-right">{money(s.monthly_fee, c)}</td>
                <td className="td num">{date(s.planned_exit_date)}</td>
                <td className="td num text-right">{s.extension_uplift_pct != null ? `${s.extension_uplift_pct}%` : '–'}</td>
                <td className="td">{s.status ? <Pill>{s.status}</Pill> : '–'}</td>
              </tr>
            ))}
            {!w.tsaServices.length && <tr><td colSpan={6} className="td text-ink-muted">No TSA services recorded for this project.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
