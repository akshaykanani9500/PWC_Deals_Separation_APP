/** Dashboard widget catalogue. Each widget renders from DashboardData. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardData } from '@shared/types';
import { money, pct, num, date, relative, isOverdue } from '../../lib/format';
import { Pill } from '../../components/ui';

export const CHART = {
  ink: '#16191D', soft: '#3D434B', muted: '#5A616B', line: '#D5D9DF', brand: '#B83F04',
  blue: '#2F6BAD', green: '#3B8A5A', amber: '#C98A00', rose: '#C0392B', piku: '#5B3FD0', sand: '#9AA3AE', track: '#E9EBEF',
};
const STATUS_COLORS: Record<string, string> = {
  Planning: CHART.sand, Active: CHART.blue, 'At Risk': CHART.rose, 'On Hold': CHART.amber, Closing: CHART.piku, Closed: CHART.green,
};
const RAG_COLORS: Record<string, string> = { Green: CHART.green, Amber: CHART.amber, Red: CHART.rose };

/** Quick filters a KPI tile can apply to the projects table. */
export type QuickFilter = 'active' | 'risk' | 'overdue' | 'open' | 'blocked' | 'behind';
export const QUICK_LABEL: Record<QuickFilter, string> = {
  active: 'Active projects', risk: 'At-risk projects', overdue: 'Projects with overdue tasks', open: 'Projects with open tasks',
  blocked: 'Projects with blocked tasks', behind: 'Least complete first',
};

export interface WidgetCtx { onFilter: (f: QuickFilter) => void; userName?: string; customizing: boolean }

export interface WidgetDef {
  id: string;
  title: string;
  description: string;
  w: number; h: number; minW?: number; minH?: number;
  finance?: boolean;
  render: (d: DashboardData, users: Map<string, string>, ctx: WidgetCtx) => ReactNode;
}

function Kpi({ value, label, note, tone, onClick, action }: {
  value: ReactNode; label: string; note?: ReactNode; tone?: 'rose' | 'amber' | 'green'; onClick?: () => void; action?: string;
}) {
  const color = tone === 'rose' ? 'text-rose' : tone === 'amber' ? 'text-amber' : tone === 'green' ? 'text-green' : 'text-ink';
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium text-ink-soft">{label}
        {onClick && <ChevronRight size={15} className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-link" aria-hidden />}</span>
      <span className={`num text-[28px] font-semibold leading-none ${color}`}>{value}</span>
      <span className="truncate text-[12px] text-ink-muted group-hover:text-link">{onClick && action ? action : note ?? '\u00a0'}</span>
    </>
  );
  if (!onClick) return <div className="flex h-full flex-col justify-between p-4">{body}</div>;
  return (
    <button type="button" onClick={onClick} title={action} className="group flex h-full w-full flex-col justify-between rounded-xl p-4 text-left transition-colors hover:bg-link-soft/40">
      {body}
    </button>
  );
}

const tooltipStyle = { fontSize: 12, borderRadius: 8, border: `1px solid ${CHART.line}`, boxShadow: '0 8px 24px rgba(0,0,0,.08)' };

