/**
 * Finance workspace API (v1.3), mounted under /api/projects.
 *   GET    /:id/finance                         finance.view (role, or an approved access grant on this project)
 *   POST   /:id/finance/{funding|costs|invoices}        finance.edit, project open
 *   PATCH  /:id/finance/{funding|costs|invoices}/:rowId finance.edit, project open
 *   DELETE /:id/finance/{funding|costs|invoices}/:rowId finance.edit, project open (soft delete)
 * Every change is audited. Nothing here contacts a bank or investor: the workspace is for visibility.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { TableName } from '../../../shared/schema';
import { COST_CATEGORIES, COST_PAYERS, COST_STATUS, FUNDING_STATUS, FUNDING_TYPES, INVOICE_STATUS } from '../../../shared/schema';
import { ah, HttpError } from '../errors';
import { ensureAction } from '../middleware/auth';
import { assertProjectAccess } from '../services/access';
import { audit } from '../services/audit';
import { buildFinanceWorkspace } from '../services/finance';
import { assertOpen } from './helpers';

const optStr = z.string().max(2000).optional().nullable();
const optNum = z.coerce.number().min(0).optional().nullable();
const money = z.coerce.number().min(0).max(1e12);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().nullable().or(z.literal('').transform(() => null));

const KINDS = {
  funding: {
    table: 'funding_sources' as TableName, pk: 'funding_id', label: 'funding source',
    schema: z.object({
      source_type: z.enum(FUNDING_TYPES), provider: optStr, amount: money, status: z.enum(FUNDING_STATUS),
      interest_rate_pct: z.coerce.number().min(0).max(100).optional().nullable(), tenor_months: z.coerce.number().int().min(0).max(600).optional().nullable(),
      purpose: optStr, expected_date: isoDate, owner_user_id: optStr, notes: optStr,
    }),
  },
  costs: {
    table: 'cost_items' as TableName, pk: 'cost_id', label: 'cost line',
    schema: z.object({
      category: z.enum(COST_CATEGORIES), description: z.string().max(240).optional().nullable(), amount: money, status: z.enum(COST_STATUS),
      payer: z.enum(COST_PAYERS).optional().nullable(), vendor: optStr, stage_id: optStr, activity_id: optStr,
    }),
  },
  invoices: {
    table: 'invoices' as TableName, pk: 'invoice_id', label: 'invoice',
    schema: z.object({
      invoice_no: z.string().min(1).max(40), period_month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM').optional().nullable(), stage_id: optStr,
      description: z.string().max(240).optional().nullable(), amount: money, status: z.enum(INVOICE_STATUS), issued_date: isoDate, due_date: isoDate, paid_date: isoDate,
      billed_by_user_id: optStr, billed_to: optStr,
    }),
  },
} as const;
type Kind = keyof typeof KINDS;

export function financeRouter(db: Db): Router {
  const r = Router();

  r.get('/:id/finance', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'finance.view', { projectId: project.project_id, entity: 'finance' });
    res.json(await buildFinanceWorkspace(db, auth, project));
  }));

  const kindOf = (k: string): (typeof KINDS)[Kind] => {
    const def = (KINDS as Record<string, (typeof KINDS)[Kind]>)[k];
    if (!def) throw new HttpError(404, 'Unknown finance record type.', 'NOT_FOUND');
    return def;
  };

  /** Stage / activity / owner ids sent by the browser must belong to this project. */
  async function checkRefs(projectId: string, body: Record<string, any>) {
    if (body.stage_id) { const s = await db.get('stages', body.stage_id); if (!s || s.project_id !== projectId) throw new HttpError(400, 'That stage is not part of this project.', 'VALIDATION'); }
    if (body.activity_id) { const a = await db.get('activities', body.activity_id); if (!a || a.project_id !== projectId) throw new HttpError(400, 'That activity is not part of this project.', 'VALIDATION'); }
    for (const k of ['owner_user_id', 'billed_by_user_id']) if (body[k]) { const u = await db.get('users', body[k]); if (!u) throw new HttpError(400, 'Unknown person.', 'VALIDATION'); }
  }

  async function guard(req: AuthedRequest) {
    const { auth } = req;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'finance.edit', { projectId: project.project_id, entity: 'finance' });
    assertOpen(project);
    return project;
  }

  r.post('/:id/finance/:kind', ah(async (req, res) => {
    const def = kindOf(req.params.kind);
    const project = await guard(req as AuthedRequest);
    const { auth } = req as AuthedRequest;
    const body = def.schema.parse(req.body) as Record<string, any>;
    await checkRefs(project.project_id, body);
    const row: Record<string, any> = await db.insert(def.table, { ...body, project_id: project.project_id }, auth.user.user_id);
    await audit(db, auth, `finance.${req.params.kind}.create`, { type: def.table, id: row[def.pk], projectId: project.project_id, details: body });
    res.status(201).json(row);
  }));

  r.patch('/:id/finance/:kind/:rowId', ah(async (req, res) => {
    const def = kindOf(req.params.kind);
    const project = await guard(req as AuthedRequest);
    const { auth } = req as AuthedRequest;
    const existing = await db.get(def.table, req.params.rowId);
    if (!existing || existing.is_deleted === 'Y' || existing.project_id !== project.project_id) throw new HttpError(404, `That ${def.label} was not found.`, 'NOT_FOUND');
    const patch = (def.schema as z.ZodObject<any>).partial().parse(req.body) as Record<string, any>;
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    await checkRefs(project.project_id, patch);
    const row = await db.update(def.table, req.params.rowId, patch, auth.user.user_id);
    await audit(db, auth, `finance.${req.params.kind}.update`, { type: def.table, id: req.params.rowId, projectId: project.project_id, details: patch });
    res.json(row);
  }));

  r.delete('/:id/finance/:kind/:rowId', ah(async (req, res) => {
    const def = kindOf(req.params.kind);
    const project = await guard(req as AuthedRequest);
    const { auth } = req as AuthedRequest;
    const existing = await db.get(def.table, req.params.rowId);
    if (!existing || existing.is_deleted === 'Y' || existing.project_id !== project.project_id) throw new HttpError(404, `That ${def.label} was not found.`, 'NOT_FOUND');
    await db.softDelete(def.table, req.params.rowId, auth.user.user_id);
    await audit(db, auth, `finance.${req.params.kind}.delete`, { type: def.table, id: req.params.rowId, projectId: project.project_id });
    res.json({ ok: true });
  }));

  return r;
}
