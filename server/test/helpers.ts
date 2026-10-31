import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { TABLES, type TableName } from '../../shared/schema';
import { LocalJsonAdapter } from '../src/db/adapters/LocalJsonAdapter';
import { createApp } from '../src/app';
import { buildSeed } from '../../scripts/seed';

export async function makeTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-'));
  const db = new LocalJsonAdapter(dir);
  await db.init();
  const data = await buildSeed();
  for (const t of TABLES) await db.replaceTable(t.name as TableName, data[t.name]);
  const app = createApp(db);
  const tokens = new Map<string, string>();
  const login = async (userId: string) => {
    if (!tokens.has(userId)) {
      const res = await request(app).post('/api/auth/login').send({ userId });
      if (res.status !== 200) throw new Error(`login failed for ${userId}: ${res.status} ${JSON.stringify(res.body)}`);
      tokens.set(userId, res.body.token);
    }
    return tokens.get(userId)!;
  };
  const as = (userId: string) => ({
    get: async (url: string) => request(app).get(url).set('Authorization', `Bearer ${await login(userId)}`),
    post: async (url: string, body: unknown = {}) => request(app).post(url).set('Authorization', `Bearer ${await login(userId)}`).send(body as object),
    patch: async (url: string, body: unknown) => request(app).patch(url).set('Authorization', `Bearer ${await login(userId)}`).send(body as object),
    del: async (url: string) => request(app).delete(url).set('Authorization', `Bearer ${await login(userId)}`),
  });
  return { app, db, dir, data, as, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Demo users (see scripts/seed-data.ts). */
export const USERS = {
  exec: 'USR-0001', sarah: 'USR-0002', rajiv: 'USR-0003', ananya: 'USR-0004', daniel: 'USR-0005', kavya: 'USR-0006',
  arjun: 'USR-0007', priya: 'USR-0008', rohan: 'USR-0009', neha: 'USR-0010', karan: 'USR-0011', sneha: 'USR-0012', aditya: 'USR-0013',
  meera: 'USR-0014', fatima: 'USR-0015', lisa: 'USR-0016', kenji: 'USR-0017', rahul: 'USR-0018',
};
