/** Signed-in layout: top bar, navigation, user menu, Piku bubble. */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronDown, LogOut, Repeat2 } from 'lucide-react';
import { useSession } from '../lib/session';
import { Avatar } from './ui';
import Piku from '../features/piku/Piku';

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand font-display text-[15px] font-semibold text-white">D</span>
      <span className="leading-tight">
        <span className="block text-[14px] font-semibold text-ink">Deals Separation Hub</span>
        {!compact && <span className="block text-[11px] text-ink-muted">on the PwC Deals Stack</span>}
      </span>
    </Link>
  );
}

export default function AppShell() {
  const { session, can, logout } = useSession();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!session) return null;
  const links = [
    { to: '/', label: 'Dashboard', show: true, end: true },
    { to: '/knowledge', label: 'Knowledge hub', show: can('knowledge.view') },
    { to: '/audit', label: 'Audit log', show: can('audit.view') },
    { to: '/admin/data', label: 'Data admin', show: can('admin.data') },
  ].filter((l) => l.show);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-5">
          <Brand />
          <nav className="flex items-center gap-1" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}
                className={({ isActive }) => clsx('rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-sunken text-ink' : 'text-ink-soft hover:bg-sunken/70 hover:text-ink')}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto" ref={menuRef}>
            <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-sunken" aria-haspopup="menu" aria-expanded={menu}>
              <Avatar name={session.user.full_name} size={28} />
              <span className="hidden text-left leading-tight md:block">
                <span className="block text-[13px] font-medium">{session.user.full_name}</span>
                <span className="block text-[11.5px] text-ink-muted">{session.persona.name}</span>
              </span>
              <ChevronDown size={14} className="text-ink-muted" />
            </button>
            {menu && (
              <div role="menu" className="absolute right-5 mt-1 w-72 rounded-lg border border-line bg-surface p-1.5 shadow-pop">
                <div className="px-2.5 py-2">
                  <div className="text-[13px] font-medium">{session.user.full_name}</div>
                  <div className="text-[12px] text-ink-muted">{session.user.email}</div>
                  <div className="mt-2 inline-flex rounded bg-brand-soft px-1.5 py-[1px] text-[11.5px] font-medium text-brand-dark">{session.persona.name}</div>
                  <p className="mt-2 text-[12px] text-ink-soft">{session.persona.title}</p>
                </div>
                <div className="my-1 border-t border-line" />
                <button role="menuitem" onClick={() => { setMenu(false); nav('/login'); }} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px] hover:bg-sunken"><Repeat2 size={14} /> Switch persona</button>
                <button role="menuitem" onClick={async () => { setMenu(false); await logout(); nav('/login'); }} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px] hover:bg-sunken"><LogOut size={14} /> Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-5 pb-24 pt-5">
        <Outlet />
      </main>
      <Piku />
    </div>
  );
}
