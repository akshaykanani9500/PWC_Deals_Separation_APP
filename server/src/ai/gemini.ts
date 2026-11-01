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

/**
 * Preferred text models, best first (Gemini API, Nov 2026). The list is only a preference order:
 * at run time the app asks Google which models THIS key can call (ListModels) and skips the rest,
 * so new free-tier keys (incl. the new "AQ." auth keys) work without editing anything.
 */
export const DEFAULT_MODELS = [
  'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
];
/** Shut down by Google - never call them even if an old .env or browser setting still lists them. */
const RETIRED = /^(gemini-1\.0|gemini-1\.5|gemini-pro$|gemini-pro-vision|gemini-2\.0|gemini-exp|gemini-2\.5-(pro|flash)(-lite)?-preview|gemini-3-pro-preview|gemini-3\.1-flash-lite-preview)/i;
export function isRetiredModel(m: string): boolean { return RETIRED.test(m.trim()); }

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 25_000;

const TOTAL_BUDGET_MS = 40_000;
const KEY_COOLDOWN_MS = 5 * 60_000;   // bad / unauthorised key
const NET_COOLDOWN_MS = 60_000;       // Google unreachable (offline laptop, proxy, firewall)
const QUOTA_COOLDOWN_MS = 60_000;     // HTTP 429 on one model: skip that model for a minute
const DISCOVERY_TTL_MS = 60 * 60_000; // re-ask Google for the model list every hour

