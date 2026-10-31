/** Summaries, email drafts and meeting suggestions for a project / stage / activity / task. */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Lang, SummaryResponse, User } from '../../../shared/types';
import { completion, isOverdue, loadComms, loadContacts, loadNotes, loadScoped, resolveScope, userName, type Scope, type ScopedData } from './data';
import { fmtDate, t, todayIso } from './lang';
import { geminiConfigured, geminiJson } from './gemini';
import { auditAi } from './audit';
import { maskContact } from '../../../shared/permissions';

export type ScopeKind = 'project' | 'stage' | 'activity' | 'task';

export class AiHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Resolve a scope by id and make sure the user may see it (404 otherwise - do not reveal existence). */
export async function scopeById(db: Db, auth: AuthContext, kind: ScopeKind, id: string): Promise<Scope> {
  const ctx = kind === 'project' ? { projectId: id } : kind === 'stage' ? { stageId: id } : kind === 'activity' ? { activityId: id } : { taskId: id };
  const { scope } = await resolveScope(db, auth, ctx);
  if (scope.type !== kind) throw new AiHttpError(404, 'Not found');
  return scope;
}

function scopeTitle(s: Scope): string {
  return s.task?.title ?? s.activity?.name ?? s.stage?.name ?? s.project?.code_name ?? 'Portfolio';
}

const DECISION = /\b(agreed|approved|decided|go decision|signed off|sign-off received)\b/i;

