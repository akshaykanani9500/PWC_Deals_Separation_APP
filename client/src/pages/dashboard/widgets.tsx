/** Dashboard widget catalogue. Each widget renders from DashboardData. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardData } from '@shared/types';
import { money, pct, num, date, relative, isOverdue } from '../../lib/format';
import { Pill } from '../../components/ui';

export const CHART = {
  ink: '#1D1B19', soft: '#4A4642', muted: '#7A746C', line: '#E3DED6', brand: '#D04A02',
  blue: '#2C5F8A', green: '#2F7D4F', amber: '#C98A00', rose: '#C8312A', piku: '#5B3FD0', sand: '#B9AE9F',
};
const STATUS_COLORS: Record<string, string> = {
  Planning: CHART.sand, Active: CHART.blue, 'At Risk': CHART.rose, 'On Hold': CHART.amber, Closing: CHART.piku, Closed: CHART.green,
};
const RAG_COLORS: Record<string, string> = { Green: CHART.green, Amber: CHART.amber, Red: CHART.rose };

export interface WidgetDef {
  id: string;
  title: string;
  description: string;
  w: number; h: number; minW?: number; minH?: number;
  finance?: boolean;
  render: (d: DashboardData, users: Map<string, string>) => ReactNode;
}

function Kpi({ value, label, note, tone }: { value: ReactNode; label: string; note?: ReactNode; tone?: 'rose' | 'amber' | 'green' }) {
  const color = tone === 'rose' ? 'text-rose' : tone === 'amber' ? 'text-amber' : tone === 'green' ? 'text-green' : 'text-ink';
  return (
    <div className="flex h-full flex-col justify-between">
      <span className="text-[12px] text-ink-soft">{label}</span>
      <span className={`num text-[28px] font-medium leading-none ${color}`}>{value}</span>
      <span className="truncate text-[11.5px] text-ink-muted">{note ?? ' '}</span>
    </div>
  );
}

const tooltipStyle = { fontSize: 12, borderRadius: 8, border: `1px solid ${CHART.line}`, boxShadow: '0 8px 24px rgba(0,0,0,.08)' };

export const WIDGETS: WidgetDef[] = [
  { id: 'kpi-active', title: 'Active projects', description: 'Projects that are not closed', w: 2, h: 2, minW: 2, minH: 2,
    render: (d) => <Kpi label="Active projects" value={num(d.kpis.activeProjects)} note="Visible to you" /> },
  { id: 'kpi-risk', title: 'At risk', description: 'Projects marked At Risk or red', w: 2, h: 2, minW: 2, minH: 2,
    render: (d) => <Kpi label="At risk" value={num(d.kpis.atRisk)} tone={d.kpis.atRisk ? 'rose' : undefined} note="Status or RAG red" /> },
  { id: 'kpi-completion', title: 'Average completion', description: 'Rolled up from activities', w: 2, h: 2, minW: 2, minH: 2,
    render: (d) => <Kpi label="Average completion" value={pct(d.kpis.avgCompletion)} note="Rolled up from tasks" /> },
  { id: 'kpi-open', title: 'Open tasks', description: 'Tasks not done', w: 2, h: 2, minW: 2, minH: 2,
    render: (d) => <Kpi label="Open tasks" value={num(d.kpis.openTasks)} note={`${num(d.kpis.blockedTasks)} blocked`} /> },
  { id: 'kpi-overdue', title: 'Overdue tasks', description: 'Past due and not done', w: 2, h: 2, minW: 2, minH: 2,
    render: (d) => <Kpi label="Overdue tasks" value={num(d.kpis.overdueTasks)} tone={d.kpis.overdueTasks ? 'amber' : 'green'} note="Past due date" /> },
  { id: 'kpi-day1', title: 'Day-1 critical open', description: 'Day-1 critical items still open', w: 2, h: 2, minW: 2, minH: 2,
    render: (d) => <Kpi label="Day-1 critical open" value={num(d.kpis.day1CriticalOpen)} tone={d.kpis.day1CriticalOpen ? 'rose' : 'green'} note="Must be done before close" /> },
  { id: 'fin-fees', title: 'Fees: budget vs billed', description: 'PwC fee budget and billed to date', w: 4, h: 2, minW: 3, minH: 2, finance: true,
    render: (d) => {
      const b = d.kpis.feeBudget ?? 0; const f = d.kpis.feeBilled ?? 0; const share = b ? Math.min(100, (f / b) * 100) : 0;
      return (
        <div className="flex h-full flex-col justify-between">
          <span className="text-[12px] text-ink-soft">Fees billed against budget</span>
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
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
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
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#EFECE7' }} />
          <Bar dataKey="count" name="Projects" radius={[4, 4, 0, 0]} maxBarSize={44}>
            {d.byRag.map((r) => <Cell key={r.rag} fill={RAG_COLORS[r.rag] ?? CHART.sand} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    ) },
  { id: 'chart-stage', title: 'Projects by current stage', description: 'Where each project sits now', w: 6, h: 5, minW: 4, minH: 4,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.byStage} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={CHART.line} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="stage" width={110} tick={{ fontSize: 12, fill: CHART.soft }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#EFECE7' }} />
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
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
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
              <Link to={`/projects/${t.project_id}?task=${t.task_id}`} className="block truncate text-[13px] hover:text-brand">{t.title}</Link>
              <span className="block truncate text-[11.5px] text-ink-muted">{t.code_name}{t.assignee_name ? `, ${t.assignee_name}` : ''}</span>
            </span>
            <Pill>{t.status}</Pill>
          </li>
        ))}
      </ul>
    ) : <p className="text-[12.5px] text-ink-muted">Nothing due soon.</p> },
  { id: 'list-activity', title: 'Recent activity', description: 'Latest changes and AI actions', w: 6, h: 6, minW: 4, minH: 4,
    render: (d, users) => d.recentActivity.length ? (
      <ul className="-mx-1 divide-y divide-line">
        {d.recentActivity.map((a) => (
          <li key={a.audit_id} className="flex items-start gap-3 px-1 py-1.5">
            <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-muted" />
            <span className="min-w-0 flex-1 text-[12.5px]">
              <span className="font-medium">{users.get(a.actor_user_id ?? '') ?? a.persona_code ?? 'System'}</span>{' '}
              <span className="text-ink-soft">{humanAction(a.action)}</span>{' '}
              {a.entity_id && <span className="num text-[11.5px] text-ink-muted">{a.entity_id}</span>}
              {a.ai_generated === 'Y' && <span className="ml-1 rounded bg-piku-soft px-1 text-[10.5px] text-piku">AI</span>}
            </span>
            <span className="shrink-0 text-[11.5px] text-ink-muted">{relative(a.created_at)}</span>
          </li>
        ))}
      </ul>
    ) : <p className="text-[12.5px] text-ink-muted">No recent changes.</p> },
];

export function humanAction(action: string): string {
  const map: Record<string, string> = {
    'auth.login': 'signed in', 'auth.logout': 'signed out', 'access.denied': 'was denied access to',
    'ai.summary': 'asked AI for a summary of', 'ai.piku': 'asked Piku about', 'ai.suggest': 'got an AI suggestion for',
    'ai.draft_email': 'drafted an email with AI for', 'ai.meeting': 'planned a meeting with AI for', 'ai.closeout_preview': 'prepared the close-out of',
    'project.closeout': 'closed', 'stage.bulk_create': 'added stages to', 'activity.bulk_create': 'added activities to', 'task.bulk_create': 'added tasks to',
  };
  if (map[action]) return map[action];
  const [entity, verb] = action.split('.');
  const verbs: Record<string, string> = { create: 'created', update: 'updated', delete: 'removed', bulk: 'added several', approve: 'approved', close: 'closed', reorder: 'reordered', gate: 'changed the gate of' };
  if (verb && verbs[verb]) return `${verbs[verb]} ${entity}`;
  return action.replace(/[._]/g, ' ');
}

export const DEFAULT_LAYOUT_IDS = [
  'kpi-active', 'kpi-risk', 'kpi-completion', 'kpi-open', 'kpi-overdue', 'kpi-day1',
  'fin-fees', 'fin-tsa', 'fin-gap', 'chart-status', 'chart-rag', 'chart-stage', 'list-upcoming', 'list-activity', 'chart-finance',
];
