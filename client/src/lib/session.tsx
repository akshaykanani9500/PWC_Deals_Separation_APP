/** Session context: who is signed in and what they may do. Use `useSession()` anywhere in the app. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@shared/types';
import type { Action } from '@shared/permissions';
import { get, post, setToken, getToken } from './api';

interface SessionCtx {
  session: Session | null;
  loading: boolean;
  login: (userId: string) => Promise<Session>;
  logout: () => Promise<void>;
  can: (action: Action) => boolean;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    get<Session>('/auth/me').then(setSession).catch(() => setToken(null)).finally(() => setLoading(false));
    const onUnauth = () => setSession(null);
    window.addEventListener('dsh:unauthorized', onUnauth);
    return () => window.removeEventListener('dsh:unauthorized', onUnauth);
  }, []);

  const login = useCallback(async (userId: string) => {
    const s = await post<Session>('/auth/login', { userId });
    setToken(s.token);
    setSession(s);
    return s;
  }, []);

  const logout = useCallback(async () => {
    try { await post('/auth/logout'); } catch { /* ignore */ }
    setToken(null);
    setSession(null);
  }, []);

  const can = useCallback((a: Action) => !!session?.actions.includes(a), [session]);
  const value = useMemo(() => ({ session, loading, login, logout, can }), [session, loading, login, logout, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
