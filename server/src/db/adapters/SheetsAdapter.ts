/**
 * DB_DRIVER=sheets: Google Sheets as the database.
 *  - one tab per table, row 1 = column names in the order of shared/schema.ts
 *  - `_meta` tab: key/value rows (schema_version, seeded_at)
 *  - all tabs are read once into memory (one batchGet); reads are served from memory
 *  - writes go to memory and then to the sheet through a single serialized queue
 *    (append for inserts, one-row update for updates) so concurrent requests never clash
 *  - edit the sheet by hand? call POST /api/admin/db/reload (or restart) to re-read it
 */
import { google, type sheets_v4 } from 'googleapis';
import { SCHEMA_VERSION, TABLES, getTable, type TableName } from '../../../../shared/schema';
import type { Db, Row } from '../Db';
import { coerceRow, nextId, normalizeRow, toCell } from '../coerce';

function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export class SheetsAdapter implements Db {
  readonly driver = 'sheets' as const;
  private sheets!: sheets_v4.Sheets;
  private cache = new Map<string, Row[]>();
  /** column order actually present in the sheet for each tab */
  private headers = new Map<string, string[]>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private spreadsheetId: string, private keyFile: string) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.then(fn);
    this.queue = job.catch((e) => console.error('[sheets] write failed:', e?.message || e));
    return job;
  }

  async init(): Promise<void> {
    const auth = new google.auth.GoogleAuth({ keyFile: this.keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    this.sheets = google.sheets({ version: 'v4', auth });
    await this.ensureTabs();
    await this.loadAll();
  }

  /** Create missing tabs, write header rows, append any new schema columns. */
  async ensureTabs(): Promise<void> {
    const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId, fields: 'sheets.properties.title' });
    const existing = new Set((meta.data.sheets || []).map((s) => s.properties?.title || ''));
    const wanted = [...TABLES.map((t) => t.name), '_meta'];
    const missing = wanted.filter((n) => !existing.has(n));
    if (missing.length) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) },
      });
    }
    const res = await this.sheets.spreadsheets.values.batchGet({ spreadsheetId: this.spreadsheetId, ranges: TABLES.map((t) => `'${t.name}'!1:1`) });
    const data: sheets_v4.Schema$ValueRange[] = [];
    TABLES.forEach((t, i) => {
      const current = ((res.data.valueRanges?.[i]?.values?.[0] as string[]) || []).map(String);
      const header = [...current];
      for (const c of t.columns) if (!header.includes(c.name)) header.push(c.name);
      this.headers.set(t.name, header);
      if (header.length !== current.length) data.push({ range: `'${t.name}'!A1`, values: [header] });
    });
    data.push({ range: `'_meta'!A1`, values: [['key', 'value'], ['schema_version', String(SCHEMA_VERSION)], ['app', 'Deals Separation Hub']] });
    await this.sheets.spreadsheets.values.batchUpdate({ spreadsheetId: this.spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  }

  private async loadAll(): Promise<void> {
    const res = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: this.spreadsheetId,
      ranges: TABLES.map((t) => `'${t.name}'`),
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    TABLES.forEach((t, i) => {
      const values = (res.data.valueRanges?.[i]?.values as unknown[][]) || [];
      const header = ((values[0] as string[]) || this.headers.get(t.name) || []).map(String);
      this.headers.set(t.name, header.length ? header : t.columns.map((c) => c.name));
      const rows: Row[] = [];
      for (let r = 1; r < values.length; r++) {
        const raw: Row = {};
        header.forEach((h, c) => { raw[h] = values[r][c]; });
        if (!raw[t.primaryKey]) { rows.push({ __blank: true }); continue; } // keep row index aligned
        rows.push(normalizeRow(t.name, raw));
      }
      this.cache.set(t.name, rows);
    });
  }

  private rows(table: TableName): Row[] {
    const r = this.cache.get(table);
    if (!r) throw new Error(`Table not loaded: ${table}`);
    return r;
  }

  private toValues(table: TableName, row: Row): (string | number)[] {
    return (this.headers.get(table) || []).map((h) => toCell(row[h]));
  }

  async all<T extends Row = Row>(table: TableName, opts?: { includeDeleted?: boolean }): Promise<T[]> {
    return this.rows(table).filter((r) => !r.__blank && (opts?.includeDeleted || r.is_deleted !== 'Y')).map((r) => ({ ...r })) as T[];
  }

  async find<T extends Row = Row>(table: TableName, predicate: (row: T) => boolean): Promise<T[]> {
    return (await this.all<T>(table)).filter(predicate);
  }

  async get<T extends Row = Row>(table: TableName, id: string): Promise<T | undefined> {
    const pk = getTable(table).primaryKey;
    const r = this.rows(table).find((x) => !x.__blank && x[pk] === id);
    return r ? ({ ...r } as T) : undefined;
  }

  private build(table: TableName, row: Row, taken: Set<string>, actorId?: string): Row {
    const def = getTable(table);
    const full: Row = { ...row };
    if (!full[def.primaryKey]) full[def.primaryKey] = nextId(def.idPrefix, taken);
    if (taken.has(full[def.primaryKey])) throw new Error(`Duplicate id ${full[def.primaryKey]} in ${table}`);
    taken.add(full[def.primaryKey]);
    const has = (c: string) => def.columns.some((x) => x.name === c);
    if (has('created_at') && !full.created_at) full.created_at = new Date().toISOString();
    if (has('created_by') && !full.created_by && actorId) full.created_by = actorId;
    if (has('is_deleted') && !full.is_deleted) full.is_deleted = 'N';
    return normalizeRow(table, full);
  }

  private taken(table: TableName) {
    const pk = getTable(table).primaryKey;
    return new Set(this.rows(table).filter((r) => !r.__blank).map((r) => r[pk] as string));
  }

  async insert<T extends Row = Row>(table: TableName, row: Partial<T>, actorId?: string): Promise<T> {
    return (await this.insertMany<T>(table, [row], actorId))[0];
  }

  async insertMany<T extends Row = Row>(table: TableName, rows: Partial<T>[], actorId?: string): Promise<T[]> {
    const taken = this.taken(table);
    const built = rows.map((r) => this.build(table, r as Row, taken, actorId));
    this.rows(table).push(...built);
    await this.enqueue(() => this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `'${table}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: built.map((r) => this.toValues(table, r)) },
    }));
    return built.map((r) => ({ ...r })) as T[];
  }

  async update<T extends Row = Row>(table: TableName, id: string, patch: Partial<T>, actorId?: string): Promise<T> {
    const def = getTable(table);
    const rows = this.rows(table);
    const idx = rows.findIndex((x) => !x.__blank && x[def.primaryKey] === id);
    if (idx < 0) throw new Error(`${table} ${id} not found`);
    const clean = coerceRow(table, patch as Row);
    delete clean[def.primaryKey];
    const merged: Row = { ...rows[idx], ...clean };
    const has = (c: string) => def.columns.some((x) => x.name === c);
    if (has('updated_at')) merged.updated_at = new Date().toISOString();
    if (has('updated_by') && actorId) merged.updated_by = actorId;
    rows[idx] = merged;
    const sheetRow = idx + 2;
    const width = (this.headers.get(table) || []).length;
    await this.enqueue(() => this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `'${table}'!A${sheetRow}:${colLetter(width)}${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [this.toValues(table, merged)] },
    }));
    return { ...merged } as T;
  }

  async softDelete(table: TableName, id: string, actorId?: string): Promise<void> {
    await this.update(table, id, { is_deleted: 'Y' } as Row, actorId);
  }

  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of TABLES) out[t.name] = (await this.all(t.name as TableName)).length;
    return out;
  }

  async reload(): Promise<void> {
    await this.queue;
    await this.loadAll();
  }

  /** Seed helper: overwrite a whole tab (header + rows) in one call. */
  async replaceTable(table: TableName, rows: Row[]): Promise<void> {
    const header = getTable(table).columns.map((c) => c.name);
    this.headers.set(table, header);
    const normalized = rows.map((r) => normalizeRow(table, r));
    this.cache.set(table, normalized);
    await this.enqueue(async () => {
      await this.sheets.spreadsheets.values.clear({ spreadsheetId: this.spreadsheetId, range: `'${table}'` });
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `'${table}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [header, ...normalized.map((r) => this.toValues(table, r))] },
      });
    });
  }

  async truncateAll(): Promise<void> {
    for (const t of TABLES) await this.replaceTable(t.name as TableName, []);
  }

  async markSeeded(): Promise<void> {
    await this.enqueue(() => this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `'_meta'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['key', 'value'], ['schema_version', String(SCHEMA_VERSION)], ['app', 'Deals Separation Hub'], ['seeded_at', new Date().toISOString()]] },
    }));
  }
}
