/** Cached list of users for assignee / owner pickers (GET /api/users). */
import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import type { PersonaCode } from '@shared/types';

export interface UserOption { user_id: string; full_name: string; persona_code: PersonaCode; email?: string }

let cache: UserOption[] | null = null;
let inflight: Promise<UserOption[]> | null = null;

export function clearUsersCache() { cache = null; inflight = null; }

export function useUsers() {
  const [users, setUsers] = useState<UserOption[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    inflight ??= get<UserOption[]>('/users').then((u) => (cache = u)).catch(() => (inflight = null, [] as UserOption[]));
    let alive = true;
    inflight.then((u) => alive && setUsers(u));
    return () => { alive = false; };
  }, []);
  return users;
}

export const PERSONA_LABEL: Record<string, string> = {
  EXEC: 'Executive', PARTNER: 'Partner', MANAGER: 'Manager', LEAD: 'Workstream lead', ANALYST: 'Analyst',
  KM: 'Knowledge manager', RISK: 'Risk & DPO', CLIENT: 'Client viewer', ADMIN: 'Platform admin',
};
