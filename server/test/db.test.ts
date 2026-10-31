import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalJsonAdapter } from '../src/db/adapters/LocalJsonAdapter';
import { coerceRow, nextId } from '../src/db/coerce';
import { generateDdl, ORACLE_RESERVED } from '../src/db/oracle';
import { TABLES } from '../../shared/schema';

describe('LocalJsonAdapter', () => {
  it('inserts with generated ids, updates, soft-deletes and persists to disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-db-'));
    const db = new LocalJsonAdapter(dir);
    await db.init();
    const a = await db.insert<any>('projects', { code_name: 'Project Test', status: 'Active', fee_budget: '1200' as any }, 'USR-0001');
    const b = await db.insert<any>('projects', { code_name: 'Project Two', status: 'Planning' });
    expect(a.project_id).toBe('PRJ-0001');
    expect(b.project_id).toBe('PRJ-0002');
    expect(a.fee_budget).toBe(1200);
    expect(a.is_deleted).toBe('N');
    expect(a.created_by).toBe('USR-0001');
    expect(a.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const u = await db.update<any>('projects', a.project_id, { status: 'At Risk', clean_team_required: true as any }, 'USR-0002');
    expect(u.status).toBe('At Risk');
    expect(u.clean_team_required).toBe('Y');
    expect(u.updated_by).toBe('USR-0002');
    await db.softDelete('projects', b.project_id);
    expect((await db.all('projects')).map((p) => p.project_id)).toEqual(['PRJ-0001']);
    expect((await db.all('projects', { includeDeleted: true })).length).toBe(2);
    // reload from disk
    const db2 = new LocalJsonAdapter(dir);
    await db2.init();
    expect((await db2.get('projects', 'PRJ-0001'))?.status).toBe('At Risk');
    await expect(db.insert('projects', { project_id: 'PRJ-0001', code_name: 'dup', status: 'Active' })).rejects.toThrow(/Duplicate/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('coerces types per schema', () => {
    const r = coerceRow('tasks', { effort_hours: '12.5', sort_order: '3', day1_critical: 'TRUE', due_date: '2026-11-04T00:00:00Z', unknown: 1 });
    expect(r).toEqual({ effort_hours: 12.5, sort_order: 3, day1_critical: 'Y', due_date: '2026-11-04' });
    expect(nextId('TSK', ['TSK-0009', 'TSK-0010', 'X-1'])).toBe('TSK-0011');
  });
});

describe('Oracle readiness', () => {
  it('no table or column uses an Oracle reserved word, names fit 30 chars', () => {
    for (const t of TABLES) {
      expect(ORACLE_RESERVED.has(t.name.toUpperCase())).toBe(false);
      expect(t.name.length).toBeLessThanOrEqual(30);
      for (const c of t.columns) {
        expect(ORACLE_RESERVED.has(c.name.toUpperCase()), `${t.name}.${c.name}`).toBe(false);
        expect(c.name.length).toBeLessThanOrEqual(30);
      }
    }
  });

  it('DDL has one CREATE TABLE per table, unique constraint names and FKs', () => {
    const ddl = generateDdl();
    expect((ddl.match(/^CREATE TABLE/gm) || []).length).toBe(TABLES.length);
    const names = ddl.match(/CONSTRAINT [a-z0-9_]+/g) || [];
    expect(new Set(names).size).toBe(names.length);
    expect(ddl).toContain('FOREIGN KEY (project_id) REFERENCES projects (project_id)');
    expect(ddl).toContain("CHECK (is_deleted IN ('Y','N'))");
  });
});
