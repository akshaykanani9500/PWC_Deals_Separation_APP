/**
 * "Get AI suggestion" for edit side panels. Deterministic draft from:
 *   (a) Approved knowledge-hub items (closed deals) matching deal type / industry / stage
 *   (b) the project's own data (no duplicates)
 *   (c) the built-in playbook (+ industry overlays)
 * Then, if Gemini is configured, Gemini refines the draft; invalid output falls back to the deterministic draft.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type {
  Activity, Communication, KnowledgeItem, Priority, Project, QuickNote, Stage, SuggestRequest, SuggestResponse, Task, YN,
} from '../../../shared/types';
import { PRIORITY, WORK_STATUS } from '../../../shared/schema';
import { DEFAULT_STAGES } from '../../../shared/defaults';
import { loadApprovedKnowledge, loadComms, loadNotes, resolveScope, isOverdue } from './data';
import { PLAYBOOK, playbookStage, allPlaybookActivities, type PlaybookActivity } from './playbook';
import { geminiConfigured, geminiJson } from './gemini';
import { auditAi } from './audit';
import { todayIso } from './lang';
import { AiHttpError } from './summary';

type DraftTask = { title: string; description?: string; priority: Priority; day1_critical: YN; effort_hours?: number };
type DraftActivity = { name: string; description: string; priority: Priority; tasks: DraftTask[] };
type DraftStage = { name: string; description: string; gate_criteria: string; activities: DraftActivity[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SIM_STOP = new Set(['the', 'and', 'for', 'of', 'to', 'a', 'an', 'in', 'on', 'with', 'by', 'per', 'plan', 'review']);
/** Words for similarity: lower-case, numbers dropped, light plural stemming. */
function simTokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z-]*/g) ?? [])
    .flatMap((w) => w.split('-'))
    .filter((w) => w.length > 1 && !SIM_STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}
