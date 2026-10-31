/** Export the current database to dist/DealsSeparationHub_DB.xlsx (one sheet per table). Import it into Google Sheets with File > Import. */
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, type TableName } from '../shared/schema';
import { createDb } from '../server/src/db/index';
import { buildWorkbook } from '../server/src/db/xlsx';

async function main() {
  const db = await createDb();
  const data: Record<string, any[]> = {};
  for (const t of TABLES) data[t.name] = await db.all(t.name as TableName, { includeDeleted: true });
  const wb = await buildWorkbook(data);
  const out = path.resolve(process.argv[2] || 'dist/DealsSeparationHub_DB.xlsx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await wb.xlsx.writeFile(out);
  console.log(`[xlsx] Wrote ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
