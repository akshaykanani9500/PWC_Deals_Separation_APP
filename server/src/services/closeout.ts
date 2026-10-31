/**
 * Close-out preview. The real (AI-assisted) version lives in server/src/ai/contract.ts (Agent 3).
 * This local version is the safety net used when the AI module is not available.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Activity, CloseoutPreview, Communication, Contact, Project, Stage, Task, TsaService } from '../../../shared/types';
import * as ai from '../ai/contract';
import { byOrder } from '../routes/helpers';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function localRedact(text: string, known: string[]): { text: string; redactions: { original: string; redacted: string }[] } {
  const redactions: { original: string; redacted: string }[] = [];
  let out = text || '';
  const sorted = [...new Set(known.filter((k) => k && k.length > 2))].sort((a, b) => b.length - a.length);
  for (const k of sorted) {
    const re = new RegExp(esc(k), 'gi');
    if (re.test(out)) { out = out.replace(re, '[REDACTED]'); redactions.push({ original: k, redacted: '[REDACTED]' }); }
  }
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => { redactions.push({ original: m, redacted: '[EMAIL]' }); return '[EMAIL]'; });
  out = out.replace(/\+?\d[\d\s-]{8,}\d/g, (m) => { redactions.push({ original: m, redacted: '[PHONE]' }); return '[PHONE]'; });
  return { text: out, redactions };
}

async function localPreview(db: Db, project: Project): Promise<CloseoutPreview> {
  const stages = (await db.find<Stage>('stages', (s) => s.project_id === project.project_id)).sort(byOrder);
  const acts = await db.find<Activity>('activities', (a) => a.project_id === project.project_id);
  const tasks = await db.find<Task>('tasks', (t) => t.project_id === project.project_id);
  const tsa = await db.find<TsaService>('tsa_services', (s) => s.project_id === project.project_id);
  const contacts = await db.find<Contact>('contacts', (c) => c.project_id === project.project_id);
  const comms = await db.find<Communication>('communications', (c) => c.project_id === project.project_id);
  const known = [project.code_name, project.code_name.replace(/^Project\s+/i, ''), project.client_alias || '', ...contacts.map((c) => c.full_name), ...contacts.map((c) => c.org || '')];
  const allRedactions: CloseoutPreview['redactions'] = [];
  const red = (field: string, text: string) => {
    const r = localRedact(text, known);
    for (const x of r.redactions) allRedactions.push({ field, ...x });
    return r.text;
  };
  const label = `${project.industry || 'Deal'} ${project.deal_type?.toLowerCase() || 'separation'} (anonymised)`;
  const proposedItems: CloseoutPreview['proposedItems'] = stages.map((s) => ({
    source_project_id: project.project_id, source_label: label, item_type: 'Stage Template', deal_type: project.deal_type, industry: project.industry,
    stage_name: s.name, title: `${s.name} playbook - ${label}`, body: red(`stage:${s.name}`, s.description || ''),
    payload: JSON.stringify({
      stage: { name: s.name, description: red(`stage:${s.name}`, s.description || ''), gate_criteria: s.gate_criteria },
      activities: acts.filter((a) => a.stage_id === s.stage_id).sort(byOrder).map((a) => ({
        name: red(`activity:${a.name}`, a.name), description: red(`activity:${a.name}`, a.description || ''), priority: a.priority,
        tasks: tasks.filter((t) => t.activity_id === a.activity_id).map((t) => ({ title: red(`task:${t.title}`, t.title), priority: t.priority, day1_critical: t.day1_critical, effort_hours: t.effort_hours })),
      })),
    }),
    tags: `${s.name.toLowerCase()},template`, consent_status: project.reuse_consent || 'Pending', review_status: 'Pending Review',
    reviewed_by: null, reviewed_at: null, times_used: 0,
  }));
  const blocked = tasks.filter((t) => t.dependency_notes).slice(0, 5).map((t) => `- ${red('task', t.title)}: ${red('dependency', t.dependency_notes || '')}`);
  const lessonsDraft = [
    `Lessons learned - ${label}`,
    `What went well: ${tasks.filter((t) => t.status === 'Done').length} of ${tasks.length} tasks completed across ${stages.length} stages.`,
    `What slowed us down:`, ...blocked,
    `Recommendation: start long-lead items (circuits, licence consents) earlier and model TSA exit order before signing.`,
  ].join('\n');
  const metrics: Record<string, number | string> = {
    stages: stages.length, activities: acts.length, tasks: tasks.length, tasks_done: tasks.filter((t) => t.status === 'Done').length,
    day1_critical_tasks: tasks.filter((t) => t.day1_critical === 'Y').length, tsa_services: tsa.length,
    tsa_extensions: tsa.filter((s) => s.status === 'Extended').length, communications: comms.length,
    one_time_cost: project.one_time_cost ?? 0, apps_in_scope: project.apps_in_scope ?? 0,
  };
  proposedItems.push({
    source_project_id: project.project_id, source_label: label, item_type: 'Metric', deal_type: project.deal_type, industry: project.industry,
    stage_name: 'Close-out', title: `Close-out metrics - ${label}`, body: 'Standard close-out metrics for benchmarks.', payload: JSON.stringify(metrics),
    tags: 'metrics,benchmark', consent_status: project.reuse_consent || 'Pending', review_status: 'Pending Review', reviewed_by: null, reviewed_at: null, times_used: 0,
  });
  return { project, metrics, proposedItems, redactions: allRedactions.slice(0, 200), lessonsDraft, mode: 'offline' };
}

export async function closeoutPreview(db: Db, auth: AuthContext, project: Project): Promise<CloseoutPreview> {
  try {
    return await ai.buildCloseoutPreview(db, auth, project);
  } catch (e: any) {
    if (!/not implemented/i.test(String(e?.message))) console.warn('[closeout] AI preview failed, using local preview:', e?.message);
    return localPreview(db, project);
  }
}
