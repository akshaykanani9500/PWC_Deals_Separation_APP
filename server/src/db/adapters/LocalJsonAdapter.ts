/** DB_DRIVER=local: one JSON file per table in DATA_DIR. Zero setup; same tables as the Google Sheet. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { TABLES, getTable, type TableName } from '../../../../shared/schema';
import type { Db, Row } from '../Db';
import { coerceRow, nextId, normalizeRow } from '../coerce';

export class LocalJsonAdapter implements Db {
  readonly driver = 'local' as const;
  private cache = new Map<string, Row[]>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private dir: string, private opts: { inMemory?: boolean } = {}) {}

  async init(): Promise<void> {
    if (this.opts.inMemory) { for (const t of TABLES) if (!this.cache.has(t.name)) this.cache.set(t.name, []); return; }
    await fsp.mkdir(this.dir, { recursive: true });
    for (const t of TABLES) {
      const file = this.file(t.name);
      let rows: Row[] = [];
      if (fs.existsSync(file)) {
        try {
          const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
          rows = Array.isArray(parsed) ? parsed.map((r: Row) => normalizeRow(t.name, r)) : [];
        } catch (e) {
          console.warn(`[db] could not parse ${file}; starting empty for ${t.name}`, e);
        }
      }
      this.cache.set(t.name, rows);
    }
  }

  private file(table: string) { return path.join(this.dir, `${table}.json`); }

  private rows(table: TableName): Row[] {
    const r = this.cache.get(table);
    if (!r) throw new Error(`Table not loaded: ${table}. Did you call db.init()?`);
    return r;
  }

  private persist(table: TableName): Promise<void> {
    if (this.opts.inMemory) return Promise.resolve();
    const job = this.queue.then(async () => {
      const file = this.file(table);
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(this.rows(table), null, 1));
      await fsp.rename(tmp, file);
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  async all<T extends Row = Row>(table: TableName, opts?: { includeDeleted?: boolean }): Promise<T[]> {
    const rows = this.rows(table);
    const list = opts?.includeDeleted ? rows : rows.filter((r) => r.is_deleted !== 'Y');
    return list.map((r) => ({ ...r })) as T[];
  }

  async find<T extends Row = Row>(table: TableName, predicate: (row: T) => boolean): Promise<T[]> {
    return (await this.all<T>(table)).filter(predicate);
  }

  async get<T extends Row = Row>(table: TableName, id: string): Promise<T | undefined> {
    const pk = getTable(table).primaryKey;
    const r = this.rows(table).find((x) => x[pk] === id);
    return r ? ({ ...r } as T) : undefined;
  }

  private build(table: TableName, row: Row, actorId?: string, taken?: Set<string>): Row {
    const def = getTable(table);
    const rows = this.rows(table);
    const ids = taken ?? new Set(rows.map((r) => r[def.primaryKey]));
    const now = new Date().toISOString();
    const full: Row = { ...row };
    if (!full[def.primaryKey]) full[def.primaryKey] = nextId(def.idPrefix, ids);
    if (ids.has(full[def.primaryKey]) && !taken) throw new Error(`Duplicate id ${full[def.primaryKey]} in ${table}`);
    ids.add(full[def.primaryKey]);
    const hasCol = (c: string) => def.columns.some((x) => x.name === c);
    if (hasCol('created_at') && !full.created_at) full.created_at = now;
    if (hasCol('created_by') && !full.created_by && actorId) full.created_by = actorId;
    if (hasCol('is_deleted') && !full.is_deleted) full.is_deleted = 'N';
    return normalizeRow(table, full);
  }

  async insert<T extends Row = Row>(table: TableName, row: Partial<T>, actorId?: string): Promise<T> {
    const r = this.build(table, row as Row, actorId);
    this.rows(table).push(r);
    await this.persist(table);
    return { ...r } as T;
  }

  async insertMany<T extends Row = Row>(table: TableName, rows: Partial<T>[], actorId?: string): Promise<T[]> {
    const def = getTable(table);
    const taken = new Set(this.rows(table).map((r) => r[def.primaryKey]));
    const built: Row[] = [];
    for (const row of rows) {
      const pk = (row as Row)[def.primaryKey];
      if (pk && taken.has(pk)) throw new Error(`Duplicate id ${pk} in ${table}`);
      built.push(this.build(table, row as Row, actorId, taken));
    }
    this.rows(table).push(...built);
    await this.persist(table);
    return built.map((r) => ({ ...r })) as T[];
  }

  async update<T extends Row = Row>(table: TableName, id: string, patch: Partial<T>, actorId?: string): Promise<T> {
    const def = getTable(table);
    const rows = this.rows(table);
    const idx = rows.findIndex((x) => x[def.primaryKey] === id);
    if (idx < 0) throw new Error(`${table} ${id} not found`);
    const clean = coerceRow(table, patch as Row);
    delete clean[def.primaryKey];
    const merged: Row = { ...rows[idx], ...clean };
    const hasCol = (c: string) => def.columns.some((x) => x.name === c);
    if (hasCol('updated_at')) merged.updated_at = new Date().toISOString();
    if (hasCol('updated_by') && actorId) merged.updated_by = actorId;
    rows[idx] = merged;
    await this.persist(table);
    return { ...merged } as T;
  }

  async softDelete(table: TableName, id: string, actorId?: string): Promise<void> {
    await this.update(table, id, { is_deleted: 'Y' } as Row, actorId);
  }

  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of TABLES) out[t.name] = this.rows(t.name as TableName).filter((r) => r.is_deleted !== 'Y').length;
    return out;
  }

  async reload(): Promise<void> { await this.init(); }

  /** Remove every row of every table (used by seed --reset). */
  async truncateAll(): Promise<void> {
    for (const t of TABLES) {
      this.cache.set(t.name, []);
      await this.persist(t.name as TableName);
    }
  }

  /** Replace all rows of a table at once (fast seed). */
  async replaceTable(table: TableName, rows: Row[]): Promise<void> {
    this.cache.set(table, rows.map((r) => normalizeRow(table, r)));
    await this.persist(table);
  }
}
