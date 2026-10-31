/**
 * Prepare a Google Sheet as the database:
 *   npm run db:init-sheets            -> creates one tab per table with the header row (+ _meta tab)
 *   npm run db:init-sheets -- --seed  -> also loads the demo data (overwrites the tabs)
 * Needs GOOGLE_SHEET_ID and GOOGLE_APPLICATION_CREDENTIALS in .env, and the sheet shared (Editor) with the service-account email.
 */
import fs from 'node:fs';
import 'dotenv/config';
import { TABLES, type TableName } from '../shared/schema';
import { SheetsAdapter } from '../server/src/db/adapters/SheetsAdapter';
import { config } from '../server/src/config';
import { buildSeed } from './seed';

async function main() {
  const seed = process.argv.includes('--seed');
  if (!config.googleSheetId) throw new Error('GOOGLE_SHEET_ID is empty in .env. Copy the long id from the sheet URL: docs.google.com/spreadsheets/d/<THIS PART>/edit');
  if (!fs.existsSync(config.googleCredentials)) throw new Error(`Service-account key not found at ${config.googleCredentials}. See README "Connect Google Sheets".`);
  try {
    const key = JSON.parse(fs.readFileSync(config.googleCredentials, 'utf8'));
    console.log(`[sheets] Using service account ${key.client_email} - make sure the sheet is shared with it as Editor.`);
  } catch { /* ignore */ }
  const db = new SheetsAdapter(config.googleSheetId, config.googleCredentials);
  await db.init();
  console.log(`[sheets] Tabs ready: ${TABLES.map((t) => t.name).join(', ')}, _meta`);
  if (seed) {
    const data = await buildSeed();
    for (const t of TABLES) {
      await db.replaceTable(t.name as TableName, data[t.name]);
      console.log(`[sheets] ${t.name}: ${data[t.name].length} rows`);
    }
    await db.markSeeded();
    await db.reload();
  }
  console.log('[sheets] Done. Set DB_DRIVER=sheets in .env and run `npm run dev`.');
}

main().catch((e) => { console.error('[sheets] Failed:', e?.message || e); process.exit(1); });
