/** SheetsAdapter against an in-memory fake of the Google Sheets API (no network needed). */
import { describe, expect, it } from 'vitest';
import { SheetsAdapter } from '../src/db/adapters/SheetsAdapter';
import { SCHEMA_VERSION, TABLES } from '../../shared/schema';

function fakeSheets() {
  const tabs = new Map<string, unknown[][]>();
  const calls: string[] = [];
  const tabOf = (range: string) => range.split('!')[0].replace(/'/g, '');
  const rowOf = (range: string) => Number((range.split('!')[1] || 'A1').match(/\d+/)?.[0] || 1);
  const api = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [...tabs.keys()].map((title) => ({ properties: { title } })) } }),
      batchUpdate: async ({ requestBody }: any) => { for (const r of requestBody.requests) tabs.set(r.addSheet.properties.title, []); calls.push('addSheet'); return {}; },
      values: {
        batchGet: async ({ ranges }: any) => ({ data: { valueRanges: ranges.map((r: string) => {
          const rows = tabs.get(tabOf(r)) || [];
          return { values: r.includes('!1:1') ? rows.slice(0, 1) : rows };
        }) } }),
        batchUpdate: async ({ requestBody }: any) => { for (const d of requestBody.data) { const rows = tabs.get(tabOf(d.range)) || []; d.values.forEach((v: unknown[], i: number) => { rows[rowOf(d.range) - 1 + i] = v; }); tabs.set(tabOf(d.range), rows); } return {}; },
        append: async ({ range, requestBody }: any) => { const rows = tabs.get(tabOf(range))!; rows.push(...requestBody.values); calls.push(`append:${tabOf(range)}`); return {}; },
        update: async ({ range, requestBody }: any) => { const rows = tabs.get(tabOf(range)) || []; requestBody.values.forEach((v: unknown[], i: number) => { rows[rowOf(range) - 1 + i] = v; }); tabs.set(tabOf(range), rows); calls.push(`update:${range}`); return {}; },
        clear: async ({ range }: any) => { tabs.set(tabOf(range), []); return {}; },
      },
    },
  };
  return { api, tabs, calls };
}

describe('SheetsAdapter', () => {
  it('creates tabs with headers, appends inserts, updates the right row, reloads', async () => {
    const fake = fakeSheets();
    const db = new SheetsAdapter('sheet-id', 'unused.json');
    (db as any).sheets = fake.api;
    await db.ensureTabs();
    await (db as any).loadAll();
    for (const t of TABLES) expect(fake.tabs.get(t.name)![0]).toEqual(t.columns.map((c) => c.name));
    expect(fake.tabs.get('_meta')![1]).toEqual(['schema_version', String(SCHEMA_VERSION)]);

    const a = await db.insert<any>('projects', { code_name: 'Project A', status: 'Active', fee_budget: 100 });
    const b = await db.insert<any>('projects', { code_name: 'Project B', status: 'Planning' });
    expect([a.project_id, b.project_id]).toEqual(['PRJ-0001', 'PRJ-0002']);
    expect(fake.tabs.get('projects')!.length).toBe(3);
    await db.update('projects', 'PRJ-0002', { status: 'Active' });
    expect(fake.calls.some((c) => c.startsWith("update:'projects'!A3:"))).toBe(true);
    const header = fake.tabs.get('projects')![0] as string[];
    expect(fake.tabs.get('projects')![2][header.indexOf('status')]).toBe('Active');

    // someone edits the sheet by hand -> reload picks it up, numbers coerced
    fake.tabs.get('projects')![1][header.indexOf('fee_budget')] = '250';
    await db.reload();
    expect((await db.get('projects', 'PRJ-0001'))?.fee_budget).toBe(250);
    await db.softDelete('projects', 'PRJ-0001');
    expect((await db.all('projects')).map((p) => p.project_id)).toEqual(['PRJ-0002']);
  });

  it('appends new schema columns to an old sheet without touching existing ones', async () => {
    const fake = fakeSheets();
    for (const t of TABLES) fake.tabs.set(t.name, [t.columns.slice(0, 3).map((c) => c.name)]);
    fake.tabs.set('_meta', []);
    const db = new SheetsAdapter('sheet-id', 'unused.json');
    (db as any).sheets = fake.api;
    await db.ensureTabs();
    expect(fake.tabs.get('tasks')![0]).toEqual(TABLES.find((t) => t.name === 'tasks')!.columns.map((c) => c.name));
  });
});

import { withRetry } from '../src/db/adapters/SheetsAdapter';
describe('Sheets write retry', () => {
  it('retries 429 and 503, gives up on 403', async () => {
    let n = 0;
    const r = await withRetry(async () => { n++; if (n < 3) throw Object.assign(new Error('quota'), { code: n === 1 ? 429 : 503 }); return 'ok'; }, 5, 1);
    expect(r).toBe('ok');
    expect(n).toBe(3);
    let m = 0;
    await expect(withRetry(async () => { m++; throw Object.assign(new Error('denied'), { code: 403 }); }, 5, 1)).rejects.toThrow('denied');
    expect(m).toBe(1);
  });
});
