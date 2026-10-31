import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { geminiGenerate, geminiJson, safeJsonParse, geminiStatus } from '../src/ai/gemini';
import { answerPiku } from '../src/ai/piku';
import { suggest } from '../src/ai/suggest';
import { makeDb, authFor, USERS } from './aiFixtures';
import type { LocalJsonAdapter } from '../src/db/adapters/LocalJsonAdapter';

let db: LocalJsonAdapter;
beforeAll(async () => { db = await makeDb(); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODELS; });

const ok = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

describe('Gemini client', () => {
  it('returns null without a key (offline)', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await geminiGenerate('hi')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(geminiStatus().gemini).toBe(false);
  });

  it('tries models in order, sends the key as a header, and parses a success', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODELS = 'model-a,model-b';
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce(ok('Hello from B'));
    vi.stubGlobal('fetch', f);
    const r = await geminiGenerate('ping');
    expect(r).toEqual({ text: 'Hello from B', model: 'model-b' });
    expect(f.mock.calls[0][0]).toContain('/models/model-a:generateContent');
    expect(f.mock.calls[1][0]).toContain('/models/model-b:generateContent');
    expect(f.mock.calls[0][0]).not.toContain('test-key');
    expect(f.mock.calls[0][1].headers['x-goog-api-key']).toBe('test-key');
    expect(geminiStatus().lastModelUsed).toBe('model-b');
  });

  it('returns null when every model throws (network down)', async () => {
    process.env.GEMINI_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')));
    expect(await geminiGenerate('x')).toBeNull();
  });

  it('parses JSON with fences or prose', async () => {
    expect(safeJsonParse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(safeJsonParse('Sure! {"b":[1,2]} done')).toEqual({ b: [1, 2] });
    expect(safeJsonParse('nope')).toBeNull();
    process.env.GEMINI_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok('{"x": "y"}')));
    expect(await geminiJson('q')).toEqual({ data: { x: 'y' }, model: 'gemini-2.5-flash' });
  });

  it('Piku falls back to the offline engine when Gemini is unreachable', async () => {
    process.env.GEMINI_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const r = await answerPiku(db, await authFor(db, USERS.manager), { message: 'Summarise the risks and next steps here', language: 'en', context: { type: 'project', projectId: 'PRJ-0001' } });
    expect(r.mode).toBe('offline');
    expect(r.answer.length).toBeGreaterThan(20);
  });

  it('Piku uses Gemini text when available (level 2+)', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const f = vi.fn().mockResolvedValue(ok('Phoenix has **3** overdue items [1].'));
    vi.stubGlobal('fetch', f);
    const r = await answerPiku(db, await authFor(db, USERS.manager), { message: 'What is overdue and blocked here?', language: 'en', context: { type: 'project', projectId: 'PRJ-0001' } });
    expect(r.mode).toBe('gemini-2.5-flash');
    expect(r.answer).toContain('overdue items');
    const prompt = JSON.parse(f.mock.calls[0][1].body).contents[0].parts[0].text as string;
    expect(prompt).toContain('FACTS');
    expect(prompt).not.toContain('Project Rioja'); // never another project's data
  });

  it('suggest ignores an invalid Gemini draft and keeps the deterministic one', async () => {
    process.env.GEMINI_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok('{"draft": {"oops": true}, "rationale": "bad"}')));
    const r = await suggest(db, await authFor(db, USERS.manager), { kind: 'project', hints: { deal_type: 'TSA exit' } });
    expect(r.mode).toBe('offline');
    expect((r.draft as any).stages).toHaveLength(5);
  });
});
