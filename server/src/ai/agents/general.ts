/** General agent: greetings and help. Needs no client data. */
import { t } from '../lang';
import type { AgentInput, AgentOutput } from './types';
import { emptyOutput } from './types';

export async function generalAgent(input: AgentInput): Promise<AgentOutput> {
  const { lang, intents, auth } = input;
  const out = emptyOutput('general');
  const first = auth.user.full_name.split(' ')[0];
  if (intents.includes('greeting')) {
    out.lines.push(t(lang, `Hi ${first}! I'm Piku, your deals assistant.`, `नमस्ते ${first}! मैं पीकू हूँ, आपका डील्स सहायक।`));
  }
  if (intents.includes('help') || intents.includes('greeting')) {
    out.lines.push(t(lang,
      'I can tell you the status of a project, stage or activity, list overdue and blocked work, show who owns what, summarise emails and calls, explain M&A terms, find lessons from past deals, and draft an email or a meeting. I only use data your role is allowed to see. Ask in English or Hindi.',
      'मैं किसी प्रोजेक्ट, चरण या गतिविधि की स्थिति बता सकता हूँ, देरी और रुके हुए काम दिखा सकता हूँ, कौन क्या संभाल रहा है बता सकता हूँ, ईमेल और कॉल का सार दे सकता हूँ, M&A शब्द समझा सकता हूँ, पिछली डील के सबक ढूँढ सकता हूँ, और ईमेल या मीटिंग का ड्राफ्ट बना सकता हूँ। मैं सिर्फ़ वही डेटा इस्तेमाल करता हूँ जो आपकी भूमिका देख सकती है। अंग्रेज़ी या हिंदी में पूछें।'));
  }
  return out;
}
