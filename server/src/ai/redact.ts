/**
 * Redaction for the knowledge hub. Known entities may carry a type prefix:
 *   "CLIENT:Global Payments Co", "PERSON:Ananya Rao", "ORG:Acme Carrier"  (no prefix => [CLIENT])
 * Emails and phone numbers are always removed.
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{3,5}\b/g;

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function redactText(text: string, knownEntities: string[]): { text: string; redactions: { original: string; redacted: string }[] } {
  const redactions: { original: string; redacted: string }[] = [];
  if (!text) return { text: '', redactions };
  let out = text;

  out = out.replace(EMAIL, (m) => { redactions.push({ original: m, redacted: '[EMAIL]' }); return '[EMAIL]'; });
  out = out.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 8) return m; // years, amounts, counts are not phone numbers
    redactions.push({ original: m.trim(), redacted: '[PHONE]' });
    return m.startsWith(' ') ? ' [PHONE]' : '[PHONE]';
  });

  const entities: { value: string; token: string }[] = [];
  for (const raw of knownEntities) {
    if (!raw) continue;
    const m = raw.match(/^(CLIENT|PERSON|ORG):(.*)$/);
    const token = m ? `[${m[1]}]` : '[CLIENT]';
    const value = (m ? m[2] : raw).trim();
    if (value.length < 3) continue;
    entities.push({ value, token });
    if (token === '[PERSON]') {
      const first = value.split(/\s+/)[0];
      if (first.length >= 3 && first !== value) entities.push({ value: first, token });
    }
    if (token === '[CLIENT]' && /^project\s+/i.test(value)) entities.push({ value: value.replace(/^project\s+/i, ''), token });
  }
  entities.sort((a, b) => b.value.length - a.value.length);
  for (const e of entities) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(e.value)}(?![A-Za-z0-9])`, 'gi');
    out = out.replace(re, (m) => { redactions.push({ original: m, redacted: e.token }); return e.token; });
  }
  return { text: out, redactions };
}
