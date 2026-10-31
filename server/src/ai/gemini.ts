/**
 * Gemini REST client (server-side only).
 * - The API key comes from process.env.GEMINI_API_KEY and is never sent to the browser or logged.
 * - Models from GEMINI_MODELS are tried in order (same "fallback list" pattern as the course simulations).
 * - Every call has a 20s timeout. On any failure the function returns null and the caller uses the offline engine.
 */

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 20_000;

let lastModelUsed: string | undefined;
let lastError: string | undefined;

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
  return { gemini: geminiConfigured(), models: geminiModels(), lastModelUsed, lastError };
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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        lastError = `${model}: HTTP ${res.status}`;
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
      lastError = `${model}: ${e?.name === 'AbortError' ? 'timeout' : 'network error'}`;
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
