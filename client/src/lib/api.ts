/** Tiny fetch wrapper used by every screen. Token comes from the login session. */
const TOKEN_KEY = 'dsh.token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

/**
 * In-app AI settings (like the course simulations): the user pastes a Google AI Studio key in the
 * "AI settings" dialog. It stays in this browser (localStorage) and is sent ONLY to this app's own
 * server in the x-ai-key header (never in a URL), which then uses it for every AI feature.
 */
const AI_KEY = 'dsh.ai.key';
const AI_MODEL = 'dsh.ai.model';
export const AI_SETTINGS_EVENT = 'dsh:ai-settings-changed';

export function getAiSettings(): { key: string; model: string } {
  try { return { key: localStorage.getItem(AI_KEY) ?? '', model: localStorage.getItem(AI_MODEL) ?? '' }; } catch { return { key: '', model: '' }; }
}
export function setAiSettings(next: { key?: string | null; model?: string | null }) {
  try {
    if (next.key !== undefined) { next.key ? localStorage.setItem(AI_KEY, next.key.trim()) : localStorage.removeItem(AI_KEY); }
    if (next.model !== undefined) { next.model ? localStorage.setItem(AI_MODEL, next.model.trim()) : localStorage.removeItem(AI_MODEL); }
  } catch { /* storage blocked: AI falls back to the server key / offline */ }
  window.dispatchEvent(new Event(AI_SETTINGS_EVENT));
}
/** Headers that carry the browser's AI key/model (empty object when not set). */
export function aiHeaders(): Record<string, string> {
  const { key, model } = getAiSettings();
  const h: Record<string, string> = {};
  if (key) h['x-ai-key'] = key;
  if (model) h['x-ai-model'] = model;
  return h;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...aiHeaders() };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) { setToken(null); window.dispatchEvent(new Event('dsh:unauthorized')); }
    throw new ApiError(res.status, data?.error || res.statusText, data?.code);
  }
  return data as T;
}

export const get = <T,>(p: string) => api<T>(p);
export const post = <T,>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body: body ?? {} });
export const patch = <T,>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const del = <T,>(p: string) => api<T>(p, { method: 'DELETE' });
