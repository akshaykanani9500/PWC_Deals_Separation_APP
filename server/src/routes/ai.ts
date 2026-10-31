/** AI routes (Agent 3 owns). Mounted by server/src/app.ts at /api/ai. */
import { Router } from 'express';
import type { Db } from '../db/Db';

export function createAiRouter(_db: Db): Router {
  const r = Router();
  r.get('/status', (_req, res) => res.json({ gemini: false, models: [] }));
  return r;
}