/** Breaker / status state is kept PER KEY (by fingerprint), so a bad .env key never blocks a good browser key. */
interface KeyState {
  lastModelUsed?: string; lastError?: string; pausedUntil: number;
  /** models this key may call, from ListModels (undefined = not known yet / lookup failed) */
  available?: Set<string>; discoveredAt?: number;
  /** models that returned 404 / "not found" for this key */
  unavailable: Set<string>;
  /** model -> time until which it is skipped (quota) */
  quotaUntil: Map<string, number>;
}
const states = new Map<string, KeyState>();
function stateFor(key: string): KeyState {
  const fp = keyFingerprint(key);
  let s = states.get(fp);
  if (!s) { s = { pausedUntil: 0, unavailable: new Set(), quotaUntil: new Map() }; states.set(fp, s); }
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

let warnedRetired = false;
/** Preference order: GEMINI_MODELS from .env (retired names removed), then the built-in list. */
export function defaultModels(): string[] {
  const raw = (process.env.GEMINI_MODELS || '').split(',').map((m) => m.trim()).filter(Boolean);
  const retired = raw.filter(isRetiredModel);
  if (retired.length && !warnedRetired) {
    warnedRetired = true;
    console.warn(`[ai] Ignoring retired Gemini models from GEMINI_MODELS: ${retired.join(', ')}. You can delete that line from .env - the app picks working models automatically.`);
  }
  const fromEnv = raw.filter((m) => !isRetiredModel(m));
  return [...new Set([...fromEnv, ...DEFAULT_MODELS])];
}

/** Model order for this request: the browser's chosen model first, then the configured fallbacks. */
export function geminiModels(): string[] {
  const base = defaultModels();
  const chosen = (currentRequestAi().model || '').trim();
  return chosen && !isRetiredModel(chosen) ? [chosen, ...base.filter((m) => m !== chosen)] : base;
}

/** Rank discovered models that are not in our preference list: newest version first, flash before others. */
function rankExtra(names: string[]): string[] {
  const ver = (n: string) => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  return [...names].sort((a, b) => ver(b) - ver(a) || Number(/flash/.test(b)) - Number(/flash/.test(a)) || a.localeCompare(b));
}

/** Ask Google once per hour which text models this key can call. Never throws. */
async function discover(key: string, st: KeyState): Promise<'ok' | 'key-rejected' | 'offline'> {
  if (st.discoveredAt && Date.now() - st.discoveredAt < DISCOVERY_TTL_MS) return 'ok';
  const r = await listGeminiModels(key, true);
  if (r.source === 'google') { st.available = new Set(r.models.map((m) => m.name)); st.discoveredAt = Date.now(); }
  // List unavailable for another reason: use the preference list and ask again in 5 minutes, not on every call.
  else if (!r.error && !r.networkError) st.discoveredAt = Date.now() - DISCOVERY_TTL_MS + 5 * 60_000;
  if (r.error) { st.lastError = r.error; st.pausedUntil = Date.now() + KEY_COOLDOWN_MS; return 'key-rejected'; }
  if (r.networkError) { st.lastError = 'Could not reach Google (network error)'; st.pausedUntil = Date.now() + NET_COOLDOWN_MS; return 'offline'; }
  return 'ok';
}

/** Final try-order for a key: preference list filtered to what the key can use, then any other usable models. */
async function modelsForKey(key: string, st: KeyState, preferred = geminiModels()): Promise<string[]> {
  if ((await discover(key, st)) !== 'ok') return [];
  const now = Date.now();
  const usable = (m: string) => !st.unavailable.has(m) && (st.quotaUntil.get(m) ?? 0) <= now;
  let order: string[];
  if (st.available && st.available.size) {
    const extras = rankExtra([...st.available].filter((m) => !preferred.includes(m) && !isRetiredModel(m)));
    order = [...preferred.filter((m) => st.available!.has(m)), ...extras];
  } else {
    order = preferred;
  }
  const ok = order.filter(usable);
  return ok.length ? ok : order.filter((m) => !st.unavailable.has(m));
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

  // Newer Gemini models "think" before answering and those tokens count against maxOutputTokens, so a small limit
  // cuts the visible answer mid-sentence. Callers' small values are only a length wish (their prompts already
  // ask for a short answer); the real limit is never below MIN_OUTPUT_TOKENS.
  const limit = Math.max(opts.maxOutputTokens ?? 0, MIN_OUTPUT_TOKENS);
  const makeBody = (maxOutputTokens: number): Record<string, unknown> => ({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
  });

  const attempts: string[] = [];
  for (const model of await modelsForKey(key, st)) {
    const left = deadline - Date.now();
    if (left <= 0) { st.lastError = 'time budget used up'; break; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(TIMEOUT_MS, left));
    try {
      let r = await callModel(key, model, makeBody(limit), ctrl.signal);
      if (r.ok && r.finish === 'MAX_TOKENS' && Date.now() < deadline) {
        // Cut off by the token limit: one retry on the same model with much more room.
        r = await callModel(key, model, makeBody(RETRY_OUTPUT_TOKENS), ctrl.signal);
      }
      if (!r.ok) {
        attempts.push(`${model}: ${describeHttpError(r.status, r.detail)}`);
        st.lastError = attempts.join(' | ');
        if (isKeyRejection(r.status, r.detail)) {
          // A bad key fails the same way for every model: stop and pause instead of retrying.
          st.pausedUntil = Date.now() + KEY_COOLDOWN_MS;
          return null;
        }
        if (isModelUnavailable(r.status, r.detail)) st.unavailable.add(model);
        else if (r.status === 429) st.quotaUntil.set(model, Date.now() + QUOTA_COOLDOWN_MS);
        continue;
      }
      let text = r.text;
      if (text && r.finish === 'MAX_TOKENS') {
        if (opts.json) { attempts.push(`${model}: answer cut off (token limit)`); st.lastError = attempts.join(' | '); continue; }
        text = trimToComplete(text); // never show half a sentence
      }
      if (!text) { attempts.push(`${model}: empty answer (${r.finish ?? 'no candidates'})`); st.lastError = attempts.join(' | '); continue; }
      st.lastModelUsed = model;
      st.lastError = undefined;
      return { text, model };
    } catch (e: any) {
      const timeout = e?.name === 'AbortError';
      attempts.push(`${model}: ${timeout ? 'timeout' : 'network error'}`);
      st.lastError = attempts.join(' | ');
      if (!timeout) { st.pausedUntil = Date.now() + NET_COOLDOWN_MS; return null; } // no network: same for every model
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const MIN_OUTPUT_TOKENS = 8192;
const RETRY_OUTPUT_TOKENS = 32768;

interface ModelCall { ok: boolean; status: number; detail: string; text: string; finish?: string }

/** One generateContent call. Visible text only (thought parts are skipped). */
async function callModel(key: string, model: string, body: Record<string, unknown>, signal: AbortSignal): Promise<ModelCall> {
  const res: any = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return { ok: false, status: res.status, detail: await readDetail(res), text: '' };
  const data: any = await res.json();
  const cand = data?.candidates?.[0];
  const parts: any[] = cand?.content?.parts ?? [];
  const text = parts.filter((p) => !p?.thought).map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
  return { ok: true, status: res.status ?? 200, detail: '', text, finish: cand?.finishReason };
}

/**
 * Trim text that was cut off by the token limit back to its last complete sentence, bullet or line,
 * and close any bold marker left open, so the user never sees half a sentence or stray "**".
 */
export function trimToComplete(text: string): string {
  let t = text.trimEnd();
  if (!t) return t;
  const lastBreak = t.lastIndexOf('\n');
  const lastStop = Math.max(t.lastIndexOf('. '), t.lastIndexOf('.\n'), t.endsWith('.') ? t.length - 1 : -1,
    t.lastIndexOf('। '), t.endsWith('।') ? t.length - 1 : -1, t.lastIndexOf('! '), t.lastIndexOf('? '));
  const endsClean = /[.!?।)\]]$/.test(t);
  if (!endsClean) {
    const cut = Math.max(lastStop >= 0 ? lastStop + 1 : -1, lastBreak);
    if (cut > t.length * 0.3) t = t.slice(0, cut).trimEnd();
  }
  // drop a dangling list marker / heading / label line ("- **Overall Status**:")
  t = t.replace(/\n\s*([-*•]|\d+[.)])?\s*(\*\*[^*\n]*\*\*)?\s*:?\s*$/u, '').trimEnd();
  // balance bold markers line by line
  t = t.split('\n').map((line) => ((line.match(/\*\*/g) ?? []).length % 2 === 1 ? line.replace(/\*\*(?!.*\*\*)/, '') : line)).join('\n');
  return t.trim();
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

/** Read an error body as text whatever the response object offers (real fetch or a test double). */
async function readDetail(res: any): Promise<string> {
  try { if (typeof res.text === 'function') return await res.text(); } catch { /* ignore */ }
  try { if (typeof res.json === 'function') return JSON.stringify(await res.json()); } catch { /* ignore */ }
  return '';
}

function googleMessage(detail: string): string | undefined {
  try { return JSON.parse(detail)?.error?.message as string | undefined; } catch { return undefined; }
}
/** 401/403 or a 400 that says the key itself is bad. NOT a 403 about one model (that is "model unavailable"). */
function isKeyRejection(status: number, detail: string): boolean {
  if (status === 401) return true;
  if (status === 400 && /api[_ ]?key|API_KEY_INVALID/i.test(detail)) return true;
  if (status === 403 && !/model/i.test(googleMessage(detail) ?? '')) return true;
  return false;
}
/** 404, or 403/400 that mentions the model (retired, restricted to earlier users, not supported). */
function isModelUnavailable(status: number, detail: string): boolean {
  const msg = googleMessage(detail) ?? detail;
  if (status === 404) return true;
  return (status === 403 || status === 400) && /model/i.test(msg) && /(not found|not supported|not available|no longer|access|permission|deprecat)/i.test(msg);
}

/** Readable message for a failed Gemini HTTP call (no key material, ever). */
function describeHttpError(status: number, detail: string): string {
  const msg = googleMessage(detail);
  if (status === 400 && /api[_ ]?key|API_KEY_INVALID/i.test(detail)) return 'Google rejected this key (API key not valid). Copy it again from aistudio.google.com/apikey.';
  if (isModelUnavailable(status, detail)) return 'model not available for this key';
  if (status === 401 || status === 403) return `Google rejected this key (HTTP ${status}${msg ? `: ${msg.slice(0, 140)}` : ''}). Check the key, or enable the Generative Language API for its Google Cloud project.`;
  if (status === 429) return 'free-tier quota reached for this model (HTTP 429) - try again in a minute';
  if (status >= 500) return `Google is busy (HTTP ${status})`;
  return `HTTP ${status}${msg ? `: ${msg.slice(0, 160)}` : ''}`;
}

export interface TestKeyResult {
  ok: boolean; model?: string; latencyMs: number; error?: string;
  /** models Google says this key can use (when the lookup worked) */
  availableModels?: string[];
  /** one line per model tried */
  tried?: { model: string; result: string }[];
}

/**
 * In-app "Test key": ask Google which models the key can use, then try the chosen model and the best others
 * until one answers. Returns the model that worked (the dialog switches to it) and every attempt for clarity.
 */
export async function testGeminiKey(key: string, model?: string): Promise<TestKeyResult> {
  const started = Date.now();
  const st = stateFor(key);
  st.unavailable.clear(); st.quotaUntil.clear(); st.discoveredAt = undefined; // fresh look on every test
  const list = await listGeminiModels(key, true);
  if (list.source === 'google') { st.available = new Set(list.models.map((m) => m.name)); st.discoveredAt = Date.now(); }
  if (list.error) {
    st.lastError = list.error;
    return { ok: false, latencyMs: Date.now() - started, error: list.error, tried: [] };
  }
  if (list.networkError) {
    const error = 'Could not reach Google (network error). Check your internet connection or proxy.';
    st.lastError = error;
    return { ok: false, latencyMs: Date.now() - started, error, tried: [] };
  }
  const chosen = model && !isRetiredModel(model) ? model : undefined;
  const order = await modelsForKey(key, st, chosen ? [chosen, ...defaultModels().filter((m) => m !== chosen)] : defaultModels());
  const tried: { model: string; result: string }[] = [];
  for (const m of order.slice(0, 6)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(m)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }], generationConfig: { maxOutputTokens: 1024, temperature: 0 } }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await readDetail(res);
        tried.push({ model: m, result: describeHttpError(res.status, detail) });
        if (isKeyRejection(res.status, detail)) {
          st.lastError = `${m}: ${describeHttpError(res.status, detail)}`;
          return { ok: false, latencyMs: Date.now() - started, error: describeHttpError(res.status, detail), tried, availableModels: list.source === 'google' ? list.models.map((x) => x.name) : undefined };
        }
        if (isModelUnavailable(res.status, detail)) st.unavailable.add(m);
        else if (res.status === 429) st.quotaUntil.set(m, Date.now() + QUOTA_COOLDOWN_MS);
        continue; // try the next model
      }
      // Any 200 means the key + model work (a thinking model may spend this tiny reply on thoughts).
      st.pausedUntil = 0; st.lastError = undefined; st.lastModelUsed = m;
      tried.push({ model: m, result: 'OK' });
      return { ok: true, model: m, latencyMs: Date.now() - started, tried, availableModels: list.source === 'google' ? list.models.map((x) => x.name) : undefined };
    } catch (e: any) {
      if (e?.name === 'AbortError') { tried.push({ model: m, result: 'no answer within 20 seconds' }); continue; }
      const error = 'Could not reach Google (network error). Check your internet connection or proxy.';
      st.lastError = error;
      return { ok: false, latencyMs: Date.now() - started, error, tried };
    } finally { clearTimeout(timer); }
  }
  const error = tried.length
    ? `None of the models answered: ${tried.map((t) => `${t.model} (${t.result})`).join('; ')}.`
    : 'Google did not list any text model for this key. Open aistudio.google.com, accept the terms, and check the key belongs to a project with the Gemini API enabled.';
  st.lastError = error;
  return { ok: false, latencyMs: Date.now() - started, error, tried, availableModels: list.source === 'google' ? list.models.map((x) => x.name) : undefined };
}