/** Remove deal-specific sizes from past-deal names: "34-application inventory" -> "Application inventory". */
export function generalise(name: string): string {
  const out = name
    .replace(/\s*\((?:~?\d[\d,.]*\+?\s*[a-z-]+(?:\s[a-z-]+)?)\)/gi, '')
    .replace(/(^|\s)~?\d[\d,.]*\+?[-\s](?=[a-z])/gi, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out ? out[0].toUpperCase() + out.slice(1) : name;
}
export function similar(a: string, b: string): number {
  const A = new Set(simTokens(a)); const B = new Set(simTokens(b));
  if (!A.size || !B.size) return norm(a) === norm(b) ? 1 : 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}
const isDup = (name: string, existing: string[]) => existing.some((e) => norm(e) === norm(name) || similar(e, name) >= 0.75);
const addDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

function fromPlaybook(a: PlaybookActivity): DraftActivity {
  return { name: a.name, description: a.description, priority: a.priority, tasks: a.tasks.map(([title, priority, d1, h]) => ({ title, priority, day1_critical: d1, effort_hours: h })) };
}

function parsePayload(k: KnowledgeItem): any {
  try { return k.payload ? JSON.parse(k.payload) : null; } catch { return null; }
}

function knowledgeActivities(k: KnowledgeItem): DraftActivity[] {
  const p = parsePayload(k);
  const acts: any[] = Array.isArray(p?.activities) ? p.activities : [];
  return acts.filter((a) => a && typeof a.name === 'string').map((a) => ({
    name: generalise(a.name),
    description: a.description ?? `From a past ${k.deal_type ?? 'deal'} (${k.source_label ?? 'knowledge hub'}).`,
    priority: (PRIORITY as readonly string[]).includes(a.priority) ? a.priority : 'Medium',
    tasks: (Array.isArray(a.tasks) ? a.tasks : []).filter((t: any) => t && typeof t.title === 'string').map((t: any) => ({
      title: generalise(t.title), priority: (PRIORITY as readonly string[]).includes(t.priority) ? t.priority : 'Medium', day1_critical: t.day1_critical === 'Y' ? 'Y' : 'N', effort_hours: Number(t.effort_hours ?? 4),
    })),
  }));
}

interface Ctx {
  db: Db; auth: AuthContext; req: SuggestRequest; knowledge: KnowledgeItem[];
  project?: Project; stage?: Stage; activity?: Activity; task?: Task;
  usedKnowledge: Map<string, KnowledgeItem>;
}

function matchKnowledge(ctx: Ctx, type: KnowledgeItem['item_type'], stageName?: string): KnowledgeItem[] {
  const dealType = ctx.req.hints?.deal_type ?? ctx.project?.deal_type;
  const industry = ctx.req.hints?.industry ?? ctx.project?.industry;
  return ctx.knowledge
    .filter((k) => k.item_type === type)
    .filter((k) => !stageName || similar(k.stage_name ?? '', stageName) >= 0.6 || norm(k.stage_name ?? '') === norm(stageName))
    .map((k) => ({ k, s: (k.deal_type === dealType ? 2 : 0) + (k.industry === industry ? 2 : 0) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.k);
}

/** Activities for a stage name: knowledge first, then playbook + overlay, de-duplicated. */
function activitiesForStage(ctx: Ctx, stageName: string, existing: string[] = [], limit = 6): DraftActivity[] {
  const industry = ctx.req.hints?.industry ?? ctx.project?.industry;
  const out: DraftActivity[] = [];
  const names = [...existing];
  for (const k of matchKnowledge(ctx, 'Stage Template', stageName).slice(0, 2)) {
    for (const a of knowledgeActivities(k)) {
      if (out.length >= limit) break;
      if (isDup(a.name, names)) continue;
      out.push(a); names.push(a.name); ctx.usedKnowledge.set(k.knowledge_id, k);
    }
  }
  for (const a of (playbookStage(stageName, industry)?.activities ?? [])) {
    if (out.length >= limit) break;
    if (isDup(a.name, names)) continue;
    out.push(fromPlaybook(a)); names.push(a.name);
  }
  return out;
}

function stageDraft(ctx: Ctx, name: string): DraftStage {
  const pb = playbookStage(name) ?? PLAYBOOK.find((s) => similar(s.name, name) >= 0.6);
  return {
    name: pb?.name ?? name,
    description: pb?.description ?? `Plan and deliver the ${name} workstream.`,
    gate_criteria: pb?.gate_criteria ?? `${name} deliverables reviewed and approved by the engagement partner.`,
    activities: activitiesForStage(ctx, pb?.name ?? name),
  };
}

function tasksForActivity(ctx: Ctx, activityName: string, existing: string[] = []): DraftTask[] {
  const industry = ctx.project?.industry ?? ctx.req.hints?.industry;
  const candidates: { a: DraftActivity; s: number }[] = [];
  for (const a of allPlaybookActivities(industry)) candidates.push({ a: fromPlaybook(a), s: similar(a.name, activityName) });
  for (const k of ctx.knowledge.filter((k) => k.item_type === 'Stage Template' || k.item_type === 'Activity Template')) {
    for (const a of knowledgeActivities(k)) {
      const s = similar(a.name, activityName) + 0.05; // tiny preference for real past deals
      if (s >= 0.5) ctx.usedKnowledge.set(k.knowledge_id, k);
      candidates.push({ a, s });
    }
  }
  candidates.sort((x, y) => y.s - x.s);
  const best = candidates[0];
  let tasks: DraftTask[] = best && best.s >= 0.34 ? best.a.tasks : [];
  if (tasks.length < 3) {
    const n = activityName.replace(/\.$/, '');
    tasks = [...tasks,
      { title: `Confirm scope, owners and success criteria for ${n}`, priority: 'High', day1_critical: 'N', effort_hours: 3 },
      { title: `Collect inputs and data needed for ${n}`, priority: 'Medium', day1_critical: 'N', effort_hours: 6 },
      { title: `Identify dependencies and risks for ${n}`, priority: 'High', day1_critical: 'N', effort_hours: 4 },
      { title: `Execute and track ${n}`, priority: 'High', day1_critical: 'N', effort_hours: 12 },
      { title: `Review and sign off ${n} with the manager`, priority: 'Medium', day1_critical: 'N', effort_hours: 2 },
    ];
  }
  return tasks.filter((x) => !isDup(x.title, existing)).slice(0, 6).map((x) => ({ ...x, description: x.description ?? `Part of "${activityName}".` }));
}

async function deterministic(ctx: Ctx): Promise<{ draft: SuggestResponse['draft']; rationale: string }> {
  const { db, req } = ctx;
  switch (req.kind) {
    case 'project': {
      const h = req.hints ?? {};
      const stages = DEFAULT_STAGES.map((s) => stageDraft(ctx, s.name));
      const used = ctx.usedKnowledge.size;
      return {
        draft: {
          name: h.name || (req.current?.code_name as string) || undefined,
          description: h.description || `${h.deal_type ?? 'Separation'} engagement${h.industry ? ` in ${h.industry}` : ''}: plan, Day-1 readiness, TSA exit and close-out.`,
          deal_type: h.deal_type, industry: h.industry, stages,
        },
        rationale: `Five standard separation stages with ${stages.reduce((s, x) => s + x.activities.length, 0)} activities. ${used ? `${used} item(s) reused from approved past deals with the same deal type/industry; ` : ''}the rest comes from the default separation playbook${h.industry ? ` plus the ${h.industry} overlay` : ''}.`,
      };
    }
    case 'stages': {
      const existing = ctx.project ? (await db.find<Stage>('stages', (s) => s.project_id === ctx.project!.project_id)).map((s) => s.name) : [];
      const missing = DEFAULT_STAGES.filter((s) => !isDup(s.name, existing)).map((s) => stageDraft(ctx, s.name));
      const extra: DraftStage[] = [];
      if (!isDup('Hypercare & Stabilisation', existing)) extra.push({ name: 'Hypercare & Stabilisation', description: 'Support the business in the weeks after Day-1 and close remaining defects.', gate_criteria: 'No open Sev-1/Sev-2 issues for two weeks; hand-over to run teams signed.', activities: [] });
      return { draft: [...missing, ...extra], rationale: missing.length ? `Your project is missing ${missing.length} standard stage(s): ${missing.map((m) => m.name).join(', ')}.` : 'All standard stages exist; an optional hypercare stage is suggested.' };
    }
    case 'stage': {
      const name = String(req.current?.name ?? ctx.stage?.name ?? '').trim();
      const d = stageDraft(ctx, name || 'Day-1 Readiness');
      return { draft: { name: d.name, description: (req.current?.description as string) || d.description, gate_criteria: d.gate_criteria }, rationale: `Description and gate criteria from the standard "${d.name}" stage.` };
    }
    case 'activities': {
      const stage = ctx.stage;
      if (!stage) throw new AiHttpError(400, 'stageId is required');
      const existing = (await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id)).map((a) => a.name);
      const acts = activitiesForStage(ctx, stage.name, existing, 5);
      return { draft: acts, rationale: acts.length ? `${acts.length} activities that ${stage.name} stages usually have and this stage does not yet include.` : 'This stage already covers the standard activities.' };
    }
    case 'activity': {
      const stage = ctx.stage ?? (ctx.activity ? await db.get<Stage>('stages', ctx.activity.stage_id) : undefined);
      const name = String(req.current?.name ?? ctx.activity?.name ?? '').trim();
      let match: DraftActivity | undefined;
      if (name) {
        const pool = allPlaybookActivities(ctx.project?.industry).map(fromPlaybook);
        match = pool.map((a) => ({ a, s: similar(a.name, name) })).sort((x, y) => y.s - x.s).find((x) => x.s >= 0.34)?.a;
      }
      if (!match && stage) {
        const existing = (await db.find<Activity>('activities', (a) => a.stage_id === stage.stage_id)).map((a) => a.name);
        match = activitiesForStage(ctx, stage.name, existing, 1)[0];
      }
      const due = stage?.end_date && stage.end_date > todayIso() ? stage.end_date : addDays(21);
      return {
        draft: { name: name || match?.name || 'New activity', description: (req.current?.description as string) || match?.description || '', priority: match?.priority ?? 'Medium', due_date: (req.current?.due_date as string) || due },
        rationale: match ? `Based on the standard activity "${match.name}".` : 'Generic activity draft; refine the name and description.',
      };
    }
    case 'tasks': {
      const act = ctx.activity;
      if (!act) throw new AiHttpError(400, 'activityId is required');
      const existing = (await db.find<Task>('tasks', (t) => t.activity_id === act.activity_id)).map((t) => t.title);
      const tasks = tasksForActivity(ctx, act.name, existing);
      return { draft: tasks, rationale: tasks.length ? `${tasks.length} tasks typically needed for "${act.name}" that are not on the list yet.` : 'The activity already has the typical tasks.' };
    }
    case 'task': {
      const task = ctx.task;
      if (!task) throw new AiHttpError(400, 'taskId is required');
      const scope = { type: 'task' as const, projectIds: [task.project_id], task };
      const [comms, notes]: [Communication[], QuickNote[]] = await Promise.all([loadComms(db, ctx.auth, scope), loadNotes(db, scope)]);
      const text = [...comms.map((c) => `${c.subject} ${c.body}`), ...notes.map((n) => n.body)].join(' \n ').toLowerCase();
      const patch: Record<string, unknown> = {};
      const why: string[] = [];
      const latest = comms[0];
      if (/\b(blocked|waiting (for|on)|awaiting|on hold|pending (approval|consent|sign-off)|cannot proceed|stuck)\b/.test(text) && task.status !== 'Done') {
        patch.status = 'Blocked';
        const m = text.match(/(waiting (for|on)[^.\n]{3,80}|awaiting[^.\n]{3,80}|pending (approval|consent|sign-off)[^.\n]{0,60})/);
        patch.dependency_notes = task.dependency_notes || (m ? m[0].replace(/^\w/, (c) => c.toUpperCase()) : 'Waiting on an external dependency (see latest email).');
        why.push('recent messages say the work is waiting on someone');
      } else if (/\b(completed|done|signed off|closed|delivered|finished)\b/.test(text) && task.status !== 'Done' && Number(task.percent_complete ?? 0) >= 60) {
        patch.status = 'Done'; why.push('messages report it as completed');
      } else if (task.status === 'Not Started' && (comms.length || notes.length)) {
        patch.status = 'In Progress'; why.push('there is recorded activity on it');
      }
      if (isOverdue(task)) {
        patch.due_date = addDays(7);
        if (task.priority !== 'Critical') patch.priority = task.priority === 'High' ? 'Critical' : 'High';
        why.push('it is overdue, so a new date one week out and a higher priority are proposed');
      }
      if (latest && !task.pending_notes) {
        patch.pending_notes = `Follow up on "${latest.subject ?? latest.channel}" (${latest.occurred_at?.slice(0, 10)}).`;
        why.push('the latest message implies a follow-up');
      }
      if (!task.description) patch.description = `Deliver "${task.title}" and record the outcome in this task.`;
      if (!Object.keys(patch).length) why.push('nothing in the history suggests a change; current values look right');
      return { draft: patch, rationale: `Suggested because ${why.join('; ')}.` };
    }
  }
}

function validDraft(kind: SuggestRequest['kind'], d: any): boolean {
  const isTask = (t: any) => t && typeof t.title === 'string';
  const isAct = (a: any) => a && typeof a.name === 'string' && (a.tasks === undefined || (Array.isArray(a.tasks) && a.tasks.every(isTask)));
  const isStage = (s: any) => s && typeof s.name === 'string' && (s.activities === undefined || (Array.isArray(s.activities) && s.activities.every(isAct)));
  switch (kind) {
    case 'project': return d && typeof d === 'object' && Array.isArray(d.stages) && d.stages.length > 0 && d.stages.every(isStage);
    case 'stages': return Array.isArray(d) && d.every(isStage);
    case 'activities': return Array.isArray(d) && d.every(isAct);
    case 'tasks': return Array.isArray(d) && d.every(isTask);
    case 'stage': case 'activity': return d && typeof d === 'object' && !Array.isArray(d) && typeof d.name === 'string';
    case 'task': return d && typeof d === 'object' && !Array.isArray(d) && (!d.status || (WORK_STATUS as readonly string[]).includes(d.status)) && (!d.priority || (PRIORITY as readonly string[]).includes(d.priority));
  }
}

/** Normalise enum values that Gemini might return in a different case. */
function cleanDraft(d: any): any {
  const fix = (o: any) => {
    if (o && typeof o === 'object') {
      if (o.priority && !(PRIORITY as readonly string[]).includes(o.priority)) o.priority = 'Medium';
      if (o.day1_critical !== undefined) o.day1_critical = o.day1_critical === 'Y' || o.day1_critical === true ? 'Y' : 'N';
      for (const k of ['activities', 'tasks', 'stages']) if (Array.isArray(o[k])) o[k].forEach(fix);
    }
  };
  if (Array.isArray(d)) d.forEach(fix); else fix(d);
  return d;
}

export async function suggest(db: Db, auth: AuthContext, req: SuggestRequest): Promise<SuggestResponse> {
  const { scope } = await resolveScope(db, auth, { projectId: req.projectId, stageId: req.stageId, activityId: req.activityId, taskId: req.taskId });
  // ids the user cannot see are dropped by resolveScope; refuse instead of silently ignoring them
  if ((req.taskId && !scope.task) || (req.activityId && !scope.activity) || (req.stageId && !scope.stage) || (req.projectId && !scope.project)) {
    throw new AiHttpError(404, 'Not found');
  }
  const ctx: Ctx = {
    db, auth, req, knowledge: await loadApprovedKnowledge(db),
    project: scope.project, stage: scope.stage, activity: scope.activity, task: scope.task, usedKnowledge: new Map(),
  };
  const det = await deterministic(ctx);
  let draft = det.draft;
  let rationale = det.rationale;
  let mode = 'offline';

  if (geminiConfigured() && req.kind !== 'task') {
    const context = {
      kind: req.kind, project: ctx.project ? { name: ctx.project.code_name, deal_type: ctx.project.deal_type, industry: ctx.project.industry, description: ctx.project.description } : req.hints,
      stage: ctx.stage?.name, activity: ctx.activity?.name, current: req.current,
    };
    const g = await geminiJson<{ draft: unknown; rationale: string }>(
      `You help a PwC deals team plan an IT separation. Improve this draft "${req.kind}" suggestion for the context below. Keep the exact JSON shape of the draft, keep good items, make names specific and practical, remove anything irrelevant, max 6 items per list. Allowed priority: ${PRIORITY.join('/')}; day1_critical: "Y"/"N".\nCONTEXT: ${JSON.stringify(context)}\nDRAFT: ${JSON.stringify(draft)}\nReturn JSON {"draft": <same shape as DRAFT>, "rationale": "one or two sentences"}.`,
      { temperature: 0.3, maxOutputTokens: 4096 },
    );
    if (g && validDraft(req.kind, g.data?.draft)) {
      draft = cleanDraft(g.data.draft) as SuggestResponse['draft'];
      rationale = typeof g.data.rationale === 'string' ? g.data.rationale : rationale;
      mode = g.model;
    }
  }

  // count knowledge reuse
  for (const k of ctx.usedKnowledge.values()) {
    try { await db.update('knowledge_items', k.knowledge_id, { times_used: Number(k.times_used ?? 0) + 1 }, auth.user.user_id); } catch { /* ignore */ }
  }
  const sources = [
    ...Array.from(ctx.usedKnowledge.values()).map((k) => ({ id: k.knowledge_id, label: `${k.source_label ?? 'Past deal'} · ${k.title}` })),
    { id: 'playbook', label: 'Deals Stack separation playbook' },
  ];
  await auditAi(db, auth, 'ai.suggest', { kind: req.kind, mode, knowledgeUsed: ctx.usedKnowledge.size }, {
    entityType: req.kind, entityId: req.taskId ?? req.activityId ?? req.stageId ?? req.projectId ?? null, projectId: ctx.project?.project_id ?? null,
  });
  return { kind: req.kind, mode, rationale, sources, draft };
}
