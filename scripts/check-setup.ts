/** `npm run check:setup` - prints what is configured and what is missing. */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/src/config';
import { createDb } from '../server/src/db/index';

const ok = (b: boolean) => (b ? 'OK  ' : 'MISS');
async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  console.log(`${ok(major >= 18)} Node ${process.versions.node} (need 18.18 or newer)`);
  console.log(`${ok(fs.existsSync('.env'))} .env file ${fs.existsSync('.env') ? 'found' : 'missing - copy .env.example to .env (optional)'}`);
  console.log(`     DB_DRIVER=${config.dbDriver}  DATA_DIR=${path.relative('.', config.dataDir) || '.'}`);
  if (config.dbDriver === 'sheets') {
    console.log(`${ok(!!config.googleSheetId)} GOOGLE_SHEET_ID ${config.googleSheetId || '(empty)'}`);
    console.log(`${ok(fs.existsSync(config.googleCredentials))} service-account key ${config.googleCredentials}`);
  }
  const db = await createDb();
  const counts = await db.counts();
  console.log(`${ok(db.driver === config.dbDriver)} database in use: ${db.driver}`);
  console.log(`${ok((counts.users || 0) > 0)} demo data: ${counts.projects || 0} projects, ${counts.users || 0} users${counts.users ? '' : ' - run npm run db:seed'}`);
  console.log(`${ok(!!config.geminiApiKey)} GEMINI_API_KEY ${config.geminiApiKey ? 'set (Piku uses Gemini)' : 'not set - fine: paste a key in the app (AI button in the top bar), otherwise AI runs offline'}`);
  console.log(`     Gemini models: ${config.geminiModels.length ? config.geminiModels.join(', ') + ' (retired ones are skipped) + ' : ''}auto-picked from what the key can use`);
}
main().catch((e) => { console.error(e); process.exit(1); });