export const WIDGETS: WidgetDef[] = [
  { id: 'kpi-active', title: 'Active projects', description: 'Projects that are not closed', w: 2, h: 2, minW: 2, minH: 2,
    render: (d, _u, c) => <Kpi label="Active projects" value={num(d.kpis.activeProjects)} note="Visible to you" action="Show active projects" onClick={c.customizing ? undefined : () => c.onFilter('active')} /> },
  { id: 'kpi-risk', title: 'At risk', description: 'Projects marked At Risk or red', w: 2, h: 2, minW: 2, minH: 2,
    render: (d, _u, c) => <Kpi label="At risk" value={num(d.kpis.atRisk)} tone={d.kpis.atRisk ? 'rose' : undefined} note="Status or RAG red" action="Show at-risk projects" onClick={c.customizing ? undefined : () => c.onFilter('risk')} /> },
  { id: 'kpi-completion', title: 'Average completion', description: 'Rolled up from activities', w: 2, h: 2, minW: 2, minH: 2,
    render: (d, _u, c) => <Kpi label="Average completion" value={pct(d.kpis.avgCompletion)} note="Rolled up from tasks" action="Sort by least complete" onClick={c.customizing ? undefined : () => c.onFilter('behind')} /> },
  { id: 'kpi-open', title: 'Open tasks', description: 'Tasks not done', w: 2, h: 2, minW: 2, minH: 2,
    render: (d, _u, c) => <Kpi label="Open tasks" value={num(d.kpis.openTasks)} note={`${num(d.kpis.blockedTasks)} blocked`} action={`${num(d.kpis.blockedTasks)} blocked: show projects`} onClick={c.customizing ? undefined : () => c.onFilter(d.kpis.blockedTasks ? 'blocked' : 'open')} /> },
  { id: 'kpi-overdue', title: 'Overdue tasks', description: 'Past due and not done', w: 2, h: 2, minW: 2, minH: 2,
    render: (d, _u, c) => <Kpi label="Overdue tasks" value={num(d.kpis.overdueTasks)} tone={d.kpis.overdueTasks ? 'amber' : 'green'} note="Past due date" action="Show projects with overdue tasks" onClick={c.customizing ? undefined : () => c.onFilter('overdue')} /> },
  { id: 'kpi-day1', title: 'Day-1 critical open', description: 'Day-1 critical items still open', w: 2, h: 2, minW: 2, minH: 2,
    render: (d) => <Kpi label="Day-1 critical open" value={num(d.kpis.day1CriticalOpen)} tone={d.kpis.day1CriticalOpen ? 'rose' : 'green'} note="Must be done before close" /> },
  { id: 'fin-fees', title: 'Fees: budget vs billed', description: 'PwC fee budget and billed to date', w: 4, h: 2, minW: 3, minH: 2, finance: true,
    render: (d) => {
      const b = d.kpis.feeBudget ?? 0; const f = d.kpis.feeBilled ?? 0; const share = b ? Math.min(100, (f / b) * 100) : 0;
      return (
        <div className="flex h-full flex-col justify-between p-4">
          <span className="text-[13px] font-medium text-ink-soft">Fees billed against budget</span>
          <div className="flex items-baseline gap-2"><span className="num text-[24px] font-medium leading-none">{money(f)}</span><span className="num text-[13px] text-ink-muted">of {money(b)}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-brand" style={{ width: `${share}%` }} /></div>
        </div>
      );
    } },
  { id: 'fin-tsa', title: 'TSA run-rate', description: 'Combined monthly TSA cost', w: 4, h: 2, minW: 3, minH: 2, finance: true,
    render: (d) => <Kpi label="TSA run-rate per month" value={money(d.kpis.tsaMonthly)} note="Every month removed saves this fee for exited services" /> },
  { id: 'fin-gap', title: 'Funding gaps', description: 'Unresolved buyer/seller funding gaps', w: 4, h: 2, minW: 3, minH: 2, finance: true,
    render: (d) => <Kpi label="Open funding gaps" value={money(d.kpis.fundingGap)} tone={d.kpis.fundingGap ? 'amber' : undefined} note="To split between buyer and seller" /> },
  { id: 'chart-status', title: 'Projects by status', description: 'Donut of project status', w: 3, h: 5, minW: 3, minH: 4,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={d.byStatus.filter((s) => s.count)} dataKey="count" nameKey="status" innerRadius="52%" outerRadius="80%" paddingAngle={2} stroke="none">
            {d.byStatus.filter((s) => s.count).map((s) => <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? CHART.sand} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
        </PieChart>
      </ResponsiveContainer>
    ) },
  { id: 'chart-rag', title: 'RAG mix', description: 'Green / Amber / Red projects', w: 3, h: 5, minW: 3, minH: 4,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.byRag} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.line} />
          <XAxis dataKey="rag" tick={{ fontSize: 12, fill: CHART.soft }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#E9EBEF' }} />
          <Bar dataKey="count" name="Projects" radius={[4, 4, 0, 0]} maxBarSize={44}>
            {d.byRag.map((r) => <Cell key={r.rag} fill={RAG_COLORS[r.rag] ?? CHART.sand} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    ) },
  { id: 'chart-stage', title: 'Projects by current stage', description: 'Where each project sits now', w: 12, h: 4, minW: 4, minH: 4,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.byStage} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={CHART.line} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="stage" width={110} tick={{ fontSize: 12, fill: CHART.soft }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#E9EBEF' }} />
          <Bar dataKey="count" name="Projects" fill={CHART.soft} radius={[0, 4, 4, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    ) },
  { id: 'chart-finance', title: 'Fees and TSA cost trend', description: 'Monthly planned vs actual fees and TSA cost', w: 12, h: 5, minW: 6, minH: 4, finance: true,
    render: (d) => d.financeTrend && d.financeTrend.length ? (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={d.financeTrend} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.line} />
          <XAxis dataKey="period_month" tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => money(v)} width={64} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => money(v, 'USD', false)} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
          <Line type="monotone" dataKey="fee_planned" name="Fees planned" stroke={CHART.sand} strokeWidth={2} dot={false} strokeDasharray="4 3" />
          <Line type="monotone" dataKey="fee_actual" name="Fees actual" stroke={CHART.brand} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="tsa_cost" name="Client TSA cost" stroke={CHART.blue} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    ) : <p className="text-[12.5px] text-ink-muted">No finance entries yet.</p> },
  { id: 'list-upcoming', title: 'Upcoming deadlines', description: 'Next due tasks across your projects', w: 6, h: 6, minW: 4, minH: 4,
    render: (d) => d.upcoming.length ? (
      <ul className="-mx-1 divide-y divide-line">
        {d.upcoming.map((t) => (
          <li key={t.task_id} className="flex items-center gap-3 px-1 py-1.5">
            <span className={`num w-14 shrink-0 text-[12px] ${isOverdue(t.due_date, t.status) ? 'font-medium text-rose' : 'text-ink-soft'}`}>{date(t.due_date, false)}</span>
            <span className="min-w-0 flex-1">
              <Link to={`/projects/${t.project_id}?task=${t.task_id}`} className="link block truncate text-[13.5px]">{t.title}</Link>
              <span className="block truncate text-[11.5px] text-ink-muted">{t.code_name}{t.assignee_name ? `, ${t.assignee_name}` : ''}</span>
            </span>
            <Pill>{t.status}</Pill>
          </li>
        ))}
      </ul>
    ) : <p className="text-[12.5px] text-ink-muted">Nothing due soon.</p> },
  { id: 'list-mywork', title: 'My work', description: 'Your open tasks that are due soon', w: 6, h: 6, minW: 4, minH: 4,
    render: (d, _u, c) => {
      const mine = d.upcoming.filter((t) => t.assignee_name && t.assignee_name === c.userName);
      const list = mine.length ? mine : d.upcoming.slice(0, 5);
      return (
        <div>
          {!mine.length && <p className="mb-1.5 text-[12.5px] text-ink-muted">Nothing assigned to you is due soon. Here is what is due next across your projects.</p>}
          <ul className="-mx-1 divide-y divide-line">
            {list.map((t) => {
              const late = isOverdue(t.due_date, t.status);
              return (
                <li key={t.task_id}>
                  <Link to={`/projects/${t.project_id}?task=${t.task_id}`} className="group flex items-center gap-3 rounded-md px-1 py-2 hover:bg-link-soft/40">
                    <span className={`num w-14 shrink-0 text-[12.5px] ${late ? 'font-medium text-rose' : 'text-ink-soft'}`}>{date(t.due_date, false)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-link group-hover:underline">{t.title}</span>
                      <span className="block truncate text-[12px] text-ink-muted">{t.code_name}{late ? ', overdue' : ''}</span>
                    </span>
                    <Pill>{t.status}</Pill>
                    <ChevronRight size={15} className="shrink-0 text-ink-muted group-hover:text-link" aria-hidden />
                  </Link>
                </li>
              );
            })}
            {!list.length && <li className="py-2 text-[12.5px] text-ink-muted">You are all caught up.</li>}
          </ul>
        </div>
      );
    } },
  { id: 'list-activity', title: 'Recent activity', description: 'Latest changes on your projects (who changed what)', w: 6, h: 6, minW: 4, minH: 4,
    render: (d, users) => d.recentActivity.length ? (
      <ul className="-mx-1 divide-y divide-line">
        {d.recentActivity.map((a) => (
          <li key={a.audit_id} className="flex items-start gap-3 px-1 py-1.5">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
              <span className="font-medium">{users.get(a.actor_user_id ?? '') ?? a.persona_code ?? 'System'}</span>{' '}
              <span className="text-ink-soft">{humanAction(a.action)}</span>{' '}
              {a.href && a.record_label
                ? <Link to={a.href} className="link font-normal">{a.record_label}</Link>
                : a.entity_id && <span className="num text-[11.5px] text-ink-muted">{a.entity_id}</span>}
              {a.ai_generated === 'Y' && <span className="ml-1 rounded bg-piku-soft px-1 text-[10.5px] font-medium text-piku">AI-assisted</span>}
              {a.code_name && a.record_label !== a.code_name && <span className="block truncate text-[11.5px] text-ink-muted">{a.code_name}</span>}
            </span>
            <span className="shrink-0 text-[11.5px] text-ink-muted">{relative(a.created_at)}</span>
          </li>
        ))}
      </ul>
    ) : <p className="text-[12.5px] text-ink-muted">No changes on your projects yet.</p> },
];

