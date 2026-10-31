/**
 * Seed the configured database (local JSON files or Google Sheets) with demo data.
 *   npm run db:seed          -> seeds only when the database is empty
 *   npm run db:reset         -> wipes every table and seeds again
 * Also writes a snapshot to db/seed/<table>.json (committed, handy for reviewing the data).
 */
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, type TableName } from '../shared/schema';
import { generateSeed } from './seed-data';
import { LocalJsonAdapter } from '../server/src/db/adapters/LocalJsonAdapter';
import { rollupProject } from '../server/src/services/rollup';
import { createDb } from '../server/src/db/index';

export async function buildSeed() {
  const data = generateSeed(new Date());
  // roll up progress/status/RAG in memory first
  const mem = new LocalJsonAdapter('', { inMemory: true });
  await mem.init();
  for (const t of TABLES) await mem.replaceTable(t.name as TableName, data[t.name as TableName]);
  for (const p of data.projects) await rollupProject(mem, p.project_id);
  const out: Record<string, any[]> = {};
  for (const t of TABLES) out[t.name] = await mem.all(t.name as TableName, { includeDeleted: true });
  return out;
}

async function main() {
  const reset = process.argv.includes('--reset');
  const db = await createDb();
  const counts = await db.counts();
  const empty = Object.values(counts).every((n) => n === 0);
  if (!empty && !reset) {
    console.log('[seed] Database already has data. Use `npm run db:reset` to wipe and reseed.');
    return;
  }
  const data = await buildSeed();
  console.log(`[seed] Writing demo data to the ${db.driver} database...`);
  for (const t of TABLES) await db.replaceTable(t.name as TableName, data[t.name]);
  await db.markSeeded?.();
  await db.reload();
  const snapDir = path.resolve('db/seed');
  fs.mkdirSync(snapDir, { recursive: true });
  for (const t of TABLES) fs.writeFileSync(path.join(snapDir, `${t.name}.json`), JSON.stringify(data[t.name], null, 1));
  const after = await db.counts();
  console.log('[seed] Done:', Object.entries(after).map(([k, v]) => `${k}=${v}`).join(', '));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, '') === path.resolve('scripts/seed').replace(/\.ts$/, '');
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
