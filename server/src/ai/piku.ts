/**
 * Piku orchestrator: router agent -> 1..3 domain agents -> (Gemini writer | bilingual templates).
 * Gemini only ever sees facts the domain agents gathered from data this user is allowed to see.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Lang, PikuRequest, PikuResponse } from '../../../shared/types';
import { classify, type Domain, type RouteDecision } from './router';
import { resolveLanguage, t } from './lang';
import { loadScoped, resolveScope, type ScopedData } from './data';
import type { AgentInput, AgentOutput } from './agents/types';
import { trackerAgent } from './agents/tracker';
import { financeAgent } from './agents/finance';
import { commsAgent } from './agents/comms';
import { knowledgeAgent } from './agents/knowledge';
import { generalAgent } from './agents/general';
import { geminiConfigured, geminiGenerate } from './gemini';
import { draftEmail, suggestMeeting } from './summary';
import { auditAi } from './audit';

const AGENTS: Record<Domain, (i: AgentInput) => Promise<AgentOutput>> = {
  tracker: trackerAgent, finance: financeAgent, comms: commsAgent, knowledge: knowledgeAgent, general: generalAgent,
};

function followUps(route: RouteDecision, data: ScopedData, lang: Lang): PikuResponse['suggestedActions'] {
  const s = data.scope;
  const where = s.type === 'global' ? '' : s.type;
  const pool: Record<string, [string, string]> = {
    overdue: ['What is overdue here?', 'यहाँ क्या देरी में है?'],
    blocked: ['What is blocked and why?', 'क्या रुका हुआ है और क्यों?'],
    summary: [`Summarise this ${where || 'portfolio'}`, `इस ${where ? where : 'पोर्टफोलियो'} का सारांश दो`],
    next: ['What are the next steps?', 'आगे क्या करना है?'],
    who: ['Who owns the open items?', 'खुले काम किसके पास हैं?'],
    email: ['Draft a status email', 'स्टेटस ईमेल का ड्राफ्ट बनाओ'],
    tsa: ['Which TSA services exit next?', 'अगली कौन सी TSA सेवा खत्म हो रही है?'],
    mine: ['What are my tasks?', 'मेरे टास्क क्या हैं?'],
    risk: ['What are the biggest risks?', 'सबसे बड़े जोखिम क्या हैं?'],
  };
  const order: string[] = route.primary === 'status' ? ['overdue', 'next', 'summary']
    : route.primary === 'overdue' || route.primary === 'blocked' ? ['who', 'email', 'next']
    : route.primary === 'summary' ? ['risk', 'next', 'email']
    : route.primary === 'finance' || route.primary === 'tsa' ? ['tsa', 'risk', 'summary']
    : route.primary === 'help' || route.primary === 'greeting' ? (s.type === 'global' ? ['mine', 'risk', 'overdue'] : ['summary', 'overdue', 'next'])
    : ['summary', 'overdue', 'next'];
  return order.filter((k) => k !== route.primary).slice(0, 3).map((k) => ({ label: t(lang, pool[k][0], pool[k][1]), prompt: t(lang, pool[k][0], pool[k][1]) }));
}

async function writeWithGemini(message: string, lang: Lang, outputs: AgentOutput[], auth: AuthContext): Promise<{ text: string; model: string } | null> {
  const facts = outputs.flatMap((o) => o.facts);
  if (!facts.length || !geminiConfigured()) return null;
  const sources = outputs.flatMap((o) => o.sources);
  const prompt = [
    `User question: """${message}"""`,
    `User role: ${auth.persona.name}.`,
    `Answer language: ${lang === 'hi' ? 'Hindi (Devanagari script; keep project names and English technical terms like TSA, Day-1 as-is)' : 'English'}.`,
    'FACTS (the only information you may use):',
    ...facts.map((f, i) => `[F${i + 1}] ${f}`),
    sources.length ? `SOURCES you may cite as [n]: ${sources.map((s, i) => `[${i + 1}] ${s.label}`).join('; ')}` : '',
    'Write a concise, practical answer (max ~140 words), short bullet points where helpful, bold key numbers with **. Cite sources as [n] when you use them.',
    'If the facts do not answer the question, say what you could not find. Never invent names, numbers, dates or projects.',
  ].join('\n');
  const r = await geminiGenerate(prompt, {
    system: 'You are Piku, the AI assistant inside the Deals Separation Hub used by PwC deals teams. You are precise, friendly and brief. You never reveal information that is not in the FACTS.',
    temperature: 0.2,
    maxOutputTokens: 700,
  });
  return r ? { text: r.text, model: r.model } : null;
}

export async function answerPiku(db: Db, auth: AuthContext, req: PikuRequest): Promise<PikuResponse> {
  const message = (req.message || '').trim().slice(0, 2000);
  const lang = resolveLanguage(req.language, message);
  const ctx = req.context ?? { type: 'global' };
  const { scope } = await resolveScope(db, auth, { projectId: ctx.projectId, stageId: ctx.stageId, activityId: ctx.activityId, taskId: ctx.taskId }, message);
  const route = classify(message, scope.type !== 'global');
  const data = await loadScoped(db, auth, scope);

  let answer = '';
  let mode = 'offline';
  let outputs: AgentOutput[] = [];

  if ((route.primary === 'draft_email' || route.primary === 'meeting') && scope.type !== 'global') {
    const id = scope.task?.task_id ?? scope.activity?.activity_id ?? scope.stage?.stage_id ?? scope.project!.project_id;
    if (route.primary === 'draft_email') {
      const d = await draftEmail(db, auth, scope.type as any, id, message, lang);
      mode = d.mode;
      answer = `${t(lang, 'Here is a draft email', 'यह रहा ईमेल ड्राफ्ट')}:\n\n**${t(lang, 'To', 'प्रति')}:** ${d.to}\n**${t(lang, 'Subject', 'विषय')}:** ${d.subject}\n\n${d.body}`;
    } else {
      const m = await suggestMeeting(db, auth, scope.type as any, id, lang);
      mode = m.mode;
      answer = `**${m.title}**\n${t(lang, 'Attendees', 'प्रतिभागी')}: ${m.attendees.join(', ')}\n${t(lang, 'Agenda', 'एजेंडा')}:\n${m.agenda.map((a) => `- ${a}`).join('\n')}\n${t(lang, 'Suggested slots', 'सुझाए गए समय')}: ${m.suggestedSlots.join(' | ')}`;
    }
  } else if (route.primary === 'draft_email' || route.primary === 'meeting') {
    answer = t(lang, 'Open a project, stage, activity or task first, then ask me again and I will draft it from that context.', 'पहले कोई प्रोजेक्ट, चरण, गतिविधि या टास्क खोलें, फिर दोबारा पूछें - मैं उसी के आधार पर ड्राफ्ट बना दूँगा।');
  } else {
    const domains = route.domains.slice(0, 3); // the mesh never fans out to more than 3 agents
    const input: AgentInput = { db, auth, data, intents: route.intents, lang, message };
    outputs = await Promise.all(domains.map((d) => AGENTS[d](input)));
    const lines = outputs.flatMap((o) => o.lines);
    if (route.level >= 2) {
      const g = await writeWithGemini(message, lang, outputs, auth);
      if (g) { answer = g.text; mode = g.model; }
    }
    if (!answer) {
      answer = lines.length ? lines.join('\n') : t(lang,
        "I couldn't find anything for that in the data you can see. Try asking about status, overdue work, owners, TSA or a summary.",
        'आप जो डेटा देख सकते हैं उसमें इसके बारे में कुछ नहीं मिला। स्टेटस, देरी वाले काम, ज़िम्मेदार, TSA या सारांश के बारे में पूछें।');
    }
  }

  const sources = outputs.flatMap((o) => o.sources).slice(0, 8);
  const response: PikuResponse = { answer, language: lang, mode, sources, suggestedActions: followUps(route, data, lang) };

  // persist conversation + audit (best effort)
  const contextId = ctx.taskId ?? ctx.activityId ?? ctx.stageId ?? ctx.projectId ?? null;
  const projectId = scope.project?.project_id ?? null;
  try {
    await db.insert('chat_messages', { user_id: auth.user.user_id, project_id: projectId, context_type: ctx.type ?? 'global', context_id: contextId, sender: 'user', body: message, language: lang }, auth.user.user_id);
    await db.insert('chat_messages', { user_id: auth.user.user_id, project_id: projectId, context_type: ctx.type ?? 'global', context_id: contextId, sender: 'piku', body: answer, language: lang, ai_mode: mode, sources: JSON.stringify(sources) }, auth.user.user_id);
  } catch { /* ignore */ }
  await auditAi(db, auth, 'ai.piku', { intents: route.intents, level: route.level, domains: route.domains, mode, lang }, { entityType: scope.type, entityId: contextId, projectId });
  return response;
}
