/** Workbook with one sheet per table, row 1 = columns (same layout as the Google Sheet). */
import ExcelJS from 'exceljs';
import { SCHEMA_VERSION, TABLES } from '../../../shared/schema';
import type { Row } from './Db';
import { toCell } from './coerce';

export async function buildWorkbook(data: Record<string, Row[]>): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Deals Separation Hub';
  for (const t of TABLES) {
    const ws = wb.addWorksheet(t.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = t.columns.map((c) => c.name);
    ws.addRow(cols);
    ws.getRow(1).font = { bold: true };
    for (const r of data[t.name] || []) ws.addRow(cols.map((c) => toCell(r[c])));
    ws.columns.forEach((col, i) => { col.width = Math.min(48, Math.max(12, cols[i].length + 2)); });
  }
  const meta = wb.addWorksheet('_meta');
  meta.addRows([['key', 'value'], ['schema_version', String(SCHEMA_VERSION)], ['app', 'Deals Separation Hub'], ['exported_at', new Date().toISOString()]]);
  return wb;
}
