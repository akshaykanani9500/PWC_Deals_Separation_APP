import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export type ErrCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'SERVER';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code: ErrCode = status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION' : 'SERVER') {
    super(message);
  }
}

export const forbidden = (msg = 'You do not have permission to do this.') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`, 'NOT_FOUND');
export const badRequest = (msg: string) => new HttpError(400, msg, 'VALIDATION');

/** Wrap async route handlers so thrown errors reach the error handler. */
export const ah = <R extends Request = Request>(fn: (req: R, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req as R, res, next).catch(next); };

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof ZodError) {
    const msg = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return res.status(400).json({ error: msg, code: 'VALIDATION' });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.', code: 'VALIDATION' });
  console.error('[api] unexpected error:', err);
  return res.status(500).json({ error: err?.message || 'Unexpected server error.', code: 'SERVER' });
}
