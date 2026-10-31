/** Close-out preview: metrics, redacted knowledge items and a lessons-learned draft for the knowledge hub. */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type {
  Activity, CloseoutPreview, Communication, Contact, KnowledgeItem, Project, ProjectMember, QuickNote, Stage, Task, TsaService, User,
} from '../../../shared/types';
import { redactText } from './redact';
import { geminiConfigured, geminiGenerate } from './gemini';
import { isOverdue } from './data';
import { todayIso } from './lang';
import { auditAi } from './audit';

type Proposed = CloseoutPreview['proposedItems'][number];

const INDUSTRY_SHORT: Record<string, string> = {
  'Financial Services & Payments': 'Payments', 'Semiconductors & High-Tech': 'Semiconductor', 'Healthcare & Life Sciences': 'Healthcare',
  'Consumer & Retail': 'Consumer', 'Industrial Manufacturing': 'Industrial', 'Energy & Utilities': 'Energy', 'Telecom & Media': 'Telecom',
};

export function sourceLabel(p: Project): string {
  const ind = INDUSTRY_SHORT[p.industry ?? ''] ?? 'Cross-industry';
  const year = (p.closed_date || todayIso()).slice(0, 4);
  return `${ind} ${p.deal_type ?? 'separation'}, ${year}`;
}

