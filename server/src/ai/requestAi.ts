/**
 * Request-scoped AI settings (v1.1).
 * The browser can send its own Gemini key and model on every request (headers `x-ai-key`, `x-ai-model`),
 * set in the in-app "AI settings" dialog. This middleware stores them in AsyncLocalStorage so every AI
 * function (Piku, suggestions, summaries, drafts, close-out) uses them without changing any signatures.
 * Order of precedence: browser key -> server .env GEMINI_API_KEY -> offline.
 * The key is never logged, echoed back, written to the database or to the audit log.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestAi { key?: string; model?: string }

const store = new AsyncLocalStorage<RequestAi>();

/** Keys are ~30-60 chars of letters, digits, '.', '_' and '-'. Anything else is rejected. */
export const KEY_PATTERN = /^[A-Za-z0-9._-]{20,200}$/;
export const MODEL_PATTERN = /^[A-Za-z0-9._-]{3,80}$/;

export function validKey(k: unknown): k is string { return typeof k === 'string' && KEY_PATTERN.test(k.trim()); }
export function validModel(m: unknown): m is string { return typeof m === 'string' && MODEL_PATTERN.test(m.trim()); }

/**
 * Express middleware: read x-ai-key / x-ai-model into the request context.
 * A malformed value is rejected with 400 on /ai routes (so the user sees it in AI settings); on every other
 * route it is simply ignored, so a bad key saved in the browser can never block login or normal screens.
 */
export function requestAiMiddleware(req: Request, res: Response, next: NextFunction) {
  const rawKey = req.header('x-ai-key');
  const rawModel = req.header('x-ai-model');
  const isAiRoute = req.path.startsWith('/ai/') || req.path === '/ai';
  const ctx: RequestAi = {};
  if (rawKey !== undefined && rawKey.trim() !== '') {
    if (validKey(rawKey)) ctx.key = rawKey.trim();
    else if (isAiRoute) return res.status(400).json({ error: 'The AI key in AI settings does not look like a Google AI key. Open AI settings and paste it again.', code: 'VALIDATION' });
  }
  if (rawModel !== undefined && rawModel.trim() !== '') {
    if (validModel(rawModel)) ctx.model = rawModel.trim();
    else if (isAiRoute) return res.status(400).json({ error: 'Invalid AI model name.', code: 'VALIDATION' });
  }
  store.run(ctx, () => next());
}

export function currentRequestAi(): RequestAi { return store.getStore() ?? {}; }

/** Run a function with explicit AI settings (used by /ai/test-key and tests). */
export function withRequestAi<T>(ctx: RequestAi, fn: () => T): T { return store.run(ctx, fn); }

/** Short, non-reversible fingerprint used to track per-key error state. Never the key itself. */
export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}