export interface ModelInfo { name: string; displayName: string; recommended?: boolean }

/**
 * Models this key can call (generateContent, text Gemini models), ordered best first.
 * Falls back to the built-in list when Google cannot be asked. `strict` = report a rejected key as an error.
 */
export async function listGeminiModels(key: string, strict = false): Promise<{ models: ModelInfo[]; source: 'google' | 'default'; error?: string; networkError?: boolean }> {
  const fallback = { models: defaultModels().map((m, i) => ({ name: m, displayName: m, recommended: i === 0 })), source: 'default' as const };
  if (!key) return fallback;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const all: any[] = [];
    let pageToken = '';
    for (let page = 0; page < 5; page++) {
      const res = await fetch(`${ENDPOINT}?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers: { 'x-goog-api-key': key }, signal: ctrl.signal });
      if (!res.ok) {
        const detail = await readDetail(res);
        if (strict && isKeyRejection(res.status, detail)) return { ...fallback, error: describeHttpError(res.status, detail) };
        return fallback;
      }
      const data: any = await res.json();
      all.push(...(data?.models ?? []));
      pageToken = data?.nextPageToken || '';
      if (!pageToken) break;
    }
    const names: string[] = all
      .filter((m: any) => typeof m?.name === 'string' && m.name.startsWith('models/gemini')
        && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent')
        && !/(tts|image|embedding|audio|live|vision|transcribe|robotics|computer-use|omni|nano-banana|customtools)/i.test(m.name))
      .map((m: any) => String(m.name).replace(/^models\//, ''))
      .filter((n: string) => !isRetiredModel(n));
    if (!names.length) return fallback;
    const display = new Map(all.map((m: any) => [String(m.name).replace(/^models\//, ''), String(m.displayName || m.name).slice(0, 80)]));
    const pref = defaultModels();
    const ordered = [...pref.filter((m) => names.includes(m)), ...rankExtra(names.filter((n) => !pref.includes(n)))];
    return { models: ordered.map((n, i) => ({ name: n, displayName: display.get(n) || n, recommended: i === 0 })), source: 'google' };
  } catch (e: any) {
    // A timeout just means "unknown list"; a thrown fetch means Google is unreachable.
    return e?.name === 'AbortError' ? fallback : { ...fallback, networkError: true };
  } finally { clearTimeout(timer); }
}