export function humanAction(action: string): string {
  const map: Record<string, string> = {
    'auth.login': 'signed in', 'auth.logout': 'signed out', 'access.denied': 'was denied access to',
    'ai.summary': 'asked AI for a summary of', 'ai.piku': 'asked Piku about', 'ai.suggest': 'got an AI suggestion for',
    'ai.draft_email': 'drafted an email with AI for', 'ai.meeting': 'planned a meeting with AI for', 'ai.closeout_preview': 'prepared the close-out of',
    'project.closeout': 'closed', 'closeout.submit': 'closed out and sent learnings for review from', 'closeout.archive_only': 'closed and archived (no reuse consent)',
    'closeout.approve': 'approved learnings from', 'knowledge.update': 'reviewed a knowledge item from', 'member.add': 'added a team member to',
    'member.remove': 'removed a team member from', 'note.create': 'added a note on', 'note.delete': 'removed a note on', 'communication.create': 'logged a communication on', 'stage.bulk_create': 'added stages to', 'activity.bulk_create': 'added activities to', 'task.bulk_create': 'added tasks to',
    'access.request': 'requested extra access on', 'access.approve.l1': 'gave level-1 approval for access on', 'access.approve.l2': 'gave level-2 (Risk) approval for access on',
    'access.reject': 'rejected an access request on', 'access.revoke': 'revoked access on', 'access.cancel': 'cancelled an access request on',
    'finance.funding.create': 'added a funding source to', 'finance.funding.update': 'updated a funding source on', 'finance.funding.delete': 'removed a funding source from',
    'finance.costs.create': 'added a cost line to', 'finance.costs.update': 'updated a cost line on', 'finance.costs.delete': 'removed a cost line from',
    'finance.invoices.create': 'added an invoice to', 'finance.invoices.update': 'updated an invoice on', 'finance.invoices.delete': 'removed an invoice from',
  };
  if (map[action]) return map[action];
  const gate: Record<string, string> = { 'stage.gate.request': 'requested gate approval for stage', 'stage.gate.approve': 'approved the gate of stage', 'stage.gate.reopen': 'reopened the gate of stage' };
  if (gate[action]) return gate[action];
  const [entity, verb] = action.split('.');
  const verbs: Record<string, string> = { create: 'created', update: 'updated', delete: 'removed', bulk: 'added several', approve: 'approved', close: 'closed', reorder: 'reordered', gate: 'changed the gate of' };
  if (verb && verbs[verb]) return `${verbs[verb]} ${entity}`;
  return action.replace(/[._]/g, ' ');
}

/** Legend labels in body text colour (series colour stays on the marker) so they meet contrast rules. */
export function legendText(value: string) { return <span style={{ color: 'rgb(var(--c-ink-soft))' }}>{value}</span>; }

export const DEFAULT_LAYOUT_IDS = [
  'kpi-active', 'kpi-risk', 'kpi-completion', 'kpi-open', 'kpi-overdue', 'kpi-day1',
  'fin-fees', 'fin-tsa', 'fin-gap', 'list-mywork', 'list-upcoming', 'chart-status', 'chart-rag', 'list-activity', 'chart-stage', 'chart-finance',
];
