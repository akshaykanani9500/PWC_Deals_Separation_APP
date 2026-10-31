/** Type coercion between storage (strings in Sheets/JSON) and app rows, driven by shared/schema.ts. */
import { getTable, type ColumnDef } from '../../../shared/schema';
import type { Row } from './Db';

function coerceValue(col: ColumnDef, v: unknown): unknown {
  if (v === undefined || v === null || v === '') {
    if (col.type === 'bool' && col.name === 'is_deleted') return 'N';
    return null;
  }
  switch (col.type) {
    case 'int': {
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    case 'number':
    case 'money': {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'bool': {
      if (v === true) return 'Y';
      if (v === false) return 'N';
      const s = String(v).trim().toUpperCase();
      return s === 'Y' || s === 'TRUE' || s === 'YES' || s === '1' ? 'Y' : 'N';
    }
    case 'json':
      return typeof v === 'string' ? v : JSON.stringify(v);
    case 'date': {
      const s = String(v);
      return s.length >= 10 ? s.slice(0, 10) : s;
    }
    default:
      return String(v);
  }
}

/** Coerce every known column of a row; unknown keys are dropped. */
export function coerceRow(table: string, row: Row): Row {
  const def = getTable(table);
  const out: Row = {};
  for (const col of def.columns) {
    if (col.name in row) out[col.name] = coerceValue(col, row[col.name]);
  }
  return out;
}

/** Full row with every column present (missing -> null). */
export function normalizeRow(table: string, row: Row): Row {
  const def = getTable(table);
  const out: Row = {};
  for (const col of def.columns) out[col.name] = coerceValue(col, row[col.name]);
  return out;
}

/** Value for a spreadsheet cell. */
export function toCell(v: unknown): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  return String(v);
}

export function nextId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of existing) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}
