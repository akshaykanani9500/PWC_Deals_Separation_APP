import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthedRequest } from '../auth-types';
import type { User } from '../../../shared/types';
import * as S from '../../../shared/schema';
import { ah } from '../errors';
import { authenticate } from '../middleware/auth';
import { config } from '../config';
import { userIndex } from './helpers';

export function metaRouter(db: Db): Router {
  const r = Router();
  r.get('/meta', (_req, res) => {
    res.json({
      enums: {
        personaCodes: S.PERSONA_CODES, projectStatus: S.PROJECT_STATUS, rag: S.RAG, workStatus: S.WORK_STATUS, priority: S.PRIORITY,
        gateStatus: S.GATE_STATUS, dealTypes: S.DEAL_TYPES, industries: S.INDUSTRIES, commChannels: S.COMM_CHANNELS, contactSides: S.CONTACT_SIDES,
        memberRoles: S.MEMBER_ROLES, knowledgeTypes: S.KNOWLEDGE_TYPES, knowledgeStatus: S.KNOWLEDGE_STATUS, consentStatus: S.CONSENT_STATUS,
        sensitivity: S.SENSITIVITY, languages: S.LANGUAGES,
      },
      dbDriver: db.driver,
      aiMode: config.geminiApiKey ? 'gemini' : 'offline',
      schemaVersion: S.SCHEMA_VERSION,
      appVersion: config.appVersion,
    });
  });

  r.get('/users', authenticate(db), ah(async (_req, res) => {
    const idx = await userIndex(db);
    const users = (await db.all<User>('users')).filter((u) => u.is_active !== 'N');
    res.json(users.map((u) => ({ user_id: u.user_id, full_name: u.full_name, persona_code: idx.code(u.user_id), email: u.email })));
  }));

  r.put('/users/me/preferences', authenticate(db), ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const body = z.object({ dashboard_layout: z.any().optional(), preferred_language: z.enum(S.LANGUAGES).optional() }).parse(req.body);
    const patch: Partial<User> = {};
    if (body.dashboard_layout !== undefined) patch.dashboard_layout = body.dashboard_layout === null ? null : typeof body.dashboard_layout === 'string' ? body.dashboard_layout : JSON.stringify(body.dashboard_layout);
    if (body.preferred_language) patch.preferred_language = body.preferred_language;
    const user = await db.update<User>('users', auth.user.user_id, patch, auth.user.user_id);
    res.json(user);
  }));
  return r;
}
