/** Knowledge agent: M&A glossary + approved, anonymised knowledge hub items (lessons, templates, risks). */
import type { KnowledgeItem } from '../../../../shared/types';
import { loadApprovedKnowledge } from '../data';
import { t } from '../lang';
import type { AgentInput, AgentOutput } from './types';
import { emptyOutput } from './types';

export const GLOSSARY: { keys: RegExp; en: string; hi: string }[] = [
  { keys: /\btsa\b|transition service/i, en: 'A **TSA (Transition Services Agreement)** is a contract where the seller keeps running services (IT, HR, finance systems) for the buyer for a set period after close, for a monthly fee, until the buyer has its own. The median TSA runs about 24 months and extensions usually cost ~20% more.', hi: '**TSA (ट्रांज़िशन सर्विसेज़ एग्रीमेंट)** एक अनुबंध है जिसमें डील बंद होने के बाद विक्रेता कुछ समय तक खरीदार के लिए सेवाएँ (IT, HR, फाइनेंस सिस्टम) मासिक शुल्क पर चलाता है, जब तक खरीदार की अपनी व्यवस्था तैयार न हो। आमतौर पर TSA लगभग 24 महीने चलता है और विस्तार ~20% महँगा पड़ता है।' },
  { keys: /day[- ]?1|day one/i, en: '**Day-1** is the first day after legal close. Every critical system, access and licence must work so the separated business can operate without interruption.', hi: '**Day-1** डील के कानूनी रूप से बंद होने के बाद का पहला दिन है। उस दिन हर ज़रूरी सिस्टम, एक्सेस और लाइसेंस चालू होना चाहिए ताकि अलग हुआ व्यवसाय बिना रुकावट चले।' },
  { keys: /clean team|clean room|gun.?jumping/i, en: 'A **clean team** is a small named group allowed to see competitively sensitive data before close. It prevents gun-jumping (acting as one company before approval).', hi: '**क्लीन टीम** एक छोटा, नामित समूह है जिसे डील बंद होने से पहले प्रतिस्पर्धी रूप से संवेदनशील डेटा देखने की अनुमति होती है। यह gun-jumping से बचाता है।' },
  { keys: /disposition|clone|stand.?up|consolidate|sunset|extract/i, en: 'The five **disposition** types for an application: Clone & go (copy, then remove what does not convey), Stand-up (build new), Consolidate (move onto the acquirer\'s system), Extract & sunset (take the data, retire the source), Commercial agreement (long-term service). A TSA bridge can sit on top of any of them.', hi: 'किसी एप्लिकेशन के पाँच **डिस्पोज़िशन** प्रकार: Clone & go (कॉपी करके जो नहीं जाना वह हटाना), Stand-up (नया बनाना), Consolidate (खरीदार के सिस्टम पर ले जाना), Extract & sunset (डेटा निकालकर पुराना बंद करना), Commercial agreement (लंबी अवधि की सेवा)। इनमें से किसी पर भी TSA ब्रिज लग सकता है।' },
  { keys: /stranded cost/i, en: '**Stranded cost** is cost the seller keeps paying after the divested business leaves (e.g. shared IT that no longer has users). It is commonly 20-40% of the IT cost allocated to that business.', hi: '**स्ट्रैंडेड कॉस्ट** वह लागत है जो बेचा गया व्यवसाय जाने के बाद भी विक्रेता को चुकानी पड़ती है (जैसे साझा IT जिसके उपयोगकर्ता अब नहीं रहे)। यह अक्सर उस व्यवसाय को आवंटित IT लागत का 20-40% होती है।' },
  { keys: /carve.?out|separation|divest/i, en: 'A **carve-out (separation)** splits a business unit out of its parent so it can be sold or spun off. IT separation unwinds the shared applications, network, data, identities and licences.', hi: '**कार्व-आउट (अलगाव)** में किसी व्यवसाय इकाई को उसकी मूल कंपनी से अलग किया जाता है ताकि उसे बेचा जा सके। IT अलगाव में साझा एप्लिकेशन, नेटवर्क, डेटा, पहचान और लाइसेंस अलग किए जाते हैं।' },
  { keys: /stage gate|gate/i, en: 'A **stage gate** is the approval needed before the next stage opens. In this app the partner approves it once the gate criteria are met.', hi: '**स्टेज गेट** अगला चरण खोलने से पहले की मंज़ूरी है। इस ऐप में गेट मानदंड पूरे होने पर पार्टनर इसे मंज़ूरी देते हैं।' },
  { keys: /rag/i, en: '**RAG** is the health colour: Red (critical items overdue or several blockers), Amber (something overdue), Green (on track). It is calculated from the tasks, not typed by hand.', hi: '**RAG** स्वास्थ्य रंग है: लाल (ज़रूरी काम देरी में या कई रुकावटें), एम्बर (कुछ देरी में), हरा (सही दिशा में)। यह टास्क से गणना होता है, हाथ से नहीं भरा जाता।' },
];

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'and', 'in', 'on', 'is', 'what', 'how', 'do', 'we', 'i', 'me', 'our', 'are', 'from', 'past', 'deals', 'deal', 'similar', 'lesson', 'lessons', 'learned', 'best', 'practice', 'should', 'explain', 'about', 'any', 'with', 'this', 'that']);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9-]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

