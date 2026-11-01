/**
 * Screen context pack: a complete, permission-filtered picture of WHERE the user is (portfolio, project,
 * stage, activity or task), as numbered facts + linkable sources. Every Gemini answer is grounded in it,
 * so a direct question about anything on the screen can be answered exactly.
 * Only data loaded through data.ts / access.ts is used, so nothing the persona may not see can leak in.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Activity, AuditEntry, Task } from '../../../shared/types';
import { completion, hrefFor, isOverdue, loadComms, loadContacts, loadNotes, loadTsa, pct, taskHref, userName, type ScopedData } from './data';
import { fmtMoney, todayIso } from './lang';
import type { PikuSource } from './agents/types';
import type { Capabilities } from './guardrails';

export interface ContextPack { title: string; facts: string[]; sources: PikuSource[] }

const MAX_CHARS = 14_000;
const clip = (s: string | undefined | null, n = 220) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : '');

/** Today's date in India (IST), so "overdue" and "this week" match what the user sees. */
export function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function buildContextPack(db: Db, auth: AuthContext, data: ScopedData, cap: Capabilities): Promise<ContextPack> {
  const { scope, users } = data;
  const primary: string[] = [];   // the record on screen - never dropped
  const secondary: string[] = []; // supporting detail - summarised if too long
  const sources: PikuSource[] = [];
  const src = (s: PikuSource) => { if (!sources.some((x) => x.type === s.type && x.id === s.id)) sources.push(s); return sources.findIndex((x) => x.type === s.type && x.id === s.id) + 1; };
  const who = (id?: string | null) => userName(users, id);
  const fin = cap.flags.finance;
  const money = (n: number | null | undefined, cur?: string) => fmtMoney(n, cur || 'USD');
  const taskLine = (x: Task, withWhere = false) => {
    const flags = [x.status === 'Blocked' ? 'BLOCKED' : '', isOverdue(x) ? 'OVERDUE' : '', x.day1_critical === 'Y' ? 'Day-1 critical' : ''].filter(Boolean).join(', ');
    const where = withWhere ? ` [activity: ${data.activities.find((a) => a.activity_id === x.activity_id)?.name ?? '-'}]` : '';
    const n = src({ type: 'task', id: x.task_id, label: x.title, href: taskHref(x) });
    return `Task "${x.title}"${where} [${n}]: ${x.status}${flags ? ` (${flags})` : ''}, ${x.status === 'Done' ? 100 : Number(x.percent_complete ?? 0)}% done, assignee ${who(x.assignee_user_id)}, priority ${x.priority ?? '-'}, due ${x.due_date ?? '-'}`
      + `${x.done_notes ? `; done so far: ${clip(x.done_notes)}` : ''}${x.pending_notes ? `; pending: ${clip(x.pending_notes)}` : ''}${x.dependency_notes ? `; waiting on: ${clip(x.dependency_notes)}` : ''}`;
  };
  const counts = (tasks: Task[]) => {
    const open = tasks.filter((x) => x.status !== 'Done');
    return `${tasks.length - open.length}/${tasks.length} tasks done, ${open.filter((x) => x.status === 'In Progress').length} in progress, ${open.filter((x) => x.status === 'Blocked').length} blocked, ${open.filter(isOverdue).length} overdue, ${open.filter((x) => x.day1_critical === 'Y').length} Day-1 critical open`;
  };
  const projectLine = (pid: string) => {
    const p = data.projects.find((x) => x.project_id === pid);
    if (!p) return '';
    const stage = data.stages.find((s) => s.stage_id === p.current_stage_id)?.name ?? '-';
    const n = src({ type: 'project', id: p.project_id, label: p.code_name, href: hrefFor('project', { projectId: p.project_id }) });
    return `Project ${p.code_name} [${n}]: ${p.client_alias ?? ''} | ${p.deal_type ?? '-'} | ${p.industry ?? '-'} | status ${p.status}, RAG ${p.rag ?? '-'}, ${pct(p.percent_complete)} complete, current stage ${stage}, start ${p.start_date ?? '-'}, target close ${p.target_close_date ?? '-'}, partner ${who(p.partner_user_id)}, manager ${who(p.manager_user_id)}`
      + `${p.apps_in_scope ? `, ${p.apps_in_scope} apps` : ''}${p.sites_in_scope ? `, ${p.sites_in_scope} sites` : ''}${p.employees_conveying ? `, ${p.employees_conveying} conveying employees` : ''}`
      + (fin ? `; finance: fee budget ${money(p.fee_budget, p.currency)}, billed ${money(p.fee_billed, p.currency)}, client TSA run-rate ${money(p.tsa_monthly_cost, p.currency)}/month, one-time cost ${money(p.one_time_cost, p.currency)}, funding gap ${money(p.funding_gap, p.currency)}` : '');
  };

  primary.push(`Today is ${todayIst()} (India time). The user is ${auth.user.full_name}, ${cap.role}.`);
  const today = todayIso();

  // ------------------------------------------------------------- GLOBAL (dashboard)
  if (scope.type === 'global') {
    const active = data.projects.filter((p) => p.status !== 'Closed');
    primary.push(`Screen: dashboard. The user can see ${data.projects.length} ${data.projects.length === 1 ? 'project' : 'projects'}, ${active.length} active.`);
    for (const p of data.projects) primary.push(projectLine(p.project_id));
    for (const p of active) {
      const pt = data.tasks.filter((x) => x.project_id === p.project_id);
      secondary.push(`${p.code_name}: ${counts(pt)}`);
    }
    const mine = data.tasks.filter((x) => x.assignee_user_id === auth.user.user_id && x.status !== 'Done').sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));
    primary.push(mine.length ? `The user's own open tasks (${mine.length}):` : 'The user has no open tasks assigned.');
    for (const x of mine.slice(0, 12)) primary.push(`- ${taskLine(x)} (project ${data.projects.find((p) => p.project_id === x.project_id)?.code_name ?? '-'})`);
    const open = data.tasks.filter((x) => x.status !== 'Done');
    const late = open.filter(isOverdue).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    secondary.push(`Overdue across visible projects: ${late.length}.`);
    for (const x of late.slice(0, 10)) secondary.push(`- ${taskLine(x)} (project ${data.projects.find((p) => p.project_id === x.project_id)?.code_name ?? '-'})`);
    const upcoming = open.filter((x) => x.due_date && x.due_date >= today).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).slice(0, 8);
    for (const x of upcoming) secondary.push(`Upcoming: ${taskLine(x)} (project ${data.projects.find((p) => p.project_id === x.project_id)?.code_name ?? '-'})`);
  }

  // ------------------------------------------------------------- PROJECT / STAGE / ACTIVITY / TASK share the project header
  const p = scope.project;
  if (p) {
    const line = projectLine(p.project_id);
    if (scope.type === 'project') primary.push(`Screen: project page of ${p.code_name}.`, line, p.description ? `Description: ${clip(p.description, 500)}` : '');
    else secondary.push(line);
  }

  if (scope.type === 'project' && p) {
    primary.push(`Project totals: ${counts(data.tasks)}.`);
    for (const s of data.stages) {
      const st = data.tasks.filter((x) => x.stage_id === s.stage_id);
      const n = src({ type: 'stage', id: s.stage_id, label: s.name, href: hrefFor('stage', { projectId: p.project_id, stageId: s.stage_id }) });
      primary.push(`Stage ${s.sort_order}. ${s.name} [${n}]${s.stage_id === p.current_stage_id ? ' (CURRENT)' : ''}: ${pct(s.percent_complete ?? completion(st))}, ${s.status ?? 'Not Started'}, gate ${s.gate_status ?? 'Not Ready'}${s.gate_criteria ? ` (criteria: ${clip(s.gate_criteria, 160)})` : ''}, owner ${who(s.owner_user_id)}, ${s.start_date ?? '-'} to ${s.end_date ?? '-'}; ${counts(st)}`);
      for (const a of data.activities.filter((x) => x.stage_id === s.stage_id)) {
        const at = data.tasks.filter((x) => x.activity_id === a.activity_id);
        secondary.push(`  Activity "${a.name}" (stage ${s.name}): ${pct(a.percent_complete ?? completion(at))}, owner ${who(a.owner_user_id)}, due ${a.due_date ?? '-'}, ${counts(at)}`);
      }
    }
    const open = data.tasks.filter((x) => x.status !== 'Done');
    const hot = [...open.filter((x) => x.status === 'Blocked'), ...open.filter((x) => isOverdue(x) && x.status !== 'Blocked'), ...open.filter((x) => x.day1_critical === 'Y' && x.status !== 'Blocked' && !isOverdue(x))];
    primary.push(`Items needing attention (${hot.length}):`);
    for (const x of hot.slice(0, 18)) primary.push(`- ${taskLine(x, true)}`);
    const upcoming = open.filter((x) => x.due_date && x.due_date >= today).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).slice(0, 10);
    for (const x of upcoming) secondary.push(`Upcoming: ${taskLine(x, true)}`);
  }

  if (scope.type === 'stage' && scope.stage) {
    const s = scope.stage;
    const n = src({ type: 'stage', id: s.stage_id, label: s.name, href: hrefFor('stage', { projectId: s.project_id, stageId: s.stage_id }) });
    primary.push(`Screen: stage overview of "${s.name}" [${n}] in ${p?.code_name ?? ''}.`,
      `Stage "${s.name}": ${pct(s.percent_complete ?? completion(data.tasks))} complete, status ${s.status ?? 'Not Started'}, owner ${who(s.owner_user_id)}, ${s.start_date ?? '-'} to ${s.end_date ?? '-'}, gate ${s.gate_status ?? 'Not Ready'}${s.gate_criteria ? `, gate criteria: ${s.gate_criteria}` : ''}${s.description ? `. Purpose: ${clip(s.description, 300)}` : ''}.`,
      `Stage totals: ${counts(data.tasks)}. It has ${data.activities.length} activities:`);
    for (const a of data.activities) primary.push(activityLine(a));
    const open = data.tasks.filter((x) => x.status !== 'Done');
    const hot = [...open.filter((x) => x.status === 'Blocked'), ...open.filter((x) => isOverdue(x) && x.status !== 'Blocked'), ...open.filter((x) => x.day1_critical === 'Y' && x.status !== 'Blocked' && !isOverdue(x))];
    primary.push(`Items needing attention in this stage (${hot.length}):`);
    for (const x of hot.slice(0, 20)) primary.push(`- ${taskLine(x, true)}`);
    for (const x of open.filter((x) => !hot.includes(x)).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9')).slice(0, 25)) secondary.push(`- ${taskLine(x, true)}`);
  }

  function activityLine(a: Activity) {
    const at = data.tasks.filter((x) => x.activity_id === a.activity_id);
    const n = src({ type: 'activity', id: a.activity_id, label: a.name, href: hrefFor('activity', { projectId: a.project_id, stageId: a.stage_id, activityId: a.activity_id }) });
    return `- Activity "${a.name}" [${n}]: ${pct(a.percent_complete ?? completion(at))}, ${a.status ?? '-'}, priority ${a.priority ?? '-'}, owner ${who(a.owner_user_id)}, due ${a.due_date ?? '-'}; ${counts(at)}`;
  }

  if ((scope.type === 'activity' || scope.type === 'task') && scope.activity) {
    const a = scope.activity;
    if (scope.type === 'activity') {
      primary.push(`Screen: activity "${a.name}" in stage "${scope.stage?.name ?? '-'}" of ${p?.code_name ?? ''}.`);
      primary.push(activityLine(a).replace(/^- /, ''), a.description ? `Activity purpose: ${clip(a.description, 400)}` : '');
      primary.push(`All ${data.tasks.length} tasks in this activity:`);
      const order = (x: Task) => (x.status === 'Blocked' ? 0 : isOverdue(x) ? 1 : x.status !== 'Done' ? 2 : 3);
      for (const x of [...data.tasks].sort((m, n) => order(m) - order(n) || (m.due_date || '9').localeCompare(n.due_date || '9'))) primary.push(`- ${taskLine(x)}`);
      if (scope.stage) secondary.push(`Its stage "${scope.stage.name}": ${pct(scope.stage.percent_complete)}, gate ${scope.stage.gate_status ?? 'Not Ready'}, ends ${scope.stage.end_date ?? '-'}.`);
    } else {
      secondary.push(activityLine(a).replace(/^- /, ''));
    }
  }

  if (scope.type === 'task' && scope.task) {
    const x = scope.task;
    primary.push(`Screen: task "${x.title}" (activity "${scope.activity?.name ?? '-'}", stage "${scope.stage?.name ?? '-'}", ${p?.code_name ?? ''}).`, taskLine(x),
      x.description ? `Task description: ${clip(x.description, 500)}` : '', `Start ${x.start_date ?? '-'}, completed ${x.completed_date ?? '-'}, effort ${x.effort_hours ?? '-'} h.`);
    const history = (await db.find<AuditEntry>('audit_log', (e) => e.entity_id === x.task_id && !String(e.action).startsWith('ai.') && e.action !== 'access.denied'))
      .sort((m, n) => (n.created_at || '').localeCompare(m.created_at || '')).slice(0, 8);
    for (const h of history) secondary.push(`History ${h.created_at?.slice(0, 10)}: ${h.action} by ${who(h.actor_user_id)}`);
  }

  // ------------------------------------------------------------- communications, notes, contacts, TSA (permission-filtered)
  if (scope.type !== 'global') {
    const comms = await loadComms(db, auth, scope);
    if (comms.length) {
      const block = scope.type === 'project' ? secondary : primary;
      block.push(`Communication history (${comms.length}, newest first):`);
      for (const c of comms.slice(0, scope.type === 'project' ? 6 : 10)) {
        block.push(`- ${c.occurred_at?.slice(0, 10)} ${c.channel}${c.duration_min ? ` (${c.duration_min} min)` : ''} from ${c.from_name ?? '-'} to ${c.to_name ?? '-'}: ${c.subject ?? '(no subject)'}. ${clip(c.ai_summary || c.body, 320)}`);
      }
    } else if (!cap.flags.internalComms) {
      secondary.push('Internal emails and calls are not available to this user.');
    }
    const notes = auth.code === 'CLIENT' ? [] : await loadNotes(db, scope);
    if (notes.length) {
      secondary.push(`Quick notes (${notes.length}):`);
      for (const n of notes.slice(0, 6)) secondary.push(`- ${n.created_at?.slice(0, 10)} ${who(n.created_by)}: ${clip(n.body, 240)}`);
    }
    if (cap.flags.contactsVisible && scope.type !== 'project') {
      const contacts = await loadContacts(db, auth, scope);
      if (contacts.length) {
        secondary.push(`Contacts${cap.flags.contactsFull ? '' : ' (phone/email masked for this user)'}:`);
        for (const c of contacts.slice(0, 8)) secondary.push(`- ${c.full_name}, ${c.role_title ?? ''}, ${c.org ?? ''} (${c.side ?? '-'})${c.phone ? `, ${c.phone}` : ''}${c.email ? `, ${c.email}` : ''}`);
      }
    }
    if (auth.code !== 'CLIENT' && p) {
      const tsa = (await loadTsa(db, scope)).filter((s) => s.status !== 'Exited');
      if (tsa.length) {
        secondary.push(`Active TSA services (${tsa.length}):`);
        for (const s of tsa.slice(0, 10)) secondary.push(`- ${s.name} (${s.provider ?? '-'}): exit ${s.planned_exit_date ?? '-'}, ${s.status}${fin ? `, ${money(s.monthly_fee)}/month, extension uplift ${s.extension_uplift_pct ?? '-'}%` : ''}`);
      }
    }
  }
  if (!fin) secondary.push('Finance (fees, budgets, TSA costs, funding gaps) is NOT available to this user.');

  // ------------------------------------------------------------- size cap: keep every primary fact, trim secondary
  const facts: string[] = [];
  let size = 0;
  for (const f of primary.filter(Boolean)) { facts.push(f); size += f.length; }
  let dropped = 0;
  for (const f of secondary.filter(Boolean)) {
    if (size + f.length > MAX_CHARS) { dropped++; continue; }
    facts.push(f); size += f.length;
  }
  if (dropped) facts.push(`(${dropped} lower-priority detail line(s) omitted for length.)`);
  const title = scope.task?.title ?? scope.activity?.name ?? scope.stage?.name ?? p?.code_name ?? 'Portfolio';
  return { title, facts, sources };
}
