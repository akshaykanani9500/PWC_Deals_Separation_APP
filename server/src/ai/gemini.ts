/**
 * Gemini REST client (server-side only).
 * - The API key comes from process.env.GEMINI_API_KEY and is never sent to the browser or logged.
 * - Models from GEMINI_MODELS are tried in order (same "fallback list" pattern as the course simulations).
 * - Every call has a 20s timeout (25s budget across all models). On any failure the function returns null and the
 *   caller uses the offline engine.
 * - Circuit breaker: a rejected key (HTTP 400/401/403 about the key) or no network pauses Gemini for a while,
 *   so every AI feature answers instantly in offline mode instead of waiting on timeouts each time.
 */

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 20_000;

const TOTAL_BUDGET_MS = 25_000;
const KEY_COOLDOWN_MS = 5 * 60_000;   // bad / unauthorised key
const NET_COOLDOWN_MS = 60_000;       // Google unreachable (offline laptop, proxy, firewall)

let lastModelUsed: string | undefined;
let lastError: string | undefined;
let pausedUntil = 0;

/** Test helper: forget breaker state between tests. */
export function resetGeminiState() { lastModelUsed = undefined; lastError = undefined; pausedUntil = 0; }

export function geminiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

export function geminiModels(): string[] {
  const raw = (process.env.GEMINI_MODELS || '').split(',').map((m) => m.trim()).filter(Boolean);
  return raw.length ? raw : DEFAULT_MODELS;
}

export function geminiConfigured(): boolean {
  return geminiKey().length > 0 && process.env.AI_MODE !== 'offline';
}

export function geminiStatus() {
  const paused = Date.now() < pausedUntil;
  return { gemini: geminiConfigured(), models: geminiModels(), lastModelUsed, lastError, pausedUntil: paused ? new Date(pausedUntil).toISOString() : undefined };
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
  if (Date.now() < pausedUntil) return null;
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
    if (left <= 0) { lastError = 'time budget used up'; break; }
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
        lastError = `${model}: HTTP ${res.status}`;
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
        // A bad key fails the same way for every model: stop and pause instead of retrying.
        if (res.status === 401 || res.status === 403 || (res.status === 400 && /api[_ ]?key/i.test(detail))) {
          lastError = `${model}: HTTP ${res.status} (check GEMINI_API_KEY)`;
          pausedUntil = Date.now() + KEY_COOLDOWN_MS;
          return null;
        }
        continue;
      }
      const data: any = await res.json();
      const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
      if (!text) { lastError = `${model}: empty response`; continue; }
      lastModelUsed = model;
      lastError = undefined;
      return { text, model };
    } catch (e: any) {
      const timeout = e?.name === 'AbortError';
      lastError = `${model}: ${timeout ? 'timeout' : 'network error'}`;
      if (!timeout) { pausedUntil = Date.now() + NET_COOLDOWN_MS; return null; } // no network: same for every model
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
