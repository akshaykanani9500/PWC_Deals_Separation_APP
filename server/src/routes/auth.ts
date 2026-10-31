import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { Persona, Session, User } from '../../../shared/types';
import { PERMISSIONS } from '../../../shared/permissions';
import { ah, HttpError } from '../errors';
import { authenticate, buildAuthContext, issueToken } from '../middleware/auth';
import { audit } from '../services/audit';

export function authRouter(db: Db): Router {
  const r = Router();

  r.get('/personas', ah(async (_req, res) => {
    const personas = (await db.all<Persona>('personas')).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const byId = new Map(personas.map((p) => [p.persona_id, p]));
    const users = (await db.all<User>('users')).filter((u) => u.is_active !== 'N').map((u) => {
      const p = byId.get(u.persona_id);
      return {
        user_id: u.user_id, full_name: u.full_name, email: u.email, location: u.location, org: u.org, persona_id: u.persona_id,
        persona_code: p?.code, persona_name: p?.name, persona_title: p?.title, summary: p ? PERMISSIONS[p.code]?.summary : '',
      };
    }).sort((a, b) => (byId.get(a.persona_id)?.sort_order ?? 0) - (byId.get(b.persona_id)?.sort_order ?? 0) || a.full_name.localeCompare(b.full_name));
    res.json({ personas, users });
  }));

  r.post('/login', ah(async (req, res) => {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
    const ctx = await buildAuthContext(db, userId);
    if (!ctx) throw new HttpError(401, 'Unknown user.', 'UNAUTHENTICATED');
    const session: Session = { token: issueToken(userId), user: ctx.user, persona: ctx.persona, actions: ctx.actions, scope: ctx.scope };
    await audit(db, ctx, 'auth.login', { type: 'user', id: userId });
    res.json(session);
  }));

  r.get('/me', authenticate(db), ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const header = req.headers.authorization || '';
    const session: Session = { token: header.slice(7), user: auth.user, persona: auth.persona, actions: auth.actions, scope: auth.scope };
    res.json(session);
  }));

  r.post('/logout', (_req, res) => res.json({ ok: true }));
  return r;
}
