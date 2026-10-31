import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';

export async function audit(
  db: Db,
  auth: AuthContext | null,
  action: string,
  entity: { type?: string; id?: string | null; projectId?: string | null; details?: unknown; ai?: boolean } = {},
): Promise<void> {
  try {
    await db.insert('audit_log', {
      actor_user_id: auth?.user.user_id ?? null,
      persona_code: auth?.code ?? null,
      action,
      entity_type: entity.type ?? null,
      entity_id: entity.id ?? null,
      project_id: entity.projectId ?? null,
      details: entity.details === undefined ? null : JSON.stringify(entity.details),
      ai_generated: entity.ai ? 'Y' : 'N',
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[audit] could not write audit entry', e);
  }
}
