import { Router } from 'express';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { AuditEntry, DashboardData, FinanceEntry, Project, Stage, Task } from '../../../shared/types';
import { ah } from '../errors';
import { visibleProjectIds } from '../services/access';
import { isOverdue, today } from '../services/rollup';
import { userIndex } from './helpers';

/** Actions a CLIENT may see in the activity feed. */
const CLIENT_FEED = /^(task\.(update|create)|stage\.gate|activity\.(create|update))/;
/** Only changes people act on: creates, edits, removals, gate decisions, close-outs, approvals.
 *  Sign-ins, reads, denied access and read-only AI calls (summaries, Piku questions, drafts) are left out.
 *  Applied AI suggestions still show, because they arrive as *.bulk_create / *.create with ai_generated='Y'. */
const MEANINGFUL = /^(project|stage|activity|task|member|note|knowledge|closeout|communication)\.(create|bulk_create|update|delete|reorder|gate\.|approve|submit|archive_only|add|remove)/;

export function dashboardRouter(db: Db): Router {
  const r = Router();
  r.get('/', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const ids = await visibleProjectIds(db, auth);
    const projects = (await db.all<Project>('projects')).filter((p) => ids.has(p.project_id));
    const active = projects.filter((p) => p.status !== 'Closed');
    const activeIds = new Set(active.map((p) => p.project_id));
    const tasks = await db.find<Task>('tasks', (t) => activeIds.has(t.project_id));
    const open = tasks.filter((t) => t.status !== 'Done');
    const stages = await db.all<Stage>('stages');
    const stageName = new Map(stages.map((s) => [s.stage_id, s.name]));
    const fin = auth.actions.includes('finance.view');
    const sum = (k: keyof Project) => active.reduce((s, p) => s + (Number(p[k]) || 0), 0);
    const count = <K extends string>(vals: K[]) => {
      const m = new Map<K, number>();
      for (const v of vals) m.set(v, (m.get(v) || 0) + 1);
      return [...m.entries()];
    };
    const idx = await userIndex(db);
    const t0 = today();

    let financeTrend: DashboardData['financeTrend'] = null;
    if (fin) {
      const entries = await db.find<FinanceEntry>('finance_entries', (f) => ids.has(f.project_id));
      const months = new Map<string, { period_month: string; fee_planned: number; fee_actual: number; tsa_cost: number }>();
      for (const e of entries) {
        const m = months.get(e.period_month) || { period_month: e.period_month, fee_planned: 0, fee_actual: 0, tsa_cost: 0 };
        m.fee_planned += Number(e.fee_planned) || 0;
        m.fee_actual += Number(e.fee_actual) || 0;
        m.tsa_cost += Number(e.tsa_cost) || 0;
        months.set(e.period_month, m);
      }
      financeTrend = [...months.values()].sort((a, b) => a.period_month.localeCompare(b.period_month)).slice(-12);
    }

    const codeName = new Map(projects.map((p) => [p.project_id, p.code_name]));
    const upcoming = open
      .filter((t) => t.due_date)
      .filter((t) => auth.code !== 'ANALYST' || t.assignee_user_id === auth.user.user_id)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
      .filter((t) => t.due_date! >= t0 || isOverdue(t, t0))
      .slice(0, 12)
      .map((t) => ({ task_id: t.task_id, title: t.title, project_id: t.project_id, code_name: codeName.get(t.project_id) || '', due_date: t.due_date!, status: t.status, assignee_name: idx.name(t.assignee_user_id) }));

    const feed = (await db.all<AuditEntry>('audit_log'))
      .filter((a) => a.project_id && ids.has(a.project_id) && MEANINGFUL.test(a.action))
      // The client viewer only sees delivery progress, never internal AI use or close-out work.
      .filter((a) => auth.code !== 'CLIENT' || (CLIENT_FEED.test(a.action) && a.ai_generated !== 'Y'))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 15);
    // Human-readable record names and links (only for records the user can see: the project filter above already applies).
    const [allTasks, allActs, allStages] = await Promise.all([db.all<Task>('tasks'), db.all<any>('activities'), db.all<Stage>('stages')]);
    const taskBy = new Map(allTasks.map((t) => [t.task_id, t]));
    const actBy = new Map(allActs.map((a) => [a.activity_id, a]));
    const stageBy = new Map(allStages.map((s) => [s.stage_id, s]));
    const audits = feed.map((a) => {
      const pid = a.project_id!;
      let record_label: string | undefined; let href: string | undefined;
      const id = a.entity_id || '';
      if (a.entity_type === 'task' && taskBy.has(id)) {
        const t = taskBy.get(id)!; record_label = t.title;
        href = `/projects/${pid}/stages/${t.stage_id}/activities/${t.activity_id}?task=${t.task_id}`;
      } else if (a.entity_type === 'activity' && actBy.has(id)) {
        const x = actBy.get(id)!; record_label = x.name; href = `/projects/${pid}/stages/${x.stage_id}/activities/${x.activity_id}`;
      } else if (a.entity_type === 'stage' && stageBy.has(id)) {
        const x = stageBy.get(id)!; record_label = x.name; href = `/projects/${pid}/stages/${x.stage_id}`;
      } else {
        record_label = codeName.get(pid); href = `/projects/${pid}`;
      }
      const out = { ...a, record_label, href, code_name: codeName.get(pid) };
      if (auth.code === 'CLIENT') out.details = null; // never show internal change details to the client
      return out;
    });

    const data: DashboardData = {
      kpis: {
        activeProjects: active.length,
        atRisk: active.filter((p) => p.status === 'At Risk' || p.rag === 'Red').length,
        avgCompletion: active.length ? Math.round((active.reduce((s, p) => s + (Number(p.percent_complete) || 0), 0) / active.length) * 10) / 10 : 0,
        openTasks: open.length,
        overdueTasks: open.filter((t) => isOverdue(t, t0)).length,
        blockedTasks: open.filter((t) => t.status === 'Blocked').length,
        day1CriticalOpen: open.filter((t) => t.day1_critical === 'Y').length,
        feeBudget: fin ? sum('fee_budget') : null,
        feeBilled: fin ? sum('fee_billed') : null,
        tsaMonthly: fin ? sum('tsa_monthly_cost') : null,
        fundingGap: fin ? sum('funding_gap') : null,
      },
      byStatus: count(projects.map((p) => p.status)).map(([status, c]) => ({ status, count: c })),
      byRag: count(active.map((p) => p.rag || 'Green')).map(([rag, c]) => ({ rag, count: c })),
      byStage: count(active.map((p) => stageName.get(p.current_stage_id || '') || 'Not started')).map(([stage, c]) => ({ stage, count: c })),
      byIndustry: count(active.map((p) => p.industry || 'Other')).map(([industry, c]) => ({ industry, count: c })),
      financeTrend,
      upcoming,
      recentActivity: audits,
    };
    res.json(data);
  }));
  return r;
}
