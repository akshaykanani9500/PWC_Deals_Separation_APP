/** Communications agent: contacts (masked by role), email/call/meeting history, latest decisions. */
import { loadComms, loadContacts } from '../data';
import { fmtDate, t } from '../lang';
import type { AgentInput, AgentOutput } from './types';
import { emptyOutput } from './types';

const DECISION = /\b(agreed|approved|decided|go decision|signed off|sign-off received)\b/i;

export async function commsAgent(input: AgentInput): Promise<AgentOutput> {
  const { db, auth, data, lang, intents } = input;
  const out = emptyOutput('comms');

  if (intents.includes('contacts')) {
    const contacts = await loadContacts(db, auth, data.scope);
    if (auth.code === 'CLIENT') {
      out.lines.push(t(lang, 'Contact details are not shared in the client view. Please reach out to your PwC engagement manager.', 'क्लाइंट व्यू में संपर्क विवरण साझा नहीं होते। कृपया अपने PwC एंगेजमेंट मैनेजर से संपर्क करें।'));
      out.facts.push('The user may not see contact details. Do not mention any phone numbers or emails.');
    } else if (!contacts.length) {
      out.lines.push(t(lang, 'No contacts are recorded for this scope.', 'इस दायरे के लिए कोई संपर्क दर्ज नहीं है।'));
    } else {
      const lower = input.message.toLowerCase();
      const sideFilter = /\bbuyer\b/.test(lower) ? 'Buyer' : /\bseller\b/.test(lower) ? 'Seller' : /\bvendor\b/.test(lower) ? 'Vendor' : null;
      const list = contacts.filter((c) => !sideFilter || c.side === sideFilter).slice(0, 8);
      out.lines.push(t(lang, `Key contacts${sideFilter ? ` (${sideFilter})` : ''}:`, `मुख्य संपर्क${sideFilter ? ` (${sideFilter})` : ''}:`));
      for (const c of list) {
        const line = `${c.full_name} - ${c.role_title ?? ''}, ${c.org ?? ''} (${c.side ?? '-'})${c.phone ? `, ${c.phone}` : ''}${c.email ? `, ${c.email}` : ''}`;
        out.lines.push(`- ${line}`);
        out.facts.push(`Contact: ${line}`);
      }
    }
  }

  if ((intents.includes('summary') || intents.includes('risk') || intents.includes('meeting')) && data.scope.type !== 'global') {
    const comms = await loadComms(db, auth, data.scope);
    if (comms.length) {
      const latest = comms.slice(0, 4);
      out.lines.push(t(lang, `Latest communication (${comms.length} in total):`, `ताज़ा संवाद (कुल ${comms.length}):`));
      for (const c of latest) {
        const line = `${fmtDate(c.occurred_at)} ${c.channel}: ${c.subject ?? '(no subject)'}${c.from_name ? ` - ${c.from_name}` : ''}`;
        out.lines.push(`- ${line}`);
        out.facts.push(`${c.channel} on ${c.occurred_at?.slice(0, 10)} from ${c.from_name ?? '-'} to ${c.to_name ?? '-'}: ${c.subject ?? ''}. ${(c.ai_summary || c.body || '').slice(0, 300)}`);
      }
      const decisions = comms.filter((c) => DECISION.test(`${c.subject} ${c.body}`)).slice(0, 3);
      if (decisions.length) {
        out.lines.push(t(lang, 'Recent decisions:', 'हाल के निर्णय:'));
        for (const d of decisions) { out.lines.push(`- ${d.subject} (${fmtDate(d.occurred_at)})`); out.facts.push(`Decision: ${d.subject} on ${d.occurred_at?.slice(0, 10)}`); }
      }
    }
  }
  return out;
}
