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
import { generateFinanceDemo } from '../server/src/services/finance';

export async function buildSeed() {
  const data = generateSeed(new Date());
  // roll up progress/status/RAG in memory first
  const mem = new LocalJsonAdapter('', { inMemory: true });
  await mem.init();
  for (const t of TABLES) await mem.replaceTable(t.name as TableName, data[t.name as TableName]);
  for (const p of data.projects) await rollupProject(mem, p.project_id);
  // v1.3: finance workspace (costs, funding, invoices) and access-governance examples, built from the rolled-up plan.
  const all = async (t: TableName) => mem.all(t, { includeDeleted: true });
  await applyAccessTiersDemo(mem, all);
  const demo = generateFinanceDemo({
    projects: await all('projects'), stages: await all('stages'), tasks: await all('tasks'), finance_entries: await all('finance_entries'),
    project_members: await all('project_members'), users: await all('users'), personas: await all('personas'),
  }, new Date());
  addActingRoleDemo(demo.access_grants, await all('users'), await all('projects'), new Date());
  for (const [t, rows] of Object.entries(demo)) await mem.replaceTable(t as TableName, rows);
  const out: Record<string, any[]> = {};
  for (const t of TABLES) out[t.name] = await mem.all(t.name as TableName, { includeDeleted: true });
  return out;
}

/**
 * v1.4 risk-tiered approvals: Rioja (US export-controlled semiconductor deal) runs a clean team, so finance access there
 * needs Risk & Quality; Aditya covers Day-1 Readiness on Rioja (used by the acting Workstream Lead example).
 */
async function applyAccessTiersDemo(mem: LocalJsonAdapter, all: (t: TableName) => Promise<any[]>) {
  const projects = await all('projects');
  const rioja = projects.find((p) => p.code_name === 'Project Rioja');
  if (!rioja) return;
  rioja.clean_team_required = 'Y';
  await mem.replaceTable('projects', projects);
  const users = await all('users');
  const aditya = users.find((u) => u.full_name === 'Aditya Joshi')?.user_id;
  const members = await all('project_members');
  const m = members.find((x) => x.project_id === rioja.project_id && x.user_id === aditya);
  if (m) { m.workstream = 'Day-1 Readiness'; await mem.replaceTable('project_members', members); }
}

/** v1.4 acting role example: Rajiv (Partner) sponsors Aditya as acting Workstream Lead on Rioja -> waiting for Risk & Quality. */
function addActingRoleDemo(grants: any[], users: any[], projects: any[], now: Date) {
  const user = (n: string) => users.find((u) => u.full_name === n)?.user_id;
  const rioja = projects.find((p) => p.code_name === 'Project Rioja');
  const [rajiv, aditya] = [user('Rajiv Khanna'), user('Aditya Joshi')];
  if (!rioja || !rajiv || !aditya || !user('Fatima Sheikh')) return;
  const next = Math.max(0, ...grants.map((g) => Number(String(g.grant_id).split('-')[1]) || 0)) + 1;
  const at = new Date(now.getTime() - 20 * 3600000).toISOString();
  grants.push({
    grant_id: `GRT-${String(next).padStart(4, '0')}`, project_id: rioja.project_id, grantee_user_id: aditya, permission_code: 'role.LEAD', duration_days: 30,
    status: 'Pending L2', justification: 'Rohan is on leave for two weeks; Aditya covers the Day-1 Readiness workstream and must re-plan its activities and tasks.',
    requested_by: rajiv, l1_approver_id: rajiv, l1_decided_at: at, l1_note: 'Sponsored by the level-1 approver.',
    created_at: at, created_by: rajiv, updated_at: null, updated_by: null, is_deleted: 'N',
  });
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
