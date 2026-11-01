/**
 * Router agent (the "AI load balancer" from the PwC Deals Stack architecture).
 * Classifies a Piku query into intents, a level (1 simple, 2 one domain, 3 cross-domain) and the
 * domain agents that should answer it. Pure keyword rules in English + Hindi (Devanagari and Hinglish),
 * so it is fast, free and deterministic (the SLM role in the architecture).
 */

export type Intent =
  | 'greeting' | 'help' | 'status' | 'overdue' | 'blocked' | 'who' | 'my_tasks' | 'finance' | 'tsa'
  | 'contacts' | 'summary' | 'next_steps' | 'knowledge' | 'draft_email' | 'meeting' | 'risk' | 'list_projects'
  | 'chase' | 'pending' | 'decisions';

export type Domain = 'tracker' | 'finance' | 'comms' | 'knowledge' | 'general';

export interface RouteDecision {
  intents: Intent[];
  primary: Intent;
  level: 1 | 2 | 3;
  domains: Domain[];
  portfolioWide: boolean;
}

const RULES: { intent: Intent; patterns: RegExp[] }[] = [
  { intent: 'draft_email', patterns: [/\b(draft|write|compose|send)\b.*\b(e-?mail|mail)\b/i, /\b(e-?mail|mail)\b.*\b(draft|likho|bhejo|banao)\b/i, /ईमेल|मेल\s*(लिखो|भेजो|बनाओ)/] },
  { intent: 'meeting', patterns: [/\b(meeting|schedule|invite|call prep|set up a call|book a call)\b/i, /\bmeeting\s*(rakho|fix|set)\b/i, /मीटिंग|बैठक/] },
  { intent: 'my_tasks', patterns: [/\bmy (tasks?|work|items?|actions?)\b/i, /\b(assigned to me|on my plate|what should i do)\b/i, /\bmera kaam\b|\bmere (task|kaam)\b|\bmujhe kya karna\b/i, /मेरे\s*(काम|टास्क)|मुझे क्या करना/] },
  { intent: 'chase', patterns: [/\b(chase|follow[- ]?up with|nudge|remind|escalate|who (should|do) i (call|contact|ping|speak to|talk to|follow up|chase))\b/i, /\b(kis(se|ko) (follow|baat|yaad|bolu|bolun|pakdu))\b/i, /किससे (फ़ॉलो|बात)|किसको याद/] },
  { intent: 'pending', patterns: [/\b(pending|remaining|left to do|still open|outstanding|not (yet )?done|incomplete|open items?)\b/i, /\b(baaki|baki|bacha|bachi)\b/i, /बाकी|लंबित|शेष/] },
  { intent: 'overdue', patterns: [/\b(overdue|late|delayed|behind|slipp?ing|missed)\b/i, /\b(deri|der se|late hai|pichhe)\b/i, /देरी|देर|लेट|पीछे/] },
  { intent: 'blocked', patterns: [/\b(block(ed|er|ers)?|stuck|waiting on|dependenc(y|ies))\b/i, /\b(ruka|atka|atke)\b/i, /रुका|अटका|अटके|रुकावट/] },
  { intent: 'risk', patterns: [/\b(risk|risks|red flag|at risk|issues?|problems?|concerns?|attention|worr(y|ied|ying)|trouble|watch ?out)\b/i, /\b(dikkat|samasya|khatra)\b/i, /जोखिम|खतरा|समस्या|दिक्कत/] },
  { intent: 'finance', patterns: [/\b(fee|fees|budget|billed|billing|cost|costs|finance|financial|money|spend|funding gap|gap|revenue|margin)\b/i, /\b(paisa|kharcha|kitna paisa|budget)\b/i, /पैसा|खर्च|बजट|लागत|फीस/] },
  { intent: 'tsa', patterns: [/\btsa\b/i, /\b(transition service|exit date|extension|uplift)\b/i, /टीएसए/] },
  { intent: 'contacts', patterns: [/\b(contact|contacts|phone|number|call whom|email address|reach)\b/i, /\b(number do|phone number|kisse baat)\b/i, /फ़ोन|फोन|नंबर|संपर्क/] },
  { intent: 'who', patterns: [/\b(who|owner|owns|assignee|assigned|responsible|in charge|lead(s|ing)?)\b/i, /\b(kaun|kon|kiske paas|kiska)\b/i, /कौन|किसके|ज़िम्मेदार|जिम्मेदार/] },
  { intent: 'decisions', patterns: [/\b(decision|decisions|decided|agreed|what was agreed|minutes|meeting notes)\b/i, /\b(faisla|nirnay)\b/i, /निर्णय|फैसला|फ़ैसला/] },
  { intent: 'summary', patterns: [/\b(summar(y|ise|ize)|recap|overview|brief|what happened|catch me up|highlights?)\b/i, /\b(saar|summary do|samjhao|kya hua)\b/i, /सारांश|सार|क्या हुआ|समझाओ/] },
  { intent: 'next_steps', patterns: [/\b(next steps?|what'?s next|upcoming|due (this|next) week|pending|remaining|to do)\b/i, /\b(aage kya|agla kadam|baaki|baki|pending)\b/i, /आगे क्या|अगला|बाकी|लंबित/] },
  { intent: 'status', patterns: [/\b(status|progress|how (is|are)|where are we|percent|%|complete|completion|rag|health|on track)\b/i, /\b(status batao|kitna hua|kahan tak|kaisa chal)\b/i, /स्टेटस|स्थिति|प्रगति|कितना हुआ|कहाँ तक/] },
  { intent: 'list_projects', patterns: [/\b(list|all|which|show) (my |the )?(projects|deals|engagements)\b/i, /\b(projects|deals) (list|dikhao)\b/i, /प्रोजेक्ट(्स)?\s*(दिखाओ|सूची)|सारे प्रोजेक्ट/] },
  { intent: 'knowledge', patterns: [/\b(what is|what are|explain|define|meaning|how (do|to|should)|best practice|playbook|lesson|learned|similar (deal|project)s?|past deals?|template)\b/i, /\b(kya hota|matlab|kaise kare|samjhao)\b/i, /क्या होता|मतलब|कैसे करें|सबक/] },
  { intent: 'help', patterns: [/^\s*(help|\?|what can you do|how do i use)/i, /\b(madad|help karo)\b/i, /मदद|सहायता/] },
  { intent: 'greeting', patterns: [/^\s*(hi|hello|hey|namaste|namaskar|good (morning|afternoon|evening))\b[\s!.]*$/i, /^\s*(नमस्ते|नमस्कार|हेलो)[\s!।.]*$/] },
];

const DOMAIN_OF: Record<Intent, Domain[]> = {
  greeting: ['general'], help: ['general'], status: ['tracker'], overdue: ['tracker'], blocked: ['tracker'],
  who: ['tracker'], my_tasks: ['tracker'], finance: ['finance'], tsa: ['finance'], contacts: ['comms'],
  summary: ['tracker', 'comms'], decisions: ['comms'], next_steps: ['tracker'], chase: ['tracker'], pending: ['tracker'], knowledge: ['knowledge'], draft_email: ['comms'],
  meeting: ['comms', 'tracker'], risk: ['tracker', 'comms'], list_projects: ['tracker'],
};

export function classify(message: string, hasContext: boolean): RouteDecision {
  const intents: Intent[] = [];
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(message))) intents.push(rule.intent);
  }
  // A greeting combined with a real question is not a greeting.
  const real = intents.filter((i) => i !== 'greeting');
  let list = real.length ? real : intents;
  // "what is TSA" is knowledge, not tsa-finance, when no project context and no numbers asked for.
  if (list.includes('knowledge') && list.includes('tsa') && !/\b(cost|fee|our|this|exit date|services)\b/i.test(message)) {
    list = list.filter((i) => i !== 'tsa');
  }
  // Generic "what is / how do" only means knowledge when nothing more specific was asked.
  const explicitKnowledge = /\b(explain|define|meaning|best practice|playbook|lessons?|learned|similar (deal|project)s?|past deals?|template|kya hota|matlab)\b|सबक|मतलब|क्या होता/i.test(message);
  if (list.includes('knowledge') && list.length > 1 && !explicitKnowledge) list = list.filter((i) => i !== 'knowledge');
  // A question with no known keyword on a screen gets the full picture of that screen, not a bare status line.
  // Unknown question: on a screen summarise it; on the dashboard give the portfolio picture (only real "help" asks get help).
  if (!list.length) list = hasContext || message.trim().split(/\s+/).length > 3 ? ['summary'] : ['help'];
  // "who should I chase" is a chase question, not a list of owners
  if (list.includes('chase')) list = list.filter((i) => i !== 'who');

  // Priority order decides the primary intent
  const order: Intent[] = ['draft_email', 'meeting', 'my_tasks', 'contacts', 'tsa', 'finance', 'chase', 'overdue', 'blocked', 'risk', 'who', 'pending', 'decisions', 'summary', 'next_steps', 'list_projects', 'status', 'knowledge', 'help', 'greeting'];
  const primary = order.find((i) => list.includes(i)) ?? list[0];

  const domains = Array.from(new Set(list.flatMap((i) => DOMAIN_OF[i])));
  const portfolioWide = !hasContext && /\b(all|across|portfolio|every|which projects|compare|sabhi|saare)\b|सभी|सारे/i.test(message);

  let level: 1 | 2 | 3 = 1;
  if (domains.length >= 2 || list.length >= 3 || /\b(compare|why|recommend|analy[sz]e|trend|should we)\b|क्यों|तुलना/i.test(message)) level = 3;
  else if (['summary', 'risk', 'next_steps', 'overdue', 'blocked', 'draft_email', 'meeting', 'chase', 'pending', 'decisions'].includes(primary) || portfolioWide) level = 2;

  return { intents: list, primary, level, domains, portfolioWide };
}
