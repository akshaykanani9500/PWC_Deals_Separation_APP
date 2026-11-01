/**
 * v1.1: Gemini key entered in the UI (x-ai-key header), request-scoped via AsyncLocalStorage,
 * per-key breaker state, /ai/test-key, /ai/models, and Google Sheets setup endpoints.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { makeTestApp, USERS } from './helpers';
import { geminiGenerate, geminiKey, geminiModels, geminiStatus, keySource, resetGeminiState } from '../src/ai/gemini';
import { withRequestAi, keyFingerprint } from '../src/ai/requestAi';

const UI_KEY = 'AQ.uiKey_ABCDEFGHIJKLMNOPQRSTUV0123';
const ENV_KEY = 'AIzaEnvKey_abcdefghijklmnopqrstuv999';

const ok = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }), text: async () => '' });
const denied = () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }), text: async () => JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }) });

let t: Awaited<ReturnType<typeof makeTestApp>>;
let token = '';
let adminToken = '';
beforeAll(async () => {
  t = await makeTestApp();
  token = (await request(t.app).post('/api/auth/login').send({ userId: USERS.ananya })).body.token;
  adminToken = (await request(t.app).post('/api/auth/login').send({ userId: USERS.rahul })).body.token;
});
afterAll(() => t.cleanup());
beforeEach(() => { resetGeminiState(); delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODELS; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.GEMINI_API_KEY; });

const authed = (method: 'get' | 'post', url: string, headers: Record<string, string> = {}) => {
  let r = request(t.app)[method](url).set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r;
};

describe('request-scoped AI key', () => {
  it('uses the browser key over the env key, and the env key when no header', async () => {
    process.env.GEMINI_API_KEY = ENV_KEY;
    expect(geminiKey()).toBe(ENV_KEY);
    expect(keySource()).toBe('server');
    withRequestAi({ key: UI_KEY, model: 'gemini-x' }, () => {
      expect(geminiKey()).toBe(UI_KEY);
      expect(keySource()).toBe('browser');
      expect(geminiModels()[0]).toBe('gemini-x');
    });
    delete process.env.GEMINI_API_KEY;
    expect(keySource()).toBe('none');
  });

  it('sends the header key to Google for Piku and labels the answer with the model', async () => {
    const f = vi.fn().mockResolvedValue(ok('Phoenix is on track [1].'));
    vi.stubGlobal('fetch', f);
    const res = await authed('post', '/api/ai/piku', { 'x-ai-key': UI_KEY, 'x-ai-model': 'gemini-3.6-flash' })
      .send({ message: 'Compare the risks and next steps across my projects', language: 'en', context: { type: 'global' } });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalled();
    for (const c of f.mock.calls) expect(c[1].headers['x-goog-api-key']).toBe(UI_KEY);
    const gen = f.mock.calls.find((c) => String(c[0]).includes(':generateContent'))!;
    expect(String(gen[0])).toContain('gemini-3.6-flash'); // the model chosen in the UI is tried first
    expect(res.body.mode).toBe('gemini-3.6-flash');
  });

  it('status reports the key source per request', async () => {
    const none = await authed('get', '/api/ai/status');
    expect(none.body).toMatchObject({ gemini: false, source: 'none', serverKeyPresent: false });
    const browser = await authed('get', '/api/ai/status', { 'x-ai-key': UI_KEY });
    expect(browser.body).toMatchObject({ gemini: true, source: 'browser' });
    expect(JSON.stringify(browser.body)).not.toContain(UI_KEY);
  });

  it('keeps breaker state per key: a rejected env key does not block a good browser key', async () => {
    process.env.GEMINI_API_KEY = ENV_KEY;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(denied()));
    expect(await geminiGenerate('hi')).toBeNull();
    expect(geminiStatus().pausedUntil).toBeTruthy();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok('fine')));
    const r = await withRequestAi({ key: UI_KEY }, () => geminiGenerate('hi'));
    expect(r?.text).toBe('fine');
    expect(withRequestAi({ key: UI_KEY }, () => geminiStatus().pausedUntil)).toBeUndefined();
    expect(geminiStatus().pausedUntil).toBeTruthy(); // env key still paused
  });

  it('rejects malformed keys with 400', async () => {
    const res = await authed('get', '/api/ai/status', { 'x-ai-key': 'short' });
    expect(res.status).toBe(400);
    // ...but a bad stored key never blocks normal screens
    const dash = await authed('get', '/api/dashboard', { 'x-ai-key': 'short' });
    expect(dash.status).toBe(200);
    const res2 = await authed('post', '/api/ai/test-key').send({ key: 'has spaces and ; stuff in it!!' });
    expect(res2.status).toBe(400);
  });

  it('never logs, echoes or audits the key', async () => {
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(denied()));
    const res = await authed('post', '/api/ai/summary', { 'x-ai-key': UI_KEY }).send({ scope: 'project', id: 'PRJ-0001' });
    const tk = await authed('post', '/api/ai/test-key', { 'x-ai-key': UI_KEY }).send({});
    expect(JSON.stringify(res.body)).not.toContain(UI_KEY);
    expect(JSON.stringify(tk.body)).not.toContain(UI_KEY);
    for (const s of spies) for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain(UI_KEY);
    const audit = await t.db.all<any>('audit_log');
    expect(JSON.stringify(audit)).not.toContain(UI_KEY);
    expect(JSON.stringify(audit)).not.toContain(keyFingerprint(UI_KEY));
    expect(audit.some((a) => String(a.details ?? '').includes('"key_source":"browser"'))).toBe(true);
  });
});

describe('/ai/test-key and /ai/models', () => {
  it('test-key: success returns the model that answered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok('OK')));
    const res = await authed('post', '/api/ai/test-key').send({ key: UI_KEY, model: 'gemini-3.6-flash' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, model: 'gemini-3.6-flash' });
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('test-key: a retired or locked model is skipped and the first working model is returned', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('?pageSize=')) return { ok: true, status: 200, json: async () => ({ models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      ] }) };
      if (url.includes('gemini-2.5-flash')) return { ok: false, status: 403, text: async () => JSON.stringify({ error: { message: 'Access to model gemini-2.5-flash is limited to previous users' } }) };
      if (url.includes('gemini-3.8-flash')) return { ok: false, status: 429, text: async () => '{"error":{"message":"Quota exceeded"}}' };
      // a thinking model can return no visible text for a tiny reply - still counts as working
      return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }) };
    }));
    const res = await authed('post', '/api/ai/test-key').send({ key: UI_KEY, model: 'gemini-1.5-flash' });
    expect(res.body).toMatchObject({ ok: true, model: 'gemini-3.5-flash-lite' });
    expect(res.body.tried.map((t: any) => t.model)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite', ]);
    expect(JSON.stringify(res.body)).not.toContain('gemini-1.5-flash'); // retired: never tried
  });

  it('test-key: lists every model tried when none works', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('?pageSize=')) return { ok: true, status: 200, json: async () => ({ models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] }) };
      return { ok: false, status: 429, text: async () => '{"error":{"message":"Quota exceeded"}}' };
    }));
    const res = await authed('post', '/api/ai/test-key').send({ key: UI_KEY });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/gemini-3\.6-flash \(free-tier quota/);
  });

  it('test-key: a rejected key gives a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '{}', json: async () => ({}) }));
    const res = await authed('post', '/api/ai/test-key').send({ key: UI_KEY });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/rejected this key/i);
  });

  it('test-key: network failure is explained', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const res = await authed('post', '/api/ai/test-key').send({ key: UI_KEY });
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toMatch(/could not reach google/i);
  });

  it('test-key: no key at all', async () => {
    const res = await authed('post', '/api/ai/test-key').send({});
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toMatch(/no key/i);
  });

  it('models: falls back to defaults when Google is unreachable, filters the real list otherwise', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const fb = await authed('get', '/api/ai/models', { 'x-ai-key': UI_KEY });
    expect(fb.body.source).toBe('default');
    expect(fb.body.models[0].name).toBe('gemini-3.8-flash');
    expect(fb.body.models.map((m: any) => m.name).some((n: string) => /1\.5|2\.0/.test(n))).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ models: [
      { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    ] }) }));
    const real = await authed('post', '/api/ai/models').send({ key: UI_KEY });
    expect(real.body).toEqual({ source: 'google', models: [{ name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', recommended: true }] });
  });
});

describe('Google Sheets setup endpoints', () => {
  it('are admin-only', async () => {
    const s = await authed('get', '/api/admin/sheets/status');
    expect(s.status).toBe(403);
    const i = await authed('post', '/api/admin/sheets/init').send({ seed: true });
    expect(i.status).toBe(403);
  });

  it('explain what is missing when not configured', async () => {
    const prevId = process.env.GOOGLE_SHEET_ID; const prevKey = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GOOGLE_SHEET_ID = ''; process.env.GOOGLE_APPLICATION_CREDENTIALS = '/nonexistent/key.json';
    try {
      const s = await request(t.app).get('/api/admin/sheets/status').set('Authorization', `Bearer ${adminToken}`);
      expect(s.status).toBe(200);
      expect(s.body.ready).toBe(false);
      expect(s.body.missing.join(' ')).toMatch(/GOOGLE_SHEET_ID/);
      expect(s.body.missing.join(' ')).toMatch(/key file not found/i);
      expect(s.body.steps.length).toBeGreaterThan(2);
      const i = await request(t.app).post('/api/admin/sheets/init').set('Authorization', `Bearer ${adminToken}`).send({ seed: true });
      expect(i.status).toBe(400);
      expect(i.body.error).toMatch(/not configured/i);
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_SHEET_ID; else process.env.GOOGLE_SHEET_ID = prevId;
      if (prevKey === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS; else process.env.GOOGLE_APPLICATION_CREDENTIALS = prevKey;
    }
  });
});