export async function buildCloseoutPreview(db: Db, auth: AuthContext, project: Project): Promise<CloseoutPreview> {
  const pid = project.project_id;
  const [stages, activities, tasks, comms, notes, contacts, tsa, members, users] = await Promise.all([
    db.find<Stage>('stages', (s) => s.project_id === pid),
    db.find<Activity>('activities', (a) => a.project_id === pid),
    db.find<Task>('tasks', (t) => t.project_id === pid),
    db.find<Communication>('communications', (c) => c.project_id === pid),
    db.find<QuickNote>('quick_notes', (n) => n.project_id === pid),
    db.find<Contact>('contacts', (c) => c.project_id === pid),
    db.find<TsaService>('tsa_services', (s) => s.project_id === pid),
    db.find<ProjectMember>('project_members', (m) => m.project_id === pid),
    db.all<User>('users', { includeDeleted: true }),
  ]);
  stages.sort((a, b) => a.sort_order - b.sort_order);

  // ---- entities to redact ----
  const memberIds = new Set([...members.map((m) => m.user_id), project.partner_user_id, project.manager_user_id].filter(Boolean) as string[]);
  const entities = [
    project.client_alias ? `CLIENT:${project.client_alias}` : '',
    `CLIENT:${project.code_name}`,
    ...contacts.map((c) => `PERSON:${c.full_name}`),
    ...contacts.map((c) => (c.org ? `ORG:${c.org}` : '')),
    ...users.filter((u) => memberIds.has(u.user_id)).map((u) => `PERSON:${u.full_name}`),
  ].filter(Boolean);
  const allRedactions: CloseoutPreview['redactions'] = [];
  const R = (field: string, text: string) => {
    const r = redactText(text, entities);
    for (const x of r.redactions) if (allRedactions.length < 60) allRedactions.push({ field, original: x.original, redacted: x.redacted });
    return r.text;
  };

  // ---- metrics ----
  const done = tasks.filter((t) => t.status === 'Done').length;
  const overdue = tasks.filter(isOverdue);
  const blocked = tasks.filter((t) => t.status === 'Blocked');
  const d1 = tasks.filter((t) => t.day1_critical === 'Y');
  const durationDays = project.start_date ? Math.max(0, Math.round((Date.parse(project.closed_date || todayIso()) - Date.parse(project.start_date)) / 864e5)) : 0;
  const extended = tsa.filter((s) => s.status === 'Extended').length;
  const metrics: CloseoutPreview['metrics'] = {
    duration_days: durationDays,
    stages: stages.length,
    activities: activities.length,
    tasks_total: tasks.length,
    tasks_done_pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    overdue_at_close: overdue.length,
    blocked_at_close: blocked.length,
    day1_critical_items: d1.length,
    tsa_services: tsa.length,
    tsa_extensions: extended,
    tsa_monthly_cost: Number(project.tsa_monthly_cost ?? 0),
    funding_gap: Number(project.funding_gap ?? 0),
    communications: comms.length,
    apps_in_scope: Number(project.apps_in_scope ?? 0),
  };

  const label = sourceLabel(project);
  const consent = project.reuse_consent ?? 'Pending';
  const base = { source_project_id: pid, source_label: label, deal_type: project.deal_type, industry: project.industry, consent_status: consent, review_status: 'Pending Review' as const, reviewed_by: null, reviewed_at: null, times_used: 0 };
  const items: Proposed[] = [];

  // Stage templates: what this deal actually ran, so the next deal starts from it.
  for (const s of stages) {
    const acts = activities.filter((a) => a.stage_id === s.stage_id).sort((a, b) => a.sort_order - b.sort_order);
    if (!acts.length) continue;
    const payload = {
      activities: acts.map((a) => ({
        name: R('activity', a.name), priority: a.priority ?? 'Medium', description: R('activity', a.description ?? ''),
        tasks: tasks.filter((t) => t.activity_id === a.activity_id).slice(0, 8).map((t) => ({ title: R('task', t.title), priority: t.priority ?? 'Medium', day1_critical: t.day1_critical ?? 'N', effort_hours: t.effort_hours ?? undefined })),
      })),
    };
    items.push({ ...base, item_type: 'Stage Template', stage_name: s.name, title: `${s.name} template - ${label}`, body: R('stage', `${s.description ?? ''} Gate: ${s.gate_criteria ?? '-'}`), payload: JSON.stringify(payload), tags: [s.name, project.deal_type, project.industry].filter(Boolean).join(',') });
  }

  // Lessons (deterministic) from what slipped / got blocked / went well.
  const lessons: { title: string; body: string; stage?: string }[] = [];
  const slipByStage = new Map<string, number>();
  for (const t of [...overdue, ...blocked]) slipByStage.set(t.stage_id, (slipByStage.get(t.stage_id) ?? 0) + 1);
  const worst = [...slipByStage.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worst) {
    const s = stages.find((x) => x.stage_id === worst[0]);
    lessons.push({ stage: s?.name, title: `Start ${s?.name ?? 'critical'} dependencies earlier`, body: `${worst[1]} item(s) in ${s?.name ?? 'one stage'} were late or blocked at close. Raise long-lead items (vendor consents, circuits, licences) in the first two weeks of the stage and track them as Day-1 critical.` });
  }
  const blockedNotes = blocked.map((t) => t.dependency_notes).filter(Boolean) as string[];
  if (blockedNotes.length) lessons.push({ title: 'Recurring blockers to plan for', body: `Typical blockers on this deal: ${blockedNotes.slice(0, 3).join('; ')}. Add owners and escalation dates for these at kick-off.` });
  if (extended) lessons.push({ stage: 'TSA Exit', title: 'Avoid TSA extensions with an early exit sequence', body: `${extended} TSA service(s) needed an extension. Compare exit sequences at least 90 days before each exit date and notify the seller within the notice period.` });
  if (d1.length) lessons.push({ stage: 'Day-1 Readiness', title: 'Keep one Day-1 critical list from the inventory', body: `${d1.length} Day-1 critical items were tracked. Derive the list from the application inventory instead of a separate spreadsheet, and rehearse Day-1 at least once.` });
  if (lessons.length < 2) lessons.push({ title: 'Use the playbook from day one', body: `Starting from the separation playbook kept ${metrics.tasks_done_pct}% of ${tasks.length} tasks on plan. Reuse this deal's stage templates for similar ${project.deal_type ?? 'separation'} work.` });
  for (const l of lessons.slice(0, 4)) items.push({ ...base, item_type: 'Lesson', stage_name: l.stage, title: R('lesson', l.title), body: R('lesson', l.body), payload: null, tags: ['lesson', project.deal_type, project.industry].filter(Boolean).join(',') });

  // Risks from blocked/overdue history
  for (const t of blocked.slice(0, 3)) {
    items.push({ ...base, item_type: 'Risk', stage_name: stages.find((s) => s.stage_id === t.stage_id)?.name, title: R('risk', `Risk: ${t.title}`), body: R('risk', t.dependency_notes || t.pending_notes || 'Blocked at close.'), payload: null, tags: 'risk,blocked' });
  }

  // Metric item for benchmarks
  items.push({ ...base, item_type: 'Metric', title: `Close-out metrics - ${label}`, body: `Duration ${durationDays} days; ${metrics.tasks_done_pct}% of ${tasks.length} tasks done; ${tsa.length} TSA services (${extended} extended); ${d1.length} Day-1 critical items.`, payload: JSON.stringify(metrics), tags: 'metric,benchmark' });

  // Lessons-learned narrative
  const factLines = [
    `Deal type ${project.deal_type}, industry ${project.industry}, duration ${durationDays} days.`,
    `Tasks ${done}/${tasks.length} done; ${overdue.length} overdue and ${blocked.length} blocked at close.`,
    `TSA services ${tsa.length}, extended ${extended}.`,
    ...lessons.map((l) => `${l.title}: ${l.body}`),
    ...comms.slice(-6).map((c) => `${c.channel}: ${c.subject}`),
    ...notes.slice(0, 4).map((n) => `Note: ${n.body}`),
  ].map((l) => R('lessons', l));
  let lessonsDraft = `Lessons learned - ${label}\n\n${lessons.map((l, i) => `${i + 1}. ${R('lesson', l.title)}: ${R('lesson', l.body)}`).join('\n')}\n\nOutcome: ${metrics.tasks_done_pct}% of tasks completed over ${durationDays} days.`;
  let mode = 'offline';
  if (geminiConfigured()) {
    const g = await geminiGenerate(`Write a concise lessons-learned note (max 200 words, numbered points, plain text) for the knowledge hub of a consulting firm, from these redacted facts. Keep placeholders like [CLIENT] and [PERSON] as they are; add no names.\n${factLines.map((f) => `- ${f}`).join('\n')}`, { temperature: 0.3, maxOutputTokens: 800 });
    if (g) { lessonsDraft = R('lessons', g.text); mode = g.model; }
  }

  await auditAi(db, auth, 'ai.closeout_preview', { items: items.length, redactions: allRedactions.length, mode }, { entityType: 'project', entityId: pid, projectId: pid });
  return { project, metrics, proposedItems: items, redactions: allRedactions, lessonsDraft, mode };
}

export type { KnowledgeItem };
