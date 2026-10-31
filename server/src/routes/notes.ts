import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { QuickNote } from '../../../shared/types';
import { ah, HttpError } from '../errors';
import { ensureAction } from '../middleware/auth';
import { assertProjectAccess } from '../services/access';
import { audit } from '../services/audit';
import { assertOpen } from './helpers';

export function notesRouter(db: Db): Router {
  const r = Router();
  r.post('/', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const body = z.object({
      project_id: z.string(), stage_id: z.string().optional().nullable(), activity_id: z.string().optional().nullable(),
      task_id: z.string().optional().nullable(), body: z.string().min(1).max(4000), pinned: z.enum(['Y', 'N']).optional(),
    }).parse(req.body);
    const project = await assertProjectAccess(db, auth, body.project_id);
    await ensureAction(db, auth, 'notes.add', { projectId: project.project_id, entity: 'note' });
    assertOpen(project);
    const note = await db.insert<QuickNote>('quick_notes', { ...body, pinned: body.pinned ?? 'N' }, auth.user.user_id);
    await audit(db, auth, 'note.create', { type: 'note', id: note.note_id, projectId: project.project_id });
    res.status(201).json({ ...note, author_name: auth.user.full_name });
  }));

  r.delete('/:id', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const note = await db.get<QuickNote>('quick_notes', req.params.id);
    if (!note || note.is_deleted === 'Y') throw new HttpError(404, 'Note not found.', 'NOT_FOUND');
    await assertProjectAccess(db, auth, note.project_id);
    if (note.created_by !== auth.user.user_id) throw new HttpError(403, 'Only the author can delete a note.', 'FORBIDDEN');
    await db.softDelete('quick_notes', note.note_id, auth.user.user_id);
    await audit(db, auth, 'note.delete', { type: 'note', id: note.note_id, projectId: note.project_id });
    res.json({ ok: true });
  }));
  return r;
}
