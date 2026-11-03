/**
 * Project-scoped access grants (v1.3). A grant adds permissions for ONE person on ONE project, only after two approvals
 * (L1 engagement, L2 Risk & Quality) and only until it expires or is revoked. Rules live in shared/access.ts.
 *
 * Grants are merged into `auth.actions` only while a request works on that project (assertProjectAccess and the AI scope
 * resolver call applyProjectGrants). Portfolio-wide screens (dashboard, project list) always use the role's own actions,
 * so a grant on one deal never leaks data from another.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { AccessGrant, PersonaCode } from '../../../shared/types';
import type { Action } from '../../../shared/permissions';
import { RANK, grantActions, grantState, grantable } from '../../../shared/access';

export async function activeGrantsFor(db: Db, userId: string, projectId: string, now = Date.now()): Promise<AccessGrant[]> {
  const rows = await db.find<AccessGrant>('access_grants', (g) => g.grantee_user_id === userId && g.project_id === projectId && g.status === 'Active');
  return rows.filter((g) => grantState(g, now) === 'Active' && (!g.starts_at || Date.parse(g.starts_at) <= now));
}

/** Merge the user's active grants for `projectId` into auth.actions (or reset to the role's actions when null). */
export async function applyProjectGrants(db: Db, auth: AuthContext, projectId: string | null): Promise<void> {
  if (!auth.baseActions) auth.baseActions = [...auth.actions];
  if (auth.grantIds && auth.grantProjectId === projectId) return;
  const actions = new Set<Action>(auth.baseActions);
  const ids: string[] = [];
  let acting: PersonaCode | undefined;
  if (projectId && auth.code !== 'CLIENT') {
    for (const g of await activeGrantsFor(db, auth.user.user_id, projectId)) {
      for (const a of grantActions(g.permission_code)) actions.add(a);
      ids.push(g.grant_id);
      // v1.4 acting role: the most senior one wins; it only ever raises the person's level on this project.
      const role = grantable(g.permission_code)?.actingRole;
      if (role && RANK[role] > RANK[auth.code] && (!acting || RANK[role] > RANK[acting])) acting = role;
    }
  }
  auth.actions = [...actions];
  auth.grantProjectId = projectId;
  auth.grantIds = ids;
  auth.actingCode = acting;
}

/** The persona whose ROW rules apply (stage ownership etc.): the acting role on this project, else the real one. */
export function rowCode(auth: AuthContext, projectId?: string | null): PersonaCode {
  if (auth.actingCode && (projectId === undefined || projectId === auth.grantProjectId)) return auth.actingCode;
  return auth.code;
}

/** Did this action come from a grant (not from the role)? */
export function viaGrant(auth: AuthContext, action: Action): boolean {
  return !!auth.baseActions && !auth.baseActions.includes(action) && auth.actions.includes(action);
}
