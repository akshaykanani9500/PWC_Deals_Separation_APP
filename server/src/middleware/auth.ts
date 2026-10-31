import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db/Db';
import type { AuthContext, AuthedRequest } from '../auth-types';
import type { Persona, User } from '../../../shared/types';
import { PERMISSIONS, type Action } from '../../../shared/permissions';
import { config } from '../config';
import { HttpError } from '../errors';
import { audit } from '../services/audit';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function sign(payload: string) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

export function issueToken(userId: string, issuedAt = Date.now()): string {
  const payload = `${Buffer.from(userId).toString('base64url')}.${issuedAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [uid, iat, sig] = parts;
  const expected = sign(`${uid}.${iat}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number.isFinite(Number(iat)) || Date.now() - Number(iat) > TOKEN_TTL_MS) return null;
  return Buffer.from(uid, 'base64url').toString();
}

export async function buildAuthContext(db: Db, userId: string): Promise<AuthContext | null> {
  const user = await db.get<User>('users', userId);
  if (!user || user.is_deleted === 'Y' || user.is_active === 'N') return null;
  const persona = await db.get<Persona>('personas', user.persona_id);
  if (!persona) return null;
  const policy = PERMISSIONS[persona.code];
  if (!policy) return null;
  return { user, persona, code: persona.code, actions: [...policy.actions], scope: policy.scope };
}

/** Requires a valid Bearer token; sets req.auth. */
export function authenticate(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const userId = token ? verifyToken(token) : null;
      if (!userId) throw new HttpError(401, 'Please sign in again.', 'UNAUTHENTICATED');
      const ctx = await buildAuthContext(db, userId);
      if (!ctx) throw new HttpError(401, 'User not found or inactive.', 'UNAUTHENTICATED');
      (req as AuthedRequest).auth = ctx;
      next();
    } catch (e) { next(e); }
  };
}

export function hasAction(auth: AuthContext, action: Action) { return auth.actions.includes(action); }

/** Throws 403 (and audits the denial) unless the persona has one of the actions. */
export async function ensureAction(db: Db, auth: AuthContext, actions: Action | Action[], detail?: { projectId?: string | null; entity?: string; id?: string }) {
  const list = Array.isArray(actions) ? actions : [actions];
  if (list.some((a) => auth.actions.includes(a))) return;
  await audit(db, auth, 'access.denied', { type: detail?.entity, id: detail?.id, projectId: detail?.projectId, details: { needed: list } });
  throw new HttpError(403, `Your role (${auth.persona.name}) cannot do this.`, 'FORBIDDEN');
}

export function requireAction(db: Db, ...actions: Action[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try { await ensureAction(db, (req as AuthedRequest).auth, actions); next(); } catch (e) { next(e); }
  };
}
