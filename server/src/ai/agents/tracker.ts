/** Tracker agent: projects, stages, activities, tasks (status, overdue, blocked, owners, next steps, risk). */
import type { Task } from '../../../../shared/types';
import { completion, hrefFor, isOverdue, pct, taskHref, userName } from '../data';
import { fmtDate, t, todayIso } from '../lang';
import type { AgentInput, AgentOutput } from './types';
import { emptyOutput } from './types';

const MAX = 6;

export async function trackerAgent(input: AgentInput): Promise<AgentOutput> {
  const { data, lang, intents, auth, message } = input;
  const out = emptyOutput('tracker');
  const { scope, users } = data;
  const projectById = new Map(data.projects.map((p) => [p.project_id, p]));
  const code = (pid: string) => projectById.get(pid)?.code_name ?? pid;
  const open = data.tasks.filter((x) => x.status !== 'Done');
  const overdue = open.filter(isOverdue).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  const blocked = open.filter((x) => x.status === 'Blocked');

  const addTaskSource = (x: Task) => out.sources.push({ type: 'task', id: x.task_id, label: x.title, href: taskHref(x) });
  const taskLine = (x: Task, withProject: boolean) =>
    `${x.title}${withProject ? ` (${code(x.project_id)})` : ''} - ${userName(users, x.assignee_user_id)}, ${t(lang, 'due', 'नियत तिथि')} ${fmtDate(x.due_date)}`;
  const multi = scope.type === 'global';

  const has = (i: string) => intents.includes(i as any);

  // ---------- STATUS ----------
  if (has('status') || has('list_projects') || has('summary')) {
    if (scope.type === 'global') {
      const active = data.projects.filter((p) => p.status !== 'Closed');
      const n = (r: string) => active.filter((p) => p.rag === r).length;
      out.lines.push(t(lang,
        `You can see ${active.length} active project(s): ${n('Red')} Red, ${n('Amber')} Amber, ${n('Green')} Green.`,
        `आप ${active.length} सक्रिय प्रोजेक्ट देख सकते हैं: ${n('Red')} लाल, ${n('Amber')} एम्बर, ${n('Green')} हरे।`));
      out.facts.push(`Visible active projects: ${active.length}; RAG Red ${n('Red')}, Amber ${n('Amber')}, Green ${n('Green')}.`);
      for (const p of active.slice(0, 8)) {
        const stageName = data.stages.find((s) => s.stage_id === p.current_stage_id)?.name ?? '-';
        const line = `${p.code_name}: ${p.status}, ${p.rag ?? '-'} RAG, ${pct(p.percent_complete)} ${t(lang, 'complete, stage', 'पूरा, चरण')} ${stageName}`;
        out.lines.push(`- ${line}`);
        out.facts.push(line);
        out.sources.push({ type: 'project', id: p.project_id, label: p.code_name, href: hrefFor('project', { projectId: p.project_id }) });
      }
    } else if (scope.type === 'project' && scope.project) {
      const p = projectById.get(scope.project.project_id) ?? scope.project;
      const stageName = data.stages.find((s) => s.stage_id === p.current_stage_id)?.name ?? '-';
      const done = data.tasks.filter((x) => x.status === 'Done').length;
      const pc = p.percent_complete ?? completion(data.tasks);
      out.lines.push(t(lang,
        `**${p.code_name}** is ${p.status} (${p.rag ?? '-'} RAG), ${pct(pc)} complete. Current stage: **${stageName}**. Tasks: ${done}/${data.tasks.length} done, ${overdue.length} overdue, ${blocked.length} blocked.`,
        `**${p.code_name}** की स्थिति: ${p.status} (${p.rag ?? '-'} RAG), ${pct(pc)} पूरा। मौजूदा चरण: **${stageName}**। टास्क: ${done}/${data.tasks.length} पूरे, ${overdue.length} देरी में, ${blocked.length} रुके हुए।`));
      out.facts.push(`Project ${p.code_name}: status ${p.status}, RAG ${p.rag}, ${pct(pc)} complete, current stage ${stageName}, target close ${p.target_close_date}; tasks ${done}/${data.tasks.length} done, ${overdue.length} overdue, ${blocked.length} blocked.`);
      out.sources.push({ type: 'project', id: p.project_id, label: p.code_name, href: hrefFor('project', { projectId: p.project_id }) });
      for (const s of data.stages) {
        const st = data.tasks.filter((x) => x.stage_id === s.stage_id);
        const line = `${s.name}: ${pct(s.percent_complete ?? completion(st))} (${s.status ?? 'Not Started'}${s.gate_status ? `, gate ${s.gate_status}` : ''})`;
        out.lines.push(`- ${line}`);
        out.facts.push(`Stage ${line}`);
      }
    } else if (scope.type === 'stage' && scope.stage) {
      const s = scope.stage;
      out.lines.push(t(lang,
        `Stage **${s.name}** is ${pct(s.percent_complete ?? completion(data.tasks))} complete (${s.status ?? 'Not Started'}), gate: ${s.gate_status ?? 'Not Ready'}. Owner: ${userName(users, s.owner_user_id)}.`,
        `चरण **${s.name}** ${pct(s.percent_complete ?? completion(data.tasks))} पूरा है (${s.status ?? 'Not Started'}), गेट: ${s.gate_status ?? 'Not Ready'}। ज़िम्मेदार: ${userName(users, s.owner_user_id)}।`));
      out.facts.push(`Stage ${s.name}: ${pct(s.percent_complete)} complete, status ${s.status}, gate ${s.gate_status}, owner ${userName(users, s.owner_user_id)}, ends ${s.end_date}.`);
      out.sources.push({ type: 'stage', id: s.stage_id, label: s.name, href: hrefFor('stage', { projectId: s.project_id, stageId: s.stage_id }) });
      for (const a of data.activities) {
        const at = data.tasks.filter((x) => x.activity_id === a.activity_id);
        const line = `${a.name}: ${pct(a.percent_complete ?? completion(at))}, ${at.filter((x) => x.status === 'Done').length}/${at.length} ${t(lang, 'tasks done', 'टास्क पूरे')}`;
        out.lines.push(`- ${line}`);
        out.facts.push(`Activity ${line}, owner ${userName(users, a.owner_user_id)}`);
      }
    } else if (scope.type === 'activity' && scope.activity) {
      const a = scope.activity;
      const done = data.tasks.filter((x) => x.status === 'Done').length;
      out.lines.push(t(lang,
        `Activity **${a.name}** is ${pct(a.percent_complete ?? completion(data.tasks))} complete: ${done}/${data.tasks.length} tasks done, ${overdue.length} overdue, ${blocked.length} blocked. Owner: ${userName(users, a.owner_user_id)}, due ${fmtDate(a.due_date)}.`,
        `गतिविधि **${a.name}** ${pct(a.percent_complete ?? completion(data.tasks))} पूरी है: ${done}/${data.tasks.length} टास्क पूरे, ${overdue.length} देरी में, ${blocked.length} रुके हुए। ज़िम्मेदार: ${userName(users, a.owner_user_id)}, अंतिम तिथि ${fmtDate(a.due_date)}।`));
      out.facts.push(`Activity ${a.name}: ${pct(a.percent_complete)} complete, ${done}/${data.tasks.length} tasks done, ${overdue.length} overdue, ${blocked.length} blocked, owner ${userName(users, a.owner_user_id)}, due ${a.due_date}.`);
      out.sources.push({ type: 'activity', id: a.activity_id, label: a.name, href: hrefFor('activity', { projectId: a.project_id, stageId: a.stage_id, activityId: a.activity_id }) });
      for (const x of data.tasks.slice(0, 10)) out.facts.push(`Task "${x.title}": ${x.status}, ${x.assignee_user_id ? userName(users, x.assignee_user_id) : 'unassigned'}, due ${x.due_date}${x.pending_notes ? `, pending: ${x.pending_notes}` : ''}`);
    } else if (scope.type === 'task' && scope.task) {
      const x = scope.task;
      out.lines.push(t(lang,
        `Task **${x.title}** is ${x.status} (${pct(x.status === 'Done' ? 100 : x.percent_complete)}), assigned to ${userName(users, x.assignee_user_id)}, due ${fmtDate(x.due_date)}${isOverdue(x) ? ' - overdue' : ''}.`,
        `टास्क **${x.title}** की स्थिति ${x.status} (${pct(x.status === 'Done' ? 100 : x.percent_complete)}) है, ${userName(users, x.assignee_user_id)} को सौंपा गया, अंतिम तिथि ${fmtDate(x.due_date)}${isOverdue(x) ? ' - देरी में' : ''}।`));
      if (x.done_notes) out.lines.push(`${t(lang, 'Done so far', 'अब तक पूरा')}: ${x.done_notes}`);
      if (x.pending_notes) out.lines.push(`${t(lang, 'Pending', 'बाकी')}: ${x.pending_notes}`);
      if (x.dependency_notes) out.lines.push(`${t(lang, 'Waiting on', 'निर्भरता')}: ${x.dependency_notes}`);
      out.facts.push(`Task ${x.title}: status ${x.status}, assignee ${userName(users, x.assignee_user_id)}, due ${x.due_date}, done notes: ${x.done_notes ?? '-'}, pending: ${x.pending_notes ?? '-'}, dependency: ${x.dependency_notes ?? '-'}`);
      addTaskSource(x);
    }
  }

  // ---------- MY TASKS ----------
  if (has('my_tasks')) {
    const mine = open.filter((x) => x.assignee_user_id === auth.user.user_id).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));
    out.lines.push(mine.length
      ? t(lang, `You have ${mine.length} open task(s). Most urgent:`, `आपके ${mine.length} खुले टास्क हैं। सबसे ज़रूरी:`)
      : t(lang, 'You have no open tasks assigned to you here.', 'यहाँ आपको कोई खुला टास्क नहीं सौंपा गया है।'));
    for (const x of mine.slice(0, MAX)) { out.lines.push(`- ${taskLine(x, true)}${isOverdue(x) ? ' ⚠' : ''}`); out.facts.push(`My task: ${taskLine(x, true)}, status ${x.status}`); addTaskSource(x); }
  }

  // ---------- OVERDUE ----------
  if (has('overdue') || has('risk')) {
    out.lines.push(overdue.length
      ? t(lang, `${overdue.length} task(s) are overdue:`, `${overdue.length} टास्क देरी में हैं:`)
      : t(lang, 'Nothing is overdue here.', 'यहाँ कुछ भी देरी में नहीं है।'));
    for (const x of overdue.slice(0, MAX)) { out.lines.push(`- ${taskLine(x, multi)}`); out.facts.push(`Overdue: ${taskLine(x, true)}, priority ${x.priority}, Day-1 critical ${x.day1_critical}`); addTaskSource(x); }
  }

  // ---------- BLOCKED ----------
  if (has('blocked') || has('risk')) {
    out.lines.push(blocked.length
      ? t(lang, `${blocked.length} task(s) are blocked:`, `${blocked.length} टास्क रुके हुए हैं:`)
      : t(lang, 'No blocked tasks.', 'कोई टास्क रुका हुआ नहीं है।'));
    for (const x of blocked.slice(0, MAX)) {
      out.lines.push(`- ${x.title}${multi ? ` (${code(x.project_id)})` : ''}${x.dependency_notes ? ` - ${t(lang, 'waiting on', 'निर्भर')}: ${x.dependency_notes}` : ''}`);
      out.facts.push(`Blocked: ${x.title} (${code(x.project_id)}), assignee ${userName(users, x.assignee_user_id)}, waiting on: ${x.dependency_notes ?? 'not recorded'}`);
      addTaskSource(x);
    }
  }

  // ---------- RISK extras ----------
  if (has('risk')) {
    const d1 = open.filter((x) => x.day1_critical === 'Y');
    if (d1.length) {
      out.lines.push(t(lang, `${d1.length} Day-1 critical item(s) are still open.`, `${d1.length} Day-1 क्रिटिकल आइटम अभी खुले हैं।`));
      out.facts.push(`Open Day-1 critical tasks: ${d1.length}: ${d1.slice(0, 5).map((x) => x.title).join('; ')}`);
    }
    if (scope.type === 'global') {
      const attention = data.projects.filter((p) => p.status !== 'Closed' && (p.rag === 'Red' || p.rag === 'Amber' || p.status === 'At Risk'));
      if (attention.length) {
        out.lines.unshift(t(lang, `Projects needing attention: ${attention.map((p) => `${p.code_name} (${p.rag ?? p.status})`).join(', ')}.`, `ध्यान देने वाले प्रोजेक्ट: ${attention.map((p) => `${p.code_name} (${p.rag ?? p.status})`).join(', ')}।`));
        out.facts.push(`Projects with Amber/Red RAG or At Risk: ${attention.map((p) => `${p.code_name} ${p.rag} ${p.status}`).join('; ')}`);
      } else {
        out.lines.unshift(t(lang, 'All your projects are Green.', 'आपके सभी प्रोजेक्ट हरे (Green) हैं।'));
      }
    }
  }

  // ---------- WHO ----------
  if (has('who')) {
    const lower = message.toLowerCase();
    const person = Array.from(users.values()).find((u) => {
      const first = u.full_name.split(' ')[0].toLowerCase();
      return first.length >= 3 && new RegExp(`\\b${first}\\b`).test(lower);
    });
    if (person) {
      const theirs = open.filter((x) => x.assignee_user_id === person.user_id);
      out.lines.push(t(lang, `${person.full_name} has ${theirs.length} open task(s) here:`, `${person.full_name} के पास यहाँ ${theirs.length} खुले टास्क हैं:`));
      for (const x of theirs.slice(0, MAX)) { out.lines.push(`- ${taskLine(x, multi)}`); out.facts.push(`${person.full_name} task: ${taskLine(x, true)} status ${x.status}`); addTaskSource(x); }
    } else if (scope.type === 'task' && scope.task) {
      out.lines.push(t(lang, `This task is assigned to ${userName(users, scope.task.assignee_user_id)}.`, `यह टास्क ${userName(users, scope.task.assignee_user_id)} को सौंपा गया है।`));
      out.facts.push(`Task assignee: ${userName(users, scope.task.assignee_user_id)}`);
    } else if (scope.type === 'activity' && scope.activity) {
      out.lines.push(t(lang, `Activity owner: ${userName(users, scope.activity.owner_user_id)}. Assignees:`, `गतिविधि के ज़िम्मेदार: ${userName(users, scope.activity.owner_user_id)}। टास्क किसके पास:`));
      const byPerson = new Map<string, number>();
      for (const x of open) byPerson.set(userName(users, x.assignee_user_id), (byPerson.get(userName(users, x.assignee_user_id)) ?? 0) + 1);
      for (const [n, c] of byPerson) { out.lines.push(`- ${n}: ${c} ${t(lang, 'open', 'खुले')}`); out.facts.push(`${n} has ${c} open tasks in this activity`); }
    } else if (scope.type === 'stage' && scope.stage) {
      out.lines.push(t(lang, `Stage owner: ${userName(users, scope.stage.owner_user_id)}.`, `चरण के ज़िम्मेदार: ${userName(users, scope.stage.owner_user_id)}।`));
      for (const a of data.activities) out.lines.push(`- ${a.name}: ${userName(users, a.owner_user_id)}`);
      out.facts.push(`Stage owner ${userName(users, scope.stage.owner_user_id)}; activity owners: ${data.activities.map((a) => `${a.name}=${userName(users, a.owner_user_id)}`).join('; ')}`);
    } else {
      for (const p of data.projects.slice(0, 8)) {
        const line = `${p.code_name}: ${t(lang, 'Partner', 'पार्टनर')} ${userName(users, p.partner_user_id)}, ${t(lang, 'Manager', 'मैनेजर')} ${userName(users, p.manager_user_id)}`;
        out.lines.push(`- ${line}`);
        out.facts.push(line);
      }
    }
  }

  // ---------- NEXT STEPS ----------
  if (has('next_steps') || has('summary')) {
    const today = todayIso();
    const soon = open.filter((x) => !isOverdue(x)).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));
    const upcoming = soon.filter((x) => x.due_date && x.due_date >= today).slice(0, 5);
    if (upcoming.length) {
      out.lines.push(t(lang, 'Next up:', 'आगे के काम:'));
      for (const x of upcoming) { out.lines.push(`- ${taskLine(x, multi)}${x.pending_notes ? ` - ${x.pending_notes}` : ''}`); out.facts.push(`Upcoming: ${taskLine(x, true)}; pending: ${x.pending_notes ?? '-'}`); addTaskSource(x); }
    } else if (has('next_steps')) {
      out.lines.push(t(lang, 'No upcoming deadlines in this scope.', 'इस दायरे में कोई आगामी समय-सीमा नहीं है।'));
    }
  }

  // de-duplicate sources
  const seen = new Set<string>();
  out.sources = out.sources.filter((s) => (seen.has(s.type + s.id) ? false : (seen.add(s.type + s.id), true))).slice(0, 8);
  return out;
}