function deterministicSummary(data: ScopedData, comms: Awaited<ReturnType<typeof loadComms>>, notes: Awaited<ReturnType<typeof loadNotes>>, lang: Lang): Omit<SummaryResponse, 'mode'> {
  const tasks = data.tasks;
  const done = tasks.filter((x) => x.status === 'Done');
  const open = tasks.filter((x) => x.status !== 'Done');
  const overdue = open.filter(isOverdue);
  const blocked = open.filter((x) => x.status === 'Blocked');
  const d1 = open.filter((x) => x.day1_critical === 'Y');
  const title = scopeTitle(data.scope);
  const pc = data.scope.task ? (data.scope.task.status === 'Done' ? 100 : Number(data.scope.task.percent_complete ?? 0)) : completion(tasks);

  const summary = data.scope.type === 'task' && data.scope.task
    ? t(lang,
      `"${title}" is ${data.scope.task.status} (${pc}%), assigned to ${userName(data.users, data.scope.task.assignee_user_id)} and due ${fmtDate(data.scope.task.due_date)}. ${comms.length} related message(s) and ${notes.length} note(s) on record.`,
      `"${title}" की स्थिति ${data.scope.task.status} (${pc}%) है, ${userName(data.users, data.scope.task.assignee_user_id)} के पास, अंतिम तिथि ${fmtDate(data.scope.task.due_date)}। इससे जुड़े ${comms.length} संदेश और ${notes.length} नोट दर्ज हैं।`)
    : t(lang,
      `${title} is ${pc}% complete: ${done.length} of ${tasks.length} tasks done, ${open.length - blocked.length} in progress or not started, ${blocked.length} blocked and ${overdue.length} overdue.${comms.length ? ` ${comms.length} email/call/meeting record(s) in this scope, latest on ${fmtDate(comms[0].occurred_at)}.` : ''}`,
      `${title} ${pc}% पूरा है: ${tasks.length} में से ${done.length} टास्क पूरे, ${blocked.length} रुके हुए और ${overdue.length} देरी में।${comms.length ? ` इस दायरे में ${comms.length} ईमेल/कॉल/मीटिंग रिकॉर्ड, आख़िरी ${fmtDate(comms[0].occurred_at)} को।` : ''}`);

  const highlights: string[] = [];
  for (const x of done.sort((a, b) => (b.completed_date || '').localeCompare(a.completed_date || '')).slice(0, 2)) highlights.push(t(lang, `Completed: ${x.title}`, `पूरा हुआ: ${x.title}`));
  for (const c of comms.filter((c) => DECISION.test(`${c.subject} ${c.body}`)).slice(0, 2)) highlights.push(t(lang, `Decision (${fmtDate(c.occurred_at)}): ${c.subject}`, `निर्णय (${fmtDate(c.occurred_at)}): ${c.subject}`));
  if (data.scope.task?.done_notes) highlights.push(data.scope.task.done_notes);
  const pinned = notes.find((n) => n.pinned === 'Y') ?? notes[0];
  if (pinned) highlights.push(t(lang, `Note: ${pinned.body.slice(0, 160)}`, `नोट: ${pinned.body.slice(0, 160)}`));
  if (!highlights.length && comms[0]) highlights.push(`${comms[0].channel}: ${comms[0].subject}`);

  const risks: string[] = [];
  for (const x of overdue.slice(0, 3)) risks.push(t(lang, `Overdue since ${fmtDate(x.due_date)}: ${x.title} (${userName(data.users, x.assignee_user_id)})`, `${fmtDate(x.due_date)} से देरी में: ${x.title} (${userName(data.users, x.assignee_user_id)})`));
  for (const x of blocked.slice(0, 3)) risks.push(t(lang, `Blocked: ${x.title}${x.dependency_notes ? ` - ${x.dependency_notes}` : ''}`, `रुका हुआ: ${x.title}${x.dependency_notes ? ` - ${x.dependency_notes}` : ''}`));
  if (d1.length) risks.push(t(lang, `${d1.length} Day-1 critical item(s) still open`, `${d1.length} Day-1 क्रिटिकल आइटम अभी खुले हैं`));
  if (data.scope.task?.dependency_notes && !risks.length) risks.push(data.scope.task.dependency_notes);

  const nextSteps: string[] = [];
  const today = todayIso();
  const upcoming = open.filter((x) => x.due_date && x.due_date >= today).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  for (const x of upcoming.slice(0, 3)) nextSteps.push(t(lang, `${x.title} - ${userName(data.users, x.assignee_user_id)} by ${fmtDate(x.due_date)}`, `${x.title} - ${userName(data.users, x.assignee_user_id)}, ${fmtDate(x.due_date)} तक`));
  if (data.scope.task?.pending_notes) nextSteps.unshift(data.scope.task.pending_notes);
  if (overdue.length) nextSteps.push(t(lang, 'Agree new dates for overdue items with their owners', 'देरी वाले कामों के लिए ज़िम्मेदारों से नई तारीख तय करें'));
  if (!nextSteps.length) nextSteps.push(t(lang, 'No open deadlines - confirm the stage gate criteria are met', 'कोई खुली समय-सीमा नहीं - स्टेज गेट मानदंड पूरे होने की पुष्टि करें'));

  return { summary, highlights: highlights.slice(0, 4), risks: risks.slice(0, 4), nextSteps: nextSteps.slice(0, 4) };
}