export function scoreItem(item: KnowledgeItem, words: string[], hints: { deal_type?: string; industry?: string; stage_name?: string } = {}): number {
  const hay = `${item.title} ${item.body ?? ''} ${item.tags ?? ''} ${item.stage_name ?? ''}`.toLowerCase();
  let s = 0;
  for (const w of words) if (hay.includes(w)) s += 2;
  if (hints.deal_type && item.deal_type === hints.deal_type) s += 3;
  if (hints.industry && item.industry === hints.industry) s += 3;
  if (hints.stage_name && (item.stage_name ?? '').toLowerCase() === hints.stage_name.toLowerCase()) s += 4;
  return s;
}

export async function knowledgeAgent(input: AgentInput): Promise<AgentOutput> {
  const { db, data, lang, message, auth } = input;
  const out = emptyOutput('knowledge');

  const g = GLOSSARY.find((x) => x.keys.test(message));
  if (g) {
    out.lines.push(lang === 'hi' ? g.hi : g.en);
    out.facts.push(`Definition: ${g.en.replace(/\*\*/g, '')}`);
  }

  if (!(auth.actions as string[]).includes('knowledge.view')) return out;
  const items = await loadApprovedKnowledge(db);
  const p = data.scope.project;
  const words = tokens(message);
  const ranked = items
    .map((k) => ({ k, s: scoreItem(k, words, { deal_type: p?.deal_type, industry: p?.industry, stage_name: data.scope.stage?.name }) }))
    .filter((x) => x.s >= 3 && x.k.item_type !== 'Stage Template')
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  if (ranked.length) {
    out.lines.push(t(lang, 'From the knowledge hub (anonymised past deals):', 'नॉलेज हब से (पिछली डील, गोपनीय रूप में):'));
    for (const { k } of ranked) {
      const body = (k.body ?? '').replace(/\s+/g, ' ').slice(0, 220);
      out.lines.push(`- **${k.title}** (${k.source_label ?? k.item_type}): ${body}`);
      out.facts.push(`Knowledge item "${k.title}" (${k.item_type}, ${k.source_label}): ${body}`);
      out.sources.push({ type: 'knowledge', id: k.knowledge_id, label: `${k.title}`, href: `/knowledge?item=${k.knowledge_id}` });
    }
  } else if (!g) {
    out.lines.push(t(lang,
      'I could not find a matching item in the knowledge hub yet. Closed projects add lessons and templates here after review.',
      'नॉलेज हब में अभी कोई मिलता-जुलता आइटम नहीं मिला। बंद प्रोजेक्ट की समीक्षा के बाद यहाँ सबक और टेम्पलेट जुड़ते हैं।'));
  }
  return out;
}
