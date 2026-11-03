/**
 * v1.4.1: people who may own or be assigned work on a project (same rule as the server's assertTeamIds):
 * current internal team members plus the named Partner / Manager. Client viewers are left out.
 */
import { useEffect, useState } from 'react';
import type { ProjectDetail } from '@shared/types';
import { get } from '../lib/api';
import { useUsers, type UserOption } from './useUsers';

const cache = new Map<string, { at: number; ids: string[] }>();

export function useTeam(projectId?: string | null, version = 0): UserOption[] {
  const users = useUsers();
  const [ids, setIds] = useState<string[] | null>(() => (projectId ? cache.get(projectId)?.ids ?? null : null));
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const c = cache.get(projectId);
    if (c && Date.now() - c.at < 10000 && !version) { setIds(c.ids); return; }
    get<ProjectDetail>(`/projects/${projectId}`).then((d) => {
      const list = [...d.members.filter((m) => m.persona_code !== 'CLIENT').map((m) => m.user_id), d.project.partner_user_id, d.project.manager_user_id]
        .filter((x): x is string => !!x);
      const uniq = Array.from(new Set(list));
      cache.set(projectId, { at: Date.now(), ids: uniq });
      if (alive) setIds(uniq);
    }).catch(() => { /* picker falls back to empty */ });
    return () => { alive = false; };
  }, [projectId, version]);
  if (!ids) return [];
  const set = new Set(ids);
  return users.filter((u) => set.has(u.user_id) && u.persona_code !== 'CLIENT');
}

/** Team options plus the current value when it is not (or no longer) on the team, so existing data still shows. */
export function withCurrent(team: UserOption[], all: UserOption[], current?: string | null): (UserOption & { offTeam?: boolean })[] {
  if (!current || team.some((u) => u.user_id === current)) return team;
  const u = all.find((x) => x.user_id === current);
  return u ? [...team, { ...u, offTeam: true }] : team;
}
