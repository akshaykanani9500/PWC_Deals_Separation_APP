import { Router } from 'express';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { AuditEntry } from '../../../shared/types';
import { SCHEMA_VERSION, TABLES, type TableName } from '../../../shared/schema';
import { ah, HttpError } from '../errors';
import { ensureAction } from '../middleware/auth';
import { visibleProjectIds } from '../services/access';
import { audit } from '../services/audit';
import { config } from '../config';
import { generateDdl, generateInserts } from '../db/oracle';
import { buildWorkbook } from '../db/xlsx';
import { initSheets, sheetsStatus } from '../services/sheetsSetup';

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

  /** Google Sheets setup card: what is configured, what is missing, optional live connection test (?test=1). */
  r.get('/sheets/status', ah(async (req, res) => {
    res.json(await sheetsStatus(db, { test: req.query.test === '1' || req.query.test === 'true' }));
  }));

  /** Create tabs (+ optionally load demo data or copy the current data) in the configured Google Sheet. */
  r.post('/sheets/init', ah(async (req, res) => {
    const { seed, source } = (req.body ?? {}) as { seed?: unknown; source?: unknown };
    const src = source === 'current' ? 'current' : 'demo';
    const out = await initSheets(db, { seed: seed === true, source: src });
    await audit(db, (req as AuthedRequest).auth, 'admin.sheets.init', { details: { seed: out.seeded, source: out.source } });
    res.json(out);
  }));

  r.post('/db/reload', ah(async (req, res) => {
    await db.reload();
    await audit(db, (req as AuthedRequest).auth, 'admin.db.reload');
    res.json({ ok: true });
  }));

  /**
   * v1.4: wipe every table and load the demo data again, exactly like a fresh start (scripts/seed.ts buildSeed, incl. the
   * finance and access demo rows). Body { confirm: 'RESET' }. User ids are stable, so signed-in sessions stay valid.
   */
  r.post('/db/reset', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    if ((req.body ?? {}).confirm !== 'RESET') throw new HttpError(400, 'Type RESET to confirm. This replaces every table except the audit log with the demo data.', 'VALIDATION');
    const target = db as Db & { replaceTable?: (t: TableName, rows: any[]) => Promise<void>; markSeeded?: () => Promise<void> };
    if (typeof target.replaceTable !== 'function') throw new HttpError(501, `The ${db.driver} database cannot be reset from the app.`, 'VALIDATION');
    const { buildSeed } = await import('../../../scripts/seed');
    const data = await buildSeed();
    // The audit trail is never wiped: keep every existing entry and append the demo history after it (re-numbered).
    const kept = await db.all<AuditEntry>('audit_log', { includeDeleted: true });
    const maxId = kept.reduce((m, a) => Math.max(m, Number(String(a.audit_id).split('-')[1]) || 0), 0);
    const seedAudit = (data.audit_log ?? []).map((a: AuditEntry, i: number) => ({ ...a, audit_id: `AUD-${String(maxId + i + 1).padStart(4, '0')}` }));
    data.audit_log = [...kept, ...seedAudit];
    for (const t of TABLES) await target.replaceTable(t.name as TableName, data[t.name] ?? []);
    await target.markSeeded?.();
    await db.reload();
    await audit(db, auth, 'admin.db.reset', { details: { driver: db.driver, tables: TABLES.length, auditKept: kept.length } });
    const counts = await db.counts();
    res.json({ ok: true, driver: db.driver, rows: Object.values(counts).reduce((s, n) => s + n, 0) });
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
