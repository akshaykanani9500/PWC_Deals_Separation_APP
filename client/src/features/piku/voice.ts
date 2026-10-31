/** Browser voice: speech-to-text (Web Speech API) and text-to-speech (speechSynthesis), English + Hindi. Free, no key. */

export type VoiceLang = 'en' | 'hi';

export function speechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export interface Listener { stop: () => void }

/** Start listening. onText gets interim + final text; onEnd fires once with the final transcript. */
export function listen(lang: VoiceLang, onText: (text: string) => void, onEnd: (finalText: string, error?: string) => void): Listener | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  let error: string | undefined;
  rec.onresult = (e: any) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText((finalText + interim).trim());
  };
  rec.onerror = (e: any) => { error = e?.error === 'not-allowed' ? 'Microphone permission was denied.' : e?.error === 'no-speech' ? 'I did not hear anything.' : 'Voice input stopped.'; };
  rec.onend = () => onEnd(finalText.trim(), error);
  try { rec.start(); } catch { return null; }
  return { stop: () => { try { rec.stop(); } catch { /* ignore */ } } };
}

function pickVoice(lang: VoiceLang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  if (lang === 'hi') return voices.find((v) => v.lang === 'hi-IN') ?? voices.find((v) => v.lang.startsWith('hi'));
  return voices.find((v) => v.lang === 'en-IN') ?? voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en'));
}

/** Plain text for speaking: drop markdown, citations and very long lists. */
export function speakable(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    .slice(0, 900);
}

export function speak(text: string, lang: VoiceLang, onEnd?: () => void) {
  if (!speechSynthesisSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  const v = pickVoice(lang);
  if (v) u.voice = v;
  u.lang = v?.lang ?? (lang === 'hi' ? 'hi-IN' : 'en-IN');
  u.rate = 1;
  u.pitch = 1.05;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  synth.speak(u);
}

export function stopSpeaking() {
  if (speechSynthesisSupported()) window.speechSynthesis.cancel();
}

/** Same Hindi detection idea as the server, for choosing the voice of an answer. */
export function looksHindi(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}
