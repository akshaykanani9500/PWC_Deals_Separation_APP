import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { KnowledgeItem, Project } from '../../../shared/types';
import { CONSENT_STATUS, DEAL_TYPES, INDUSTRIES, KNOWLEDGE_STATUS, KNOWLEDGE_TYPES } from '../../../shared/schema';
import { ah, HttpError } from '../errors';
import { ensureAction, hasAction } from '../middleware/auth';
import { assertProjectAccess } from '../services/access';
import { audit } from '../services/audit';
import { closeoutPreview } from '../services/closeout';
import { today } from '../services/rollup';

const strip = (k: KnowledgeItem) => { const { source_project_id: _s, ...rest } = k; return rest; };

/** /api/projects/:id/closeout... */
export function closeoutRouter(db: Db): Router {
  const r = Router({ mergeParams: true });

  r.get('/:id/closeout/preview', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'project.close', { projectId: project.project_id, entity: 'project', id: project.project_id });
    if (project.status === 'Closed') throw new HttpError(400, 'Project is already closed.', 'VALIDATION');
    res.json(await closeoutPreview(db, auth, project));
  }));

  r.post('/:id/closeout', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const project = await assertProjectAccess(db, auth, req.params.id);
    await ensureAction(db, auth, 'project.close', { projectId: project.project_id, entity: 'project', id: project.project_id });
    if (project.status === 'Closed') throw new HttpError(400, 'Project is already closed.', 'VALIDATION');
    const body = z.object({
      consent: z.enum(CONSENT_STATUS),
      lessons: z.string().optional().default(''),
      items: z.array(z.object({
        item_type: z.enum(KNOWLEDGE_TYPES), title: z.string().min(1), body: z.string().optional().nullable(), payload: z.any().optional(),
        stage_name: z.string().optional().nullable(), tags: z.string().optional().nullable(), source_label: z.string().optional().nullable(),
        deal_type: z.enum(DEAL_TYPES).optional().nullable(), industry: z.enum(INDUSTRIES).optional().nullable(),
      }).passthrough()).optional().default([]),
    }).parse(req.body);
    const me = auth.user.user_id;
    const updated = await db.update<Project>('projects', project.project_id, { status: 'Closed', closed_date: today(), reuse_consent: body.consent }, me);
    let created: KnowledgeItem[] = [];
    if (body.consent === 'Granted') {
      const label = body.items.find((i) => i.source_label)?.source_label || `${project.industry || 'Deal'} ${project.deal_type?.toLowerCase() || 'separation'} (anonymised)`;
      const rows: Partial<KnowledgeItem>[] = body.items.map((i) => ({
        source_project_id: project.project_id, source_label: i.source_label || label, item_type: i.item_type, deal_type: i.deal_type ?? project.deal_type,
        industry: i.industry ?? project.industry, stage_name: i.stage_name ?? undefined, title: i.title, body: i.body ?? undefined,
        payload: i.payload == null ? null : typeof i.payload === 'string' ? i.payload : JSON.stringify(i.payload), tags: i.tags ?? undefined,
        consent_status: 'Granted', review_status: 'Pending Review', times_used: 0,
      }));
      if (body.lessons.trim() && !body.items.some((i) => i.item_type === 'Lesson')) {
        rows.push({ source_project_id: project.project_id, source_label: label, item_type: 'Lesson', deal_type: project.deal_type, industry: project.industry, stage_name: 'Close-out', title: `Lessons learned - ${label}`, body: body.lessons, consent_status: 'Granted', review_status: 'Pending Review', times_used: 0, tags: 'lessons' });
      }
      if (rows.length) created = await db.insertMany<KnowledgeItem>('knowledge_items', rows, me);
      await audit(db, auth, 'closeout.submit', { type: 'project', id: project.project_id, projectId: project.project_id, details: { consent: body.consent, knowledge_items: created.length } });
    } else {
      await audit(db, auth, 'closeout.archive_only', { type: 'project', id: project.project_id, projectId: project.project_id, details: { consent: body.consent } });
    }
    res.json({ project: updated, knowledgeItems: created.map(strip) });
  }));
  return r;
}

export function knowledgeRouter(db: Db): Router {
  const r = Router();
  r.get('/', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    await ensureAction(db, auth, 'knowledge.view', { entity: 'knowledge' });
    const { status, type, q, industry, deal_type } = req.query as Record<string, string | undefined>;
    const reviewer = hasAction(auth, 'knowledge.edit') || hasAction(auth, 'closeout.approve');
    let items = await db.all<KnowledgeItem>('knowledge_items');
    if (!reviewer) items = items.filter((k) => k.review_status === 'Approved');
    if (status) items = items.filter((k) => k.review_status === status);
    if (type) items = items.filter((k) => k.item_type === type);
    if (industry) items = items.filter((k) => k.industry === industry);
    if (deal_type) items = items.filter((k) => k.deal_type === deal_type);
    if (q) { const s = q.toLowerCase(); items = items.filter((k) => [k.title, k.body, k.tags, k.stage_name, k.source_label].some((v) => v?.toLowerCase().includes(s))); }
    items.sort((a, b) => (a.review_status === 'Pending Review' ? -1 : 0) - (b.review_status === 'Pending Review' ? -1 : 0) || (a.created_at < b.created_at ? 1 : -1));
    res.json(items.map(strip));
  }));

  r.patch('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    await ensureAction(db, auth, ['knowledge.edit', 'closeout.approve'], { entity: 'knowledge', id: req.params.id });
    const item = await db.get<KnowledgeItem>('knowledge_items', req.params.id);
    if (!item || item.is_deleted === 'Y') throw new HttpError(404, 'Knowledge item not found.', 'NOT_FOUND');
    const patch: Partial<KnowledgeItem> = z.object({
      review_status: z.enum(KNOWLEDGE_STATUS).optional(), title: z.string().min(1).optional(), body: z.string().optional(), tags: z.string().optional(),
    }).parse(req.body);
    if (patch.review_status && patch.review_status !== item.review_status) { patch.reviewed_by = auth.user.user_id; patch.reviewed_at = new Date().toISOString(); }
    const updated = await db.update<KnowledgeItem>('knowledge_items', item.knowledge_id, patch, auth.user.user_id);
    await audit(db, auth, patch.review_status ? `knowledge.${patch.review_status === 'Approved' ? 'approve' : patch.review_status === 'Rejected' ? 'reject' : 'update'}` : 'knowledge.update', { type: 'knowledge', id: item.knowledge_id, details: patch });
    res.json(strip(updated));
  }));
  return r;
}
