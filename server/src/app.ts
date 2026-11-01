import express from 'express';
import cors from 'cors';
import type { Db } from './db/Db';
import { authenticate } from './middleware/auth';
import { errorHandler } from './errors';
import { authRouter } from './routes/auth';
import { metaRouter } from './routes/meta';
import { dashboardRouter } from './routes/dashboard';
import { projectsRouter } from './routes/projects';
import { stagesRouter } from './routes/stages';
import { activitiesRouter, tasksRouter } from './routes/activities';
import { notesRouter } from './routes/notes';
import { closeoutRouter, knowledgeRouter } from './routes/knowledge';
import { adminRouter, auditRouter } from './routes/admin';
import { createAiRouter } from './routes/ai';
import { requestAiMiddleware } from './ai/requestAi';

export function createApp(db: Db): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));
  // Gemini key/model chosen in the in-app AI settings travel as headers; make them request-scoped.
  app.use('/api', requestAiMiddleware);

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true, driver: db.driver }));
  api.use('/auth', authRouter(db));
  api.use(metaRouter(db)); // /meta (public), /users, /users/me/preferences

  const auth = authenticate(db);
  api.use('/dashboard', auth, dashboardRouter(db));
  api.use('/projects', auth, closeoutRouter(db), projectsRouter(db));
  api.use('/stages', auth, stagesRouter(db));
  api.use('/activities', auth, activitiesRouter(db));
  api.use('/tasks', auth, tasksRouter(db));
  api.use('/notes', auth, notesRouter(db));
  api.use('/knowledge', auth, knowledgeRouter(db));
  api.use('/audit', auth, auditRouter(db));
  api.use('/admin', auth, adminRouter(db));
  api.use('/ai', auth, createAiRouter(db));
  api.use((_req, res) => res.status(404).json({ error: 'API route not found.', code: 'NOT_FOUND' }));

  app.use('/api', api);
  app.use('/api', errorHandler);
  return app;
}
