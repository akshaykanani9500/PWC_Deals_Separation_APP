/** Language helpers: detect Hindi (Devanagari or romanised Hinglish) and pick bilingual strings. */
import type { Lang } from '../../../shared/types';

const DEVANAGARI = /[ऀ-ॿ]/;

/** Common romanised Hindi words. Two hits (or one strong hit) => Hindi. */
const HINGLISH = [
  'kya', 'kyaa', 'hai', 'hain', 'batao', 'bataiye', 'bata', 'kitna', 'kitne', 'kitni', 'kaun', 'kon', 'kaise', 'kahan', 'kab',
  'deri', 'der', 'baaki', 'baki', 'mujhe', 'mera', 'meri', 'mere', 'humein', 'hamara', 'karo', 'kariye', 'kijiye', 'chahiye',
  'aur', 'nahi', 'nahin', 'abhi', 'kaam', 'wala', 'wali', 'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'liye', 'samjhao', 'dikhao',
  'bhejo', 'likho', 'pending', 'sab', 'saare', 'agla', 'agle', 'aaj', 'kal', 'jaldi', 'dikkat', 'samasya', 'paisa', 'kharcha',
];
const STRONG = new Set(['kya', 'batao', 'bataiye', 'kitna', 'kitne', 'kaun', 'kaise', 'deri', 'baaki', 'mujhe', 'chahiye', 'samjhao', 'dikhao', 'kharcha', 'kijiye', 'karo']);

export function detectLanguage(text: string): Lang {
  if (DEVANAGARI.test(text)) return 'hi';
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let hits = 0;
  let strong = false;
  for (const w of words) {
    if (HINGLISH.includes(w)) { hits++; if (STRONG.has(w)) strong = true; }
  }
  if (strong && hits >= 1) return 'hi';
  if (hits >= 2 && hits / Math.max(words.length, 1) >= 0.25) return 'hi';
  return 'en';
}

export function resolveLanguage(requested: Lang | 'auto' | undefined, text: string): Lang {
  if (requested === 'en' || requested === 'hi') return requested;
  return detectLanguage(text);
}

/** Pick the string for the language. */
export function t(lang: Lang, en: string, hi: string): string {
  return lang === 'hi' ? hi : en;
}

export function fmtMoney(n: number | null | undefined, currency = 'USD'): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  const v = Number(n);
  const sym = currency === 'INR' ? '₹' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  if (Math.abs(v) >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `${sym}${(v / 1_000).toFixed(0)}K`;
  return `${sym}${v.toFixed(0)}`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '-';
  const dt = new Date(d.length === 10 ? `${d}T00:00:00Z` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