export async function summarize(db: Db, auth: AuthContext, kind: ScopeKind, id: string, lang: Lang = 'en'): Promise<SummaryResponse> {
  const scope = await scopeById(db, auth, kind, id);
  const [data, comms, notes] = await Promise.all([loadScoped(db, auth, scope), loadComms(db, auth, scope), loadNotes(db, scope)]);
  const base = deterministicSummary(data, comms, notes, lang);
  let result: SummaryResponse = { ...base, mode: 'offline' };

  if (geminiConfigured()) {
    const facts = [
      base.summary, ...base.highlights, ...base.risks.map((r) => `Risk: ${r}`), ...base.nextSteps.map((n) => `Next: ${n}`),
      ...comms.slice(0, 8).map((c) => `${c.channel} ${c.occurred_at?.slice(0, 10)} ${c.from_name ?? ''} -> ${c.to_name ?? ''}: ${c.subject ?? ''}. ${(c.body ?? '').slice(0, 400)}`),
      ...notes.slice(0, 5).map((n) => `Note: ${n.body.slice(0, 300)}`),
    ];
    const g = await geminiJson<{ summary: string; highlights: string[]; risks: string[]; nextSteps: string[] }>(
      `Summarise this ${kind} "${scopeTitle(scope)}" for a deals team in ${lang === 'hi' ? 'Hindi' : 'English'}.\nFACTS:\n${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nReturn JSON {"summary": string (2-3 sentences), "highlights": string[] (max 4), "risks": string[] (max 4), "nextSteps": string[] (max 4)}. Use only the facts.`,
      { temperature: 0.2, maxOutputTokens: 900 },
    );
    if (g && typeof g.data?.summary === 'string' && Array.isArray(g.data.highlights)) {
      result = {
        summary: g.data.summary,
        highlights: g.data.highlights.map(String).slice(0, 4),
        risks: (g.data.risks ?? []).map(String).slice(0, 4),
        nextSteps: (g.data.nextSteps ?? []).map(String).slice(0, 4),
        mode: g.model,
      };
    }
  }
  await auditAi(db, auth, 'ai.summary', { kind, mode: result.mode }, { entityType: kind, entityId: id, projectId: scope.project?.project_id });
  return result;
}

function recipientFor(data: ScopedData, scope: Scope): User | undefined {
  const id = scope.task?.assignee_user_id ?? scope.activity?.owner_user_id ?? scope.stage?.owner_user_id ?? scope.project?.manager_user_id;
  return id ? data.users.get(id) : undefined;
}

