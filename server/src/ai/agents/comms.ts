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
      const masked = !auth.actions.includes('contacts.view.full');
      if (masked) {
        out.lines.push(t(lang, 'Your role sees contact details partly masked, so I can show names and roles but not full phone numbers or emails. Your engagement manager can share them.', 'आपकी भूमिका में संपर्क विवरण आंशिक रूप से छिपे हैं; पूरा फ़ोन/ईमेल आपके एंगेजमेंट मैनेजर दे सकते हैं।'));
        out.facts.push('The user sees contact details masked; do not try to reconstruct phone numbers or emails.');
      }
      out.lines.push(t(lang, `Key contacts${sideFilter ? ` (${sideFilter})` : ''}:`, `मुख्य संपर्क${sideFilter ? ` (${sideFilter})` : ''}:`));
      for (const c of list) {
        const line = `${c.full_name} - ${c.role_title ?? ''}, ${c.org ?? ''} (${c.side ?? '-'})${c.phone ? `, ${c.phone}` : ''}${c.email ? `, ${c.email}` : ''}`;
        out.lines.push(`- ${line}`);
        out.facts.push(`Contact: ${line}`);
      }
    }
  }

  if (intents.includes('decisions')) {
    if (!auth.actions.includes('comms.view')) {
      out.lines.push(t(lang, 'Your role cannot see meeting notes, emails or calls, so I cannot list decisions. Your PwC engagement manager can share the decision log.', 'आपकी भूमिका मीटिंग नोट्स/ईमेल नहीं देख सकती, इसलिए निर्णय नहीं दिखा सकता। आपके PwC एंगेजमेंट मैनेजर निर्णय सूची साझा कर सकते हैं।'));
      out.facts.push('The user cannot see communications (meetings, emails, calls), so decisions from them are not available to this user.');
    } else if (data.scope.type === 'global') {
      out.lines.push(t(lang, 'Open a project, stage or activity and ask again - I will list the decisions recorded there.', 'कोई प्रोजेक्ट, चरण या गतिविधि खोलें और फिर पूछें - मैं वहाँ दर्ज निर्णय बता दूँगा।'));
    } else {
      const comms = await loadComms(db, auth, data.scope);
      const seen = new Set<string>();
      const hits = comms.map((c) => ({ c, sentence: (`${c.body ?? ''}`.split(/(?<=[.!?])\s+/).find((x) => DECISION.test(x)) ?? (DECISION.test(c.subject ?? '') ? c.subject ?? '' : '')).trim() }))
        .filter((h) => h.sentence && !seen.has(h.sentence.toLowerCase()) && (seen.add(h.sentence.toLowerCase()), true)).slice(0, 6);
      if (!hits.length) out.lines.push(t(lang, `No decisions are recorded in the ${comms.length} emails, calls and meetings here.`, `यहाँ के ${comms.length} ईमेल, कॉल और मीटिंग में कोई निर्णय दर्ज नहीं है।`));
      else {
        out.lines.push(t(lang, 'Decisions recorded here:', 'यहाँ दर्ज निर्णय:'));
        for (const h of hits) {
          out.lines.push(`- ${h.sentence} (${h.c.channel}, ${fmtDate(h.c.occurred_at)}${h.c.from_name ? `, ${h.c.from_name}` : ''})`);
          out.facts.push(`Decision on ${h.c.occurred_at?.slice(0, 10)} (${h.c.channel}, ${h.c.subject ?? ''}): ${h.sentence}`);
        }
      }
    }
    return out;
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
      const seenText = new Set<string>();
      const decisions = comms.filter((c) => DECISION.test(`${c.subject} ${c.body}`)).filter((c) => {
        const k = (`${c.body ?? ''}`.split(/(?<=[.!?])\s+/).find((x) => DECISION.test(x)) ?? c.subject ?? '').trim().toLowerCase();
        if (seenText.has(k)) return false; seenText.add(k); return true;
      }).slice(0, 3);
      if (decisions.length) {
        out.lines.push(t(lang, 'Recent decisions:', 'हाल के निर्णय:'));
        for (const d of decisions) {
          const sentence = `${d.body ?? ''}`.split(/(?<=[.!?])\s+/).find((x) => DECISION.test(x)) ?? d.subject ?? '';
          const text = sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
          out.lines.push(`- ${text} (${d.channel}, ${fmtDate(d.occurred_at)})`);
          out.facts.push(`Decision on ${d.occurred_at?.slice(0, 10)} (${d.channel}): ${text}`);
        }
      }
    }
  }
  return out;
}
