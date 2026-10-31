/** Writes db/oracle/data.sql (INSERTs, FK-safe order) from the configured database (local or Google Sheets). */
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, type TableName } from '../shared/schema';
import { createDb } from '../server/src/db/index';
import { generateInserts } from '../server/src/db/oracle';

async function main() {
  const db = await createDb();
  const data: Record<string, any[]> = {};
  for (const t of TABLES) data[t.name] = await db.all(t.name as TableName, { includeDeleted: true });
  const out = path.resolve(process.argv[2] || 'db/oracle/data.sql');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, generateInserts(data));
  console.log(`[oracle] Wrote ${out} (${Object.values(data).reduce((s, r) => s + r.length, 0)} rows)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
