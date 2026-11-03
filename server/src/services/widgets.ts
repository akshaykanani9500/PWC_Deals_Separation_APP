/**
 * v1.4 (C): data for custom dashboard widgets. A widget is a spec from shared/widgetCatalog.ts; the numbers are
 * computed here from the same permission-filtered scope as the dashboard (visible projects only, closed projects
 * left out unless asked for). Finance metrics need finance.view; the client viewer gets no people groupings.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Project, ProjectMember, Stage, Task, User, WidgetData, WidgetSpec } from '../../../shared/types';
import { groupDef, metricDef, normaliseSpec, specError } from '../../../shared/widgetCatalog';
import { HttpError } from '../errors';
import { visibleProjectIds } from './access';
import { isOverdue, today } from './rollup';

const PRIORITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];
const STATUS_ORDER = ['Blocked', 'In Progress', 'Not Started', 'Done', 'Planning', 'Active', 'At Risk', 'On Hold', 'Closing', 'Closed'];
const RAG_ORDER = ['Red', 'Amber', 'Green'];

/** Validate (400) and check permissions (403). Returns the normalised spec. */
export function checkSpec(auth: AuthContext, raw: unknown): WidgetSpec {
  const err = specError(raw as WidgetSpec);
  if (err) throw new HttpError(400, err, 'VALIDATION');
  const spec = normaliseSpec(raw as WidgetSpec);
  const m = metricDef(spec.metric)!;
  if (m.finance && !auth.actions.includes('finance.view')) throw new HttpError(403, 'Finance figures are not available to your role.', 'FORBIDDEN');
  if (auth.code === 'CLIENT' && groupDef(spec.groupBy)?.people) throw new HttpError(403, 'People groupings are not available in the client view.', 'FORBIDDEN');
  return spec;
}

