/**
 * Gemini REST client (server-side only).
 * - The API key comes from the in-app AI settings (header x-ai-key, request-scoped via requestAi.ts) or, when the
 *   browser has none, from process.env.GEMINI_API_KEY. It is never sent back to the browser or logged.
 * - Models from GEMINI_MODELS are tried in order (same "fallback list" pattern as the course simulations).
 * - Every call has a 20s timeout (25s budget across all models). On any failure the function returns null and the
 *   caller uses the offline engine.
 * - Circuit breaker: a rejected key (HTTP 400/401/403 about the key) or no network pauses Gemini for a while,
 *   so every AI feature answers instantly in offline mode instead of waiting on timeouts each time.
 */

import { currentRequestAi, keyFingerprint } from './requestAi';

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 20_000;

const TOTAL_BUDGET_MS = 25_000;
const KEY_COOLDOWN_MS = 5 * 60_000;   // bad / unauthorised key
const NET_COOLDOWN_MS = 60_000;       // Google unreachable (offline laptop, proxy, firewall)

/** Breaker / status state is kept PER KEY (by fingerprint), so a bad .env key never blocks a good browser key. */
interface KeyState { lastModelUsed?: string; lastError?: string; pausedUntil: number }
const states = new Map<string, KeyState>();
function stateFor(key: string): KeyState {
  const fp = keyFingerprint(key);
  let s = states.get(fp);
  if (!s) { s = { pausedUntil: 0 }; states.set(fp, s); }
  return s;
}

/** Test helper: forget breaker state between tests. */
export function resetGeminiState() { states.clear(); }

export function serverKey(): string { return (process.env.GEMINI_API_KEY || '').trim(); }

/** Where the key for this request comes from. */
export function keySource(): 'browser' | 'server' | 'none' {
  if (currentRequestAi().key) return 'browser';
  return serverKey() ? 'server' : 'none';
}

export function geminiKey(): string {
  return currentRequestAi().key || serverKey();
}

export function defaultModels(): string[] {
  const raw = (process.env.GEMINI_MODELS || '').split(',').map((m) => m.trim()).filter(Boolean);
  return raw.length ? raw : DEFAULT_MODELS;
}

/** Model order for this request: the browser's chosen model first, then the configured fallbacks. */
export function geminiModels(): string[] {
  const base = defaultModels();
  const chosen = currentRequestAi().model;
  return chosen ? [chosen, ...base.filter((m) => m !== chosen)] : base;
}

export function geminiConfigured(): boolean {
  return geminiKey().length > 0 && process.env.AI_MODE !== 'offline';
}

export function geminiStatus() {
  const key = geminiKey();
  const s = key ? stateFor(key) : { pausedUntil: 0 } as KeyState;
  const paused = Date.now() < s.pausedUntil;
  return {
    gemini: geminiConfigured(),
    source: keySource(),
    serverKeyPresent: serverKey().length > 0,
    models: geminiModels(),
    lastModelUsed: s.lastModelUsed,
    lastError: s.lastError,
    pausedUntil: paused ? new Date(s.pausedUntil).toISOString() : undefined,
  };
}

export interface GeminiResult { text: string; model: string }

export interface GeminiOptions {
  system?: string;
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

/** Plain text (or JSON text when opts.json). Returns null when no key or every model failed. */
export async function geminiGenerate(prompt: string, opts: GeminiOptions = {}): Promise<GeminiResult | null> {
  const key = geminiKey();
  if (!key || process.env.AI_MODE === 'offline') return null;
  const st = stateFor(key);
  if (Date.now() < st.pausedUntil) return null;
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };

  for (const model of geminiModels()) {
    const left = deadline - Date.now();
    if (left <= 0) { st.lastError = 'time budget used up'; break; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(TIMEOUT_MS, left));
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        st.lastError = `${model}: HTTP ${res.status}`;
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
        // A bad key fails the same way for every model: stop and pause instead of retrying.
        if (res.status === 401 || res.status === 403 || (res.status === 400 && /api[_ ]?key/i.test(detail))) {
          st.lastError = `${model}: HTTP ${res.status} (key rejected - check the key in AI settings or GEMINI_API_KEY)`;
          st.pausedUntil = Date.now() + KEY_COOLDOWN_MS;
          return null;
        }
        continue;
      }
      const data: any = await res.json();
      const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
      if (!text) { st.lastError = `${model}: empty response`; continue; }
      st.lastModelUsed = model;
      st.lastError = undefined;
      return { text, model };
    } catch (e: any) {
      const timeout = e?.name === 'AbortError';
      st.lastError = `${model}: ${timeout ? 'timeout' : 'network error'}`;
      if (!timeout) { st.pausedUntil = Date.now() + NET_COOLDOWN_MS; return null; } // no network: same for every model
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Strict-ish JSON parse that tolerates ```json fences and leading prose. */
export function safeJsonParse<T = unknown>(text: string): T | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t) as T; } catch { /* try to locate the JSON body */ }
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)) as T; } catch { return null; }
}

/** JSON call. Returns parsed value + model, or null (caller falls back offline). */
export async function geminiJson<T = unknown>(prompt: string, opts: Omit<GeminiOptions, 'json'> = {}): Promise<{ data: T; model: string } | null> {
  const r = await geminiGenerate(prompt, { ...opts, json: true });
  if (!r) return null;
  const data = safeJsonParse<T>(r.text);
  if (data === null) return null;
  return { data, model: r.model };
}

/** Readable message for a failed Gemini HTTP call (no key material, ever). */
function describeHttpError(status: number, detail: string): string {
  const msg = (() => { try { return JSON.parse(detail)?.error?.message as string | undefined; } catch { return undefined; } })();
  if (status === 400 && /api[_ ]?key/i.test(detail)) return 'Google rejected this key (API key not valid). Copy it again from aistudio.google.com/apikey.';
  if (status === 401 || status === 403) return 'Google rejected this key (not authorised for the Gemini API). Check the key or enable the Generative Language API for its project.';
  if (status === 404) return 'This model is not available for your key. Pick another model.';
  if (status === 429) return 'Quota exceeded for this key (HTTP 429). Wait a minute or use another key/model.';
  return `HTTP ${status}${msg ? `: ${msg.slice(0, 160)}` : ''}`;
}

export interface TestKeyResult { ok: boolean; model?: string; latencyMs: number; error?: string }

/**
 * Make one tiny call to check a key (in-app "Test key" button). Tries the chosen model first, then fallbacks,
 * and returns the first model that answers. A success clears any pause on this key.
 */
export async function testGeminiKey(key: string, model?: string): Promise<TestKeyResult> {
  const started = Date.now();
  const order = model ? [model, ...defaultModels().filter((m) => m !== model)] : defaultModels();
  const st = stateFor(key);
  let error = 'No model answered';
  for (const m of order.slice(0, 3)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(m)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }], generationConfig: { maxOutputTokens: 8, temperature: 0 } }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let detail = ''; try { detail = await res.text(); } catch { /* ignore */ }
        error = `${m}: ${describeHttpError(res.status, detail)}`;
        if (res.status === 404) continue;         // model not available: try the next one
        st.lastError = error;
        return { ok: false, latencyMs: Date.now() - started, error };
      }
      st.pausedUntil = 0; st.lastError = undefined; st.lastModelUsed = m;
      return { ok: true, model: m, latencyMs: Date.now() - started };
    } catch (e: any) {
      error = e?.name === 'AbortError' ? `${m}: no answer within 15 seconds` : 'Could not reach Google (network error). Check your internet connection or proxy.';
      st.lastError = error;
      return { ok: false, latencyMs: Date.now() - started, error };
    } finally { clearTimeout(timer); }
  }
  st.lastError = error;
  return { ok: false, latencyMs: Date.now() - started, error };
}

export interface ModelInfo { name: string; displayName: string }

/** Models this key can call (generateContent, text Gemini models). Falls back to the defaults. */
export async function listGeminiModels(key: string): Promise<{ models: ModelInfo[]; source: 'google' | 'default' }> {
  const fallback = { models: defaultModels().map((m) => ({ name: m, displayName: m })), source: 'default' as const };
  if (!key) return fallback;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${ENDPOINT}?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: ctrl.signal });
    if (!res.ok) return fallback;
    const data: any = await res.json();
    const models: ModelInfo[] = (data?.models ?? [])
      .filter((m: any) => typeof m?.name === 'string' && m.name.startsWith('models/gemini')
        && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent')
        && !/(tts|image|embedding|audio|live|vision)/i.test(m.name))
      .map((m: any) => ({ name: String(m.name).replace(/^models\//, ''), displayName: String(m.displayName || m.name).slice(0, 80) }));
    return models.length ? { models, source: 'google' } : fallback;
  } catch {
    return fallback;
  } finally { clearTimeout(timer); }
}
