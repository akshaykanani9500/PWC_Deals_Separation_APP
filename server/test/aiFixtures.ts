/** Shared fixtures for AI tests: a private copy of the committed seed data in a temp folder. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalJsonAdapter } from '../src/db/adapters/LocalJsonAdapter';
import { buildAuthContext } from '../src/middleware/auth';
import type { AuthContext } from '../src/auth-types';

export async function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-test-'));
  const seed = path.resolve(process.cwd(), 'db/seed');
  for (const f of fs.readdirSync(seed)) if (f.endsWith('.json')) fs.copyFileSync(path.join(seed, f), path.join(dir, f));
  const db = new LocalJsonAdapter(dir);
  await db.init();
  return db;
}

export async function authFor(db: LocalJsonAdapter, userId: string): Promise<AuthContext> {
  const a = await buildAuthContext(db, userId);
  if (!a) throw new Error(`no auth for ${userId}`);
  return a;
}

export const USERS = {
  exec: 'USR-0001', partner: 'USR-0002', manager: 'USR-0004', lead: 'USR-0007', analyst: 'USR-0010',
  km: 'USR-0014', risk: 'USR-0015', client: 'USR-0016', admin: 'USR-0018',
};
