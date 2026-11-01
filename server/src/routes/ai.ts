/** AI routes (Agent 3 owns). Mounted by server/src/app.ts at /api/ai, after the auth middleware. */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { Lang, PikuRequest, SuggestRequest, ChatMessage } from '../../../shared/types';
import { answerPiku } from '../ai/piku';
import { suggest } from '../ai/suggest';
import { summarize, draftEmail, suggestMeeting, type ScopeKind } from '../ai/summary';
import { geminiStatus, testGeminiKey, listGeminiModels, geminiKey } from '../ai/gemini';
import { validKey, validModel, currentRequestAi } from '../ai/requestAi';

const SCOPES: ScopeKind[] = ['project', 'stage', 'activity', 'task'];
const KINDS = ['project', 'stages', 'stage', 'activities', 'activity', 'tasks', 'task'];

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;

/** Wrap a handler: require auth, optional actions (any of), map errors to the API error shape. */
function route(actionsAny: string[] | null, fn: Handler) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    const auth = (req as AuthedRequest).auth;
    if (!auth) return res.status(401).json({ error: 'Please sign in', code: 'UNAUTHENTICATED' });
    if (actionsAny && !actionsAny.some((a) => (auth.actions as string[]).includes(a))) {
      return res.status(403).json({ error: 'Your role cannot use this AI feature', code: 'FORBIDDEN' });
    }
    try {
      const out = await fn(req as AuthedRequest, res);
      if (!res.headersSent) res.json(out);
    } catch (e: any) {
      const status = Number(e?.status ?? e?.statusCode ?? 500);
      const code = status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : status === 400 ? 'VALIDATION' : status === 401 ? 'UNAUTHENTICATED' : 'SERVER';
      if (status >= 500) console.error('[ai]', e?.message ?? e);
      res.status(status).json({ error: status >= 500 ? 'AI service error' : e?.message ?? 'Error', code });
    }
  };
}

function bad(message: string) { return Object.assign(new Error(message), { status: 400 }); }
const lang = (v: unknown): Lang => (v === 'hi' ? 'hi' : 'en');

export function createAiRouter(db: Db): Router {
  const r = Router();

  r.get('/status', route(null, async () => geminiStatus()));

  /** In-app "Test key" (AI settings dialog). Body key optional: falls back to the header key, then the server key. */
  r.post('/test-key', route(null, async (req) => {
    const { key, model } = (req.body ?? {}) as { key?: unknown; model?: unknown };
    if (key !== undefined && key !== '' && !validKey(key)) throw bad('That does not look like a Google AI key (letters, digits, . _ - only, 20-200 characters).');
    if (model !== undefined && model !== '' && !validModel(model)) throw bad('Invalid model name');
    const k = (typeof key === 'string' && key.trim()) || geminiKey();
    if (!k) return { ok: false, latencyMs: 0, error: 'No key to test. Paste a Google AI Studio key first.' };
    const m = (typeof model === 'string' && model.trim()) || currentRequestAi().model || undefined;
    return testGeminiKey(k.trim(), m);
  }));

  /** Models the active key can use (falls back to the default list). */
  r.get('/models', route(null, async () => listGeminiModels(geminiKey())));
  /** Same, for a key typed in the dialog but not saved yet. */
  r.post('/models', route(null, async (req) => {
    const { key } = (req.body ?? {}) as { key?: unknown };
    if (key !== undefined && key !== '' && !validKey(key)) throw bad('That does not look like a Google AI key.');
    return listGeminiModels((typeof key === 'string' && key.trim()) || geminiKey());
  }));

  r.post('/piku', route(['piku.use'], async (req) => {
    const body = req.body as PikuRequest;
    if (!body || typeof body.message !== 'string' || !body.message.trim()) throw bad('message is required');
    return answerPiku(db, req.auth, {
      message: body.message,
      language: body.language === 'hi' || body.language === 'en' ? body.language : 'auto',
      context: body.context ?? { type: 'global' },
    });
  }));

  r.get('/piku/history', route(['piku.use'], async (req) => {
    const { contextType, contextId } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const rows = await db.find<ChatMessage>('chat_messages', (m) =>
      m.user_id === req.auth.user.user_id
      && (!contextType || (m.context_type ?? 'global') === contextType)
      && (contextId === undefined || contextId === '' ? true : m.context_id === contextId));
    rows.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    return rows.slice(-limit);
  }));

  r.post('/suggest', route(['ai.suggest', 'project.create'], async (req) => {
    const body = req.body as SuggestRequest;
    if (!body || !KINDS.includes(body.kind)) throw bad('kind is invalid');
    const acts = req.auth.actions as string[];
    if (body.kind !== 'project' && !acts.includes('ai.suggest')) throw Object.assign(new Error('Your role cannot use AI suggestions'), { status: 403 });
    return suggest(db, req.auth, body);
  }));

  r.post('/summary', route(['piku.use'], async (req) => {
    const { scope, id, language } = req.body ?? {};
    if (!SCOPES.includes(scope) || typeof id !== 'string') throw bad('scope and id are required');
    return summarize(db, req.auth, scope, id, lang(language));
  }));

  r.post('/draft-email', route(['piku.use'], async (req) => {
    const { scope, id, intent, language } = req.body ?? {};
    if (!SCOPES.includes(scope) || typeof id !== 'string') throw bad('scope and id are required');
    if (req.auth.code === 'CLIENT') throw Object.assign(new Error('Email drafting is not available in the client view'), { status: 403 });
    return draftEmail(db, req.auth, scope, id, typeof intent === 'string' ? intent : '', lang(language));
  }));

  r.post('/meeting', route(['piku.use'], async (req) => {
    const { scope, id, language } = req.body ?? {};
    if (!SCOPES.includes(scope) || typeof id !== 'string') throw bad('scope and id are required');
    return suggestMeeting(db, req.auth, scope, id, lang(language));
  }));

  return r;
}
