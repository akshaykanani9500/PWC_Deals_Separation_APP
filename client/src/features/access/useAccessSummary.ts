/**
 * Access counts and the top-bar bell feed. Both refresh on focus, every 60 s and after any access change.
 * v1.4: useAccessFeed + "last seen" per user (localStorage, best effort) to count unseen updates on my own requests.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AccessFeed, AccessRequestRow } from '@shared/types';
import { get } from '../../lib/api';

export const ACCESS_CHANGED_EVENT = 'dsh:access-changed';
export interface AccessSummary { inbox: number; mine: number; activeForMe: number }

function useLive<T>(path: string, enabled: boolean) {
  const [s, setS] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) { setS(null); return; }
    let alive = true;
    const load = () => get<T>(path).then((x) => alive && setS(x)).catch(() => undefined);
    load();
    const t = setInterval(load, 60000);
    window.addEventListener('focus', load);
    window.addEventListener(ACCESS_CHANGED_EVENT, load);
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', load); window.removeEventListener(ACCESS_CHANGED_EVENT, load); };
  }, [enabled, path, tick]);
  return { data: s, reload };
}

export function useAccessSummary(enabled: boolean) {
  return useLive<AccessSummary>('/access/summary', enabled).data;
}

export function useAccessFeed(enabled: boolean) {
  return useLive<AccessFeed>('/access/feed', enabled);
}

const seenKey = (userId: string) => `dsh.access.seen.${userId}`;

export function getLastSeen(userId: string): string {
  try { return localStorage.getItem(seenKey(userId)) ?? ''; } catch { return ''; }
}

export function setLastSeen(userId: string, iso = new Date().toISOString()) {
  try { localStorage.setItem(seenKey(userId), iso); } catch { /* private mode: badge just stays */ }
}

/** Updates on my requests that someone else (or the system) caused after I last opened the bell. */
export function isUnseen(row: AccessRequestRow, me: string, lastSeen: string): boolean {
  return !!row.last_event_at && row.last_event_at > lastSeen && row.last_event_by !== me;
}
