import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import { keySource } from './gemini';

/** Write an AI audit row (ai_generated = 'Y'). Never throws: auditing must not break an answer. */
export async function auditAi(db: Db, auth: AuthContext, action: string, details: Record<string, unknown>, ids: { entityType?: string; entityId?: string | null; projectId?: string | null } = {}) {
  try {
    await db.insert('audit_log', {
      actor_user_id: auth.user.user_id,
      persona_code: auth.code,
      action,
      entity_type: ids.entityType ?? 'ai',
      entity_id: ids.entityId ?? null,
      project_id: ids.projectId ?? null,
      details: JSON.stringify({ ...details, key_source: keySource() }), // where the AI key came from - never the key itself
      ai_generated: 'Y',
      created_at: new Date().toISOString(),
    }, auth.user.user_id);
  } catch { /* ignore */ }
}
