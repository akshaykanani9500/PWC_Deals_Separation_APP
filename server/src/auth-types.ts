import type { Request } from 'express';
import type { Persona, PersonaCode, User } from '../../shared/types';
import type { Action } from '../../shared/permissions';

/** Set on every authenticated request by middleware/auth.ts */
export interface AuthContext {
  user: User;
  persona: Persona;
  code: PersonaCode;
  actions: Action[];
  scope: 'all' | 'member';
  /** Role actions before any project grant was applied (set on first use of applyProjectGrants). */
  baseActions?: Action[];
  /** Project whose grants are currently merged into `actions` (null = none). */
  grantProjectId?: string | null;
  grantIds?: string[];
  /** v1.4: acting role on `grantProjectId` (from an active role.* grant). Row rules use it instead of `code`. */
  actingCode?: PersonaCode;
}

export type AuthedRequest = Request & { auth: AuthContext };
