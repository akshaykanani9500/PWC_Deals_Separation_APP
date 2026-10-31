import { Router } from 'express';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { AuditEntry } from '../../../shared/types';
import { SCHEMA_VERSION, TABLES, type TableName } from '../../../shared/schema';
import { ah } from '../errors';
import { ensureAction } from '../middleware/auth';
import { visibleProjectIds } from '../services/access';
import { audit } from '../services/audit';
import { config } from '../config';
import { generateDdl, generateInserts } from '../db/oracle';
import { buildWorkbook } from '../db/xlsx';

async function dump(db: Db) {
  const data: Record<string, any[]> = {};
  for (const t of TABLES) data[t.name] = await db.all(t.name as TableName, { includeDeleted: true });
  return data;
}

export function auditRouter(db: Db): Router {
  const r = Router();
  r.get('/', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    await ensureAction(db, auth, 'audit.view', { entity: 'audit' });
    const { projectId, limit } = req.query as Record<string, string | undefined>;
    const ids = await visibleProjectIds(db, auth);
    let rows = await db.all<AuditEntry>('audit_log');
    if (auth.scope !== 'all') rows = rows.filter((a) => !a.project_id || ids.has(a.project_id));
    if (projectId) rows = rows.filter((a) => a.project_id === projectId);
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    res.json(rows.slice(0, Math.min(1000, Number(limit) || 200)));
  }));
  return r;
}

export function adminRouter(db: Db): Router {
  const r = Router();
  r.use(ah(async (req, _res, next) => { await ensureAction(db, (req as AuthedRequest).auth, 'admin.data', { entity: 'admin' }); next(); }));

  r.get('/db', ah(async (_req, res) => {
    const counts = await db.counts();
    res.json({ driver: db.driver, sheetId: db.driver === 'sheets' ? config.googleSheetId : undefined, schemaVersion: SCHEMA_VERSION, tables: TABLES.map((t) => ({ name: t.name, rows: counts[t.name] ?? 0 })) });
  }));

  r.post('/db/reload', ah(async (req, res) => {
    await db.reload();
    await audit(db, (req as AuthedRequest).auth, 'admin.db.reload');
    res.json({ ok: true });
  }));

  r.get('/export/oracle', ah(async (req, res) => {
    const sql = `${generateDdl()}\n\n${generateInserts(await dump(db))}`;
    await audit(db, (req as AuthedRequest).auth, 'admin.export.oracle');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="deals_separation_hub_oracle.sql"');
    res.send(sql);
  }));

  r.get('/export/xlsx', ah(async (req, res) => {
    const wb = await buildWorkbook(await dump(db));
    await audit(db, (req as AuthedRequest).auth, 'admin.export.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="DealsSeparationHub_DB.xlsx"');
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }));
  return r;
}
