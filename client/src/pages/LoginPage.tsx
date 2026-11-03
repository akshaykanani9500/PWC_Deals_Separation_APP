/** Login: pick a person (grouped by persona). Their persona decides every permission after this screen. */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import type { Persona, User, PersonaCode } from '@shared/types';
import { get } from '../lib/api';
import { useSession } from '../lib/session';
import { Brand } from '../components/AppShell';
import { Button, Select, Skeleton } from '../components/ui';
import { useToast } from '../components/toast';

type LoginUser = User & { persona_code: PersonaCode; persona_name: string; persona_title?: string; summary?: string };
const LAST = 'dsh.lastUser';

export default function LoginPage() {
  const { login, session } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [data, setData] = useState<{ personas: Persona[]; users: LoginUser[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>(() => { try { return localStorage.getItem(LAST) ?? ''; } catch { return ''; } });
  const [busy, setBusy] = useState<'google' | 'plain' | null>(null);

  useEffect(() => {
    get<{ personas: Persona[]; users: LoginUser[] }>('/auth/personas')
      .then((d) => {
        setData(d);
        setUserId((cur) => (cur && d.users.some((u) => u.user_id === cur) ? cur : d.users[0]?.user_id ?? ''));
      })
      .catch((e) => setError(e.message || 'Could not reach the server.'));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const order = [...data.personas].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return order.map((p) => ({ persona: p, users: data.users.filter((u) => u.persona_id === p.persona_id || u.persona_code === p.code) }))
      .filter((g) => g.users.length);
  }, [data]);

  const selected = data?.users.find((u) => u.user_id === userId);
  const persona = data?.personas.find((p) => p.persona_id === selected?.persona_id || p.code === selected?.persona_code);

  async function signIn(kind: 'google' | 'plain') {
    if (!userId) return;
    setBusy(kind); setError(null);
    try {
      const s = await login(userId);
      try { localStorage.setItem(LAST, userId); } catch { /* ignore */ }
      // v1.4: say who you are now, and how many access requests wait for you.
      const approver = s.actions.includes('access.approve') || s.actions.includes('access.review');
      const waiting = approver ? await get<{ inbox: number }>('/access/summary').then((x) => x.inbox).catch(() => 0) : 0;
      toast.success(`Signed in as ${s.user.full_name} (${s.persona.name})${waiting ? ` — ${waiting} request${waiting === 1 ? '' : 's'} waiting for you` : ''}`);
      nav(loc.state?.from && loc.state.from !== '/login' ? loc.state.from : '/', { replace: true });
    } catch (e) {
      setError((e as Error).message || 'Sign-in failed.');
    } finally { setBusy(null); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <div className="card p-6">
          <h1 className="text-[24px] font-semibold leading-tight">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-soft">Choose who you are. What you can see and change depends on your role.</p>
          {session && <p className="mt-2 rounded-md bg-sunken px-2.5 py-1.5 text-[12.5px] text-ink-soft">Currently signed in as {session.user.full_name}. Pick another person to switch.</p>}

          <div className="mt-5">
            <label htmlFor="person" className="label">Person</label>
            {!data && !error && <Skeleton className="h-8 w-full" />}
            {data && (
              <Select id="person" value={userId} onChange={(e) => setUserId(e.target.value)} className="h-9">
                {groups.map((g) => (
                  <optgroup key={g.persona.persona_id} label={g.persona.name}>
                    {g.users.map((u) => (
                      <option key={u.user_id} value={u.user_id}>{u.full_name} ({u.persona_title || g.persona.title || g.persona.name})</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </div>

          {selected && (
            <div className="mt-4 rounded-lg border border-line bg-canvas px-3.5 py-3">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <ShieldCheck size={15} className="text-brand" /> {persona?.name ?? selected.persona_name}
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{selected.summary ?? persona?.description}</p>
              {(selected.org || selected.location) && <p className="mt-1.5 text-[12px] text-ink-muted">{[selected.org, selected.location].filter(Boolean).join(', ')}</p>}
            </div>
          )}

          {error && <p className="mt-4 rounded-md bg-rose-soft px-3 py-2 text-[12.5px] text-rose">{error} Check that the server is running (npm run dev).</p>}

          <div className="mt-5 grid gap-2">
            <Button variant="secondary" className="h-9" onClick={() => signIn('google')} loading={busy === 'google'} disabled={!userId || !!busy}
              icon={<svg width="15" height="15" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>}>
              Continue with Google
            </Button>
            <Button variant="primary" className="h-9" onClick={() => signIn('plain')} loading={busy === 'plain'} disabled={!userId || !!busy}>Sign in</Button>
          </div>
          <p className="mt-4 text-[11.5px] leading-relaxed text-ink-muted">Prototype sign-in: Google sign-in is simulated and signs in the person selected above. No password is needed.</p>
        </div>
      </div>
    </div>
  );
}
