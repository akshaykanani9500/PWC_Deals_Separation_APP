/**
 * v1.4 (C): safe catalogue for custom dashboard widgets. Used by the server (validation + computation) and by the
 * client builder (dropdowns). A widget is only ever a spec that picks from these lists - never code or SQL.
 */
import type { WidgetChart, WidgetGroupBy, WidgetMetric, WidgetSpec } from './types';

export interface MetricDef {
  id: WidgetMetric; label: string; entity: 'task' | 'project'; unit: 'count' | 'money' | 'percent' | 'hours';
  /** needs finance.view */
  finance?: boolean; description: string;
}

export const WIDGET_METRICS: MetricDef[] = [
  { id: 'task_count', label: 'Tasks (all)', entity: 'task', unit: 'count', description: 'Number of tasks, done or not' },
  { id: 'open_tasks', label: 'Open tasks', entity: 'task', unit: 'count', description: 'Tasks that are not done' },
  { id: 'overdue_tasks', label: 'Overdue tasks', entity: 'task', unit: 'count', description: 'Open tasks past their due date' },
  { id: 'blocked_tasks', label: 'Blocked tasks', entity: 'task', unit: 'count', description: 'Tasks with status Blocked' },
  { id: 'day1_open', label: 'Day-1 critical open', entity: 'task', unit: 'count', description: 'Open tasks flagged Day-1 critical' },
  { id: 'hours_planned', label: 'Hours planned', entity: 'task', unit: 'hours', description: 'Sum of planned effort hours on tasks' },
  { id: 'pct_complete_avg', label: '% complete (average)', entity: 'project', unit: 'percent', description: 'Average project completion' },
  { id: 'projects_count', label: 'Projects', entity: 'project', unit: 'count', description: 'Number of projects' },
  { id: 'fee_budget', label: 'Fee budget', entity: 'project', unit: 'money', finance: true, description: 'PwC fee budget' },
  { id: 'fee_billed', label: 'Fees billed', entity: 'project', unit: 'money', finance: true, description: 'Fees billed to date' },
  { id: 'tsa_run_rate', label: 'TSA run-rate / month', entity: 'project', unit: 'money', finance: true, description: 'Monthly TSA cost' },
  { id: 'funding_gap', label: 'Funding gap', entity: 'project', unit: 'money', finance: true, description: 'Open buyer/seller funding gap' },
];

export interface GroupDef { id: WidgetGroupBy; label: string; entities: ('task' | 'project')[]; people?: boolean }
export const WIDGET_GROUPS: GroupDef[] = [
  { id: 'none', label: 'No grouping (single number)', entities: ['task', 'project'] },
  { id: 'project', label: 'Project', entities: ['task', 'project'] },
  { id: 'stage', label: 'Stage name', entities: ['task', 'project'] },
  { id: 'status', label: 'Status', entities: ['task', 'project'] },
  { id: 'priority', label: 'Priority', entities: ['task'] },
  { id: 'assignee', label: 'Assignee', entities: ['task'], people: true },
  { id: 'stage_owner', label: 'Workstream lead (stage owner)', entities: ['task'], people: true },
  { id: 'industry', label: 'Industry', entities: ['task', 'project'] },
  { id: 'deal_type', label: 'Deal type', entities: ['task', 'project'] },
  { id: 'rag', label: 'RAG', entities: ['task', 'project'] },
  { id: 'month', label: 'Month due (tasks) / target close (projects)', entities: ['task', 'project'] },
];

export const WIDGET_CHARTS: { id: WidgetChart; label: string }[] = [
  { id: 'kpi', label: 'KPI number' }, { id: 'bar', label: 'Bar' }, { id: 'hbar', label: 'Horizontal bar' },
  { id: 'pie', label: 'Pie / donut' }, { id: 'line', label: 'Line (by month)' }, { id: 'table', label: 'Table' },
];

export const metricDef = (id: string) => WIDGET_METRICS.find((m) => m.id === id);
export const groupDef = (id: string) => WIDGET_GROUPS.find((g) => g.id === id);

/** Returns an error message when the spec is not valid for the catalogue (null when fine). */
export function specError(s: Partial<WidgetSpec> | null | undefined): string | null {
  if (!s || typeof s !== 'object') return 'Widget spec is missing';
  const m = metricDef(String(s.metric));
  if (!m) return 'Unknown metric';
  const g = groupDef(String(s.groupBy ?? 'none'));
  if (!g) return 'Unknown grouping';
  if (!g.entities.includes(m.entity)) return `"${m.label}" cannot be grouped by ${g.label.toLowerCase()}`;
  if (!WIDGET_CHARTS.some((c) => c.id === s.chart)) return 'Unknown chart type';
  if (s.chart === 'line' && s.groupBy !== 'month') return 'Line charts need grouping by month';
  if (s.chart !== 'kpi' && (s.groupBy ?? 'none') === 'none' && s.chart !== 'table') return 'Pick a grouping for a chart, or use the KPI number';
  if (typeof s.title !== 'string' || !s.title.trim() || s.title.length > 80) return 'Give the widget a title (max 80 characters)';
  const f = s.filter ?? {};
  if (typeof f !== 'object') return 'Invalid filter';
  for (const k of Object.keys(f)) if (!['status', 'projectId', 'mine', 'atRisk'].includes(k)) return `Unknown filter "${k}"`;
  if (f.status !== undefined && (typeof f.status !== 'string' || f.status.length > 30)) return 'Invalid status filter';
  if (f.projectId !== undefined && (typeof f.projectId !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(f.projectId))) return 'Invalid project filter';
  return null;
}

/** Normalise a spec (defaults, trimmed title, KPI when nothing to group). */
export function normaliseSpec(s: WidgetSpec): WidgetSpec {
  const groupBy = s.groupBy ?? 'none';
  const filter: WidgetSpec['filter'] = {};
  if (s.filter?.status) filter.status = s.filter.status;
  if (s.filter?.projectId) filter.projectId = s.filter.projectId;
  if (s.filter?.mine) filter.mine = true;
  if (s.filter?.atRisk) filter.atRisk = true;
  return { title: String(s.title).trim().slice(0, 80), metric: s.metric, groupBy, chart: groupBy === 'none' && s.chart !== 'table' ? 'kpi' : s.chart, filter };
}

/** Plain-English description of a spec. */
export function describeSpec(s: WidgetSpec): string {
  const m = metricDef(s.metric); const g = groupDef(s.groupBy);
  const parts = [m ? m.label : s.metric];
  if (s.groupBy !== 'none' && g) parts.push(`grouped by ${g.label.toLowerCase()}`);
  const f: string[] = [];
  if (s.filter?.mine) f.push(m?.entity === 'task' ? 'only tasks assigned to you' : 'only projects you are on');
  if (s.filter?.atRisk) f.push('only at-risk projects (At Risk or Red)');
  if (s.filter?.status) f.push(`status ${s.filter.status}`);
  if (s.filter?.projectId) f.push(`project ${s.filter.projectId}`);
  if (f.length) parts.push(`(${f.join(', ')})`);
  parts.push(`as ${WIDGET_CHARTS.find((c) => c.id === s.chart)?.label.toLowerCase() ?? s.chart}`);
  return `${parts.join(' ')}.`;
}