export async function draftEmail(db: Db, auth: AuthContext, kind: ScopeKind, id: string, intent = '', lang: Lang = 'en'): Promise<{ to: string; subject: string; body: string; mode: string }> {
  const scope = await scopeById(db, auth, kind, id);
  const data = await loadScoped(db, auth, scope);
  const base = deterministicSummary(data, [], [], lang);
  const code = scope.project?.code_name ?? '';
  const title = scopeTitle(scope);
  const me = auth.user.full_name;
  const showFull = (auth.actions as string[]).includes('contacts.view.full');

  let to: string;
  let toName: string;
  const wantsClient = /\b(client|buyer|seller|vendor)\b/i.test(intent);
  const contacts = wantsClient ? await loadContacts(db, auth, scope) : [];
  const contact = contacts.find((c) => (/\bseller\b/i.test(intent) ? c.side === 'Seller' : /\bvendor\b/i.test(intent) ? c.side === 'Vendor' : c.side === 'Buyer' || c.side === 'Client'));
  if (contact) { toName = contact.full_name; to = `${contact.full_name} <${contact.email ?? ''}>`; }
  else {
    const r = recipientFor(data, scope);
    toName = r?.full_name ?? t(lang, 'Team', 'टीम');
    to = r ? `${r.full_name} <${showFull ? r.email ?? '' : maskContact(r.email)}>` : t(lang, 'Project team', 'प्रोजेक्ट टीम');
  }
  const first = toName.split(' ')[0];
  const isChase = /chase|remind|follow|overdue|late|yaad|reminder/i.test(intent) || base.risks.length > 0;
  const subject = `[${code}]${scope.type === 'project' ? '' : ` ${title}`} - ${isChase ? t(lang, 'follow-up on open items', 'खुले कामों पर फ़ॉलो-अप') : t(lang, 'status update', 'स्टेटस अपडेट')}`;
  let body = [
    t(lang, `Hi ${first},`, `नमस्ते ${first},`),
    '',
    base.summary,
    '',
    base.risks.length ? t(lang, 'Items that need attention:', 'जिन कामों पर ध्यान चाहिए:') : '',
    ...base.risks.map((r) => `• ${r}`),
    base.risks.length ? '' : '',
    t(lang, 'Next steps:', 'आगे के कदम:'),
    ...base.nextSteps.map((n) => `• ${n}`),
    '',
    isChase ? t(lang, 'Could you confirm an updated date or flag any blocker by end of day tomorrow?', 'क्या आप कल शाम तक नई तारीख बता सकते हैं या कोई रुकावट हो तो बताएँ?') : t(lang, 'Happy to discuss on a quick call if useful.', 'ज़रूरत हो तो एक छोटी कॉल पर बात कर सकते हैं।'),
    '',
    t(lang, 'Thanks,', 'धन्यवाद,'),
    me,
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
  let mode = 'offline';

  if (geminiConfigured()) {
    const g = await geminiJson<{ subject: string; body: string }>(
      `Write a short professional email in ${lang === 'hi' ? 'Hindi' : 'English'} from ${me} (${auth.persona.name}) to ${toName} about "${title}" on deal ${code}. User intent: "${intent || 'status update'}".\nUse only these facts:\n${[base.summary, ...base.risks, ...base.nextSteps].map((f) => `- ${f}`).join('\n')}\nReturn JSON {"subject": string, "body": string}. Keep it under 150 words, sign off with ${me}.`,
      { temperature: 0.3, maxOutputTokens: 700 },
    );
    if (g && typeof g.data?.subject === 'string' && typeof g.data?.body === 'string') { body = g.data.body; mode = g.model; }
  }
  await auditAi(db, auth, 'ai.draft_email', { kind, mode }, { entityType: kind, entityId: id, projectId: scope.project?.project_id });
  return { to, subject, body, mode };
}

/** Next N working days (Mon-Fri) in IST with three standard slots. */
export function nextSlots(n = 3, from = new Date()): string[] {
  const out: string[] = [];
  const times = ['10:30', '14:00', '16:30'];
  const ist = new Date(from.getTime() + 5.5 * 3600 * 1000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  let i = 0;
  while (out.length < n && i < 14) {
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    out.push(`${label}, ${times[out.length % times.length]} IST`);
  }
  return out;
}

export async function suggestMeeting(db: Db, auth: AuthContext, kind: ScopeKind, id: string, lang: Lang = 'en'): Promise<{ title: string; agenda: string[]; attendees: string[]; suggestedSlots: string[]; mode: string }> {
  const scope = await scopeById(db, auth, kind, id);
  const data = await loadScoped(db, auth, scope);
  const base = deterministicSummary(data, [], [], lang);
  const code = scope.project?.code_name ?? '';
  const title = `${scope.type === 'project' ? code : `${code} · ${scopeTitle(scope)}`} - ${base.risks.length ? t(lang, 'unblock & re-plan', 'रुकावटें दूर करना और नई योजना') : t(lang, 'progress review', 'प्रगति समीक्षा')}`;
  const people = new Set<string>([auth.user.full_name]);
  const add = (uid?: string | null) => { if (uid && data.users.get(uid)) people.add(data.users.get(uid)!.full_name); };
  add(scope.project?.manager_user_id);
  add(scope.stage?.owner_user_id);
  add(scope.activity?.owner_user_id);
  add(scope.task?.assignee_user_id);
  for (const x of data.tasks.filter((x) => x.status !== 'Done' && (x.status === 'Blocked' || isOverdue(x))).slice(0, 4)) add(x.assignee_user_id);
  const agenda = [
    t(lang, `Status check: ${base.summary.split('.')[0]}`, `स्टेटस: ${base.summary.split('।')[0]}`),
    ...base.risks.slice(0, 3).map((r) => t(lang, `Resolve: ${r}`, `समाधान: ${r}`)),
    ...base.nextSteps.slice(0, 2).map((n) => t(lang, `Confirm: ${n}`, `पुष्टि: ${n}`)),
    t(lang, 'Agree owners and dates; log decisions in the app', 'ज़िम्मेदार और तारीखें तय करें; निर्णय ऐप में दर्ज करें'),
  ];
  await auditAi(db, auth, 'ai.meeting', { kind }, { entityType: kind, entityId: id, projectId: scope.project?.project_id });
  return { title, agenda, attendees: Array.from(people), suggestedSlots: nextSlots(3), mode: 'offline' };
}
