/** Badge counts for the "Access" link in the top bar. Refreshes on focus, every 60 s and after any access change. */
import { useEffect, useState } from 'react';
import { get } from '../../lib/api';

export const ACCESS_CHANGED_EVENT = 'dsh:access-changed';
export interface AccessSummary { inbox: number; mine: number; activeForMe: number }

export function useAccessSummary(enabled: boolean) {
  const [s, setS] = useState<AccessSummary | null>(null);
  useEffect(() => {
    if (!enabled) { setS(null); return; }
    let alive = true;
    const load = () => get<AccessSummary>('/access/summary').then((x) => alive && setS(x)).catch(() => undefined);
    load();
    const t = setInterval(load, 60000);
    window.addEventListener('focus', load);
    window.addEventListener(ACCESS_CHANGED_EVENT, load);
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', load); window.removeEventListener(ACCESS_CHANGED_EVENT, load); };
  }, [enabled]);
  return s;
}