export async function computeWidget(db: Db, auth: AuthContext, raw: unknown): Promise<WidgetData> {
  const spec = checkSpec(auth, raw);
  const m = metricDef(spec.metric)!;
  const f = spec.filter ?? {};
  const ids = await visibleProjectIds(db, auth);
  const me = auth.user.user_id;
  let projects = (await db.all<Project>('projects')).filter((p) => ids.has(p.project_id));
  if (f.projectId) projects = projects.filter((p) => p.project_id === f.projectId);
  if (m.entity === 'project' && f.status) projects = projects.filter((p) => p.status === f.status);
  else projects = projects.filter((p) => p.status !== 'Closed');
  if (f.atRisk) projects = projects.filter((p) => p.status === 'At Risk' || p.rag === 'Red');
  if (f.mine && m.entity === 'project') {
    const mine = new Set((await db.find<ProjectMember>('project_members', (x) => x.user_id === me)).map((x) => x.project_id));
    projects = projects.filter((p) => mine.has(p.project_id) || p.partner_user_id === me || p.manager_user_id === me);
  }
  const pById = new Map(projects.map((p) => [p.project_id, p]));
  const stages = await db.all<Stage>('stages');
  const stageBy = new Map(stages.map((s) => [s.stage_id, s]));
  const users = new Map((await db.all<User>('users', { includeDeleted: true })).map((u) => [u.user_id, u.full_name]));
  const t0 = today();

  const groups = new Map<string, { label: string; values: number[] }>();
  const add = (key: string, label: string, v: number) => {
    const g = groups.get(key) ?? { label, values: [] };
    g.values.push(v); groups.set(key, g);
  };
  const keyFor = (p: Project, t?: Task): [string, string] => {
    switch (spec.groupBy) {
      case 'none': return ['all', 'All'];
      case 'project': return [p.project_id, p.code_name];
      case 'stage': {
        const s = stageBy.get((t ? t.stage_id : p.current_stage_id) || '');
        return s ? [s.name, s.name] : ['-', 'Not started'];
      }
      case 'status': { const v = t ? t.status : p.status; return [v || '-', v || 'Not set']; }
      case 'priority': { const v = t?.priority; return [v || '-', v || 'Not set']; }
      case 'assignee': { const id = t?.assignee_user_id; return id ? [id, users.get(id) ?? id] : ['-', 'Unassigned']; }
      case 'stage_owner': { const id = stageBy.get(t?.stage_id || '')?.owner_user_id; return id ? [id, users.get(id) ?? id] : ['-', 'No lead']; }
      case 'industry': return [p.industry || '-', p.industry || 'Other'];
      case 'deal_type': return [p.deal_type || '-', p.deal_type || 'Not set'];
      case 'rag': return [p.rag || 'Green', p.rag || 'Green'];
      case 'month': { const d = (t ? t.due_date : p.target_close_date) || ''; return d ? [d.slice(0, 7), d.slice(0, 7)] : ['-', 'No date']; }
    }
  };

  if (m.entity === 'task') {
    let tasks = await db.find<Task>('tasks', (t) => pById.has(t.project_id));
    if (f.status) tasks = tasks.filter((t) => t.status === f.status);
    if (f.mine) tasks = tasks.filter((t) => t.assignee_user_id === me);
    for (const t of tasks) {
      const open = t.status !== 'Done';
      let v: number | null = null;
      switch (spec.metric) {
        case 'task_count': v = 1; break;
        case 'open_tasks': v = open ? 1 : null; break;
        case 'overdue_tasks': v = isOverdue(t, t0) ? 1 : null; break;
        case 'blocked_tasks': v = t.status === 'Blocked' ? 1 : null; break;
        case 'day1_open': v = open && t.day1_critical === 'Y' ? 1 : null; break;
        case 'hours_planned': v = Number(t.effort_hours) || 0; break;
      }
      if (v === null) continue;
      const [k, l] = keyFor(pById.get(t.project_id)!, t);
      add(k, l, v);
    }
  } else {
    for (const p of projects) {
      let v = 0;
      switch (spec.metric) {
        case 'projects_count': v = 1; break;
        case 'pct_complete_avg': v = Number(p.percent_complete) || 0; break;
        case 'fee_budget': v = Number(p.fee_budget) || 0; break;
        case 'fee_billed': v = Number(p.fee_billed) || 0; break;
        case 'tsa_run_rate': v = Number(p.tsa_monthly_cost) || 0; break;
        case 'funding_gap': v = Number(p.funding_gap) || 0; break;
      }
      const [k, l] = keyFor(p);
      add(k, l, v);
    }
  }

  const avg = spec.metric === 'pct_complete_avg';
  const agg = (vals: number[]) => {
    const s = vals.reduce((a, b) => a + b, 0);
    return Math.round((avg ? (vals.length ? s / vals.length : 0) : s) * 10) / 10;
  };
  let rows = [...groups.entries()].map(([key, g]) => ({ key, label: g.label, value: agg(g.values) }));
  const order = spec.groupBy === 'priority' ? PRIORITY_ORDER : spec.groupBy === 'status' ? STATUS_ORDER : spec.groupBy === 'rag' ? RAG_ORDER : null;
  if (spec.groupBy === 'month') rows.sort((a, b) => a.key.localeCompare(b.key));
  else if (order) {
    const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? 99 : i; };
    rows.sort((a, b) => rank(a.key) - rank(b.key));
  }
  else rows.sort((a, b) => b.value - a.value);
  if (spec.groupBy === 'month') rows = rows.filter((r) => r.key !== '-').slice(-18);
  else rows = rows.slice(0, 25);
  const all = [...groups.values()].flatMap((g) => g.values);
  const total = agg(all);
  const currency = m.unit === 'money' ? (projects.find((p) => p.currency)?.currency ?? 'USD') : undefined;
  return {
    spec, unit: m.unit, currency, total, rows,
    note: !projects.length ? 'No projects match these filters right now (only projects you can see are counted).' : !rows.length ? 'Nothing to show for these filters right now.' : undefined,
  };
}
