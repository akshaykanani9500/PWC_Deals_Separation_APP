/**
 * Signed-in layout: dark workspace bar (brand, navigation, AI status, user menu) with a Chrome-style strip of
 * open projects underneath. The active tab merges into the page below, like a browser.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Accessibility, ChevronDown, LayoutDashboard, LogOut, MoreHorizontal, Repeat2, X } from 'lucide-react';
import { useSession } from '../lib/session';
import { usePrefs, type TextSize } from '../lib/prefs';
import { useOpenTabs, MAX_VISIBLE_TABS, type OpenTab } from '../lib/openTabs';
import { Avatar, onTabListKey } from './ui';
import Piku from '../features/piku/Piku';
import AiStatusButton from '../features/ai/AiStatusButton';

export function Brand({ compact, dark }: { compact?: boolean; dark?: boolean }) {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-md" aria-label="Deals Separation Hub, go to dashboard">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-bright text-[15px] font-bold text-white">D</span>
      <span className="leading-tight">
        <span className={clsx('block text-[14.5px] font-semibold', dark ? 'text-chrome-text' : 'text-ink')}>Deals Separation Hub</span>
        {!compact && <span className={clsx('block text-[11.5px]', dark ? 'text-chrome-muted' : 'text-ink-muted')}>on the PwC Deals Stack</span>}
      </span>
    </Link>
  );
}

const ragDot: Record<string, string> = { Green: 'bg-green', Amber: 'bg-amber', Red: 'bg-rose' };

function useClickOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onOut]);
  return ref;
}

export default function AppShell() {
  const { session, can, logout } = useSession();
  const { prefs, set } = usePrefs();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useClickOutside(() => setMenu(false));

  if (!session) return null;
  const links = [
    { to: '/', label: 'Dashboard', show: true, end: true },
    { to: '/knowledge', label: 'Knowledge hub', show: can('knowledge.view') },
    { to: '/audit', label: 'Audit log', show: can('audit.view') },
    { to: '/admin/data', label: 'Data admin', show: can('admin.data') },
  ].filter((l) => l.show);

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only z-[80] rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      <header className="sticky top-0 z-40 bg-chrome">
        <div className="mx-auto flex h-12 max-w-[1680px] items-center gap-6 px-5">
          <Brand dark compact />
          <nav className="flex items-center gap-1" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}
                className={({ isActive }) => clsx('rounded-md px-3 py-1.5 text-[13.5px] font-medium transition-colors',
                  isActive ? 'bg-chrome-soft text-chrome-text' : 'text-chrome-muted hover:bg-chrome-soft/70 hover:text-chrome-text')}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <AiStatusButton />
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenu((m) => !m)} className="flex h-9 items-center gap-2 rounded-md px-2 text-chrome-text hover:bg-chrome-soft"
                aria-haspopup="menu" aria-expanded={menu} aria-label={`Account menu for ${session.user.full_name}`}>
                <Avatar name={session.user.full_name} size={28} />
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-[13px] font-medium">{session.user.full_name}</span>
                  <span className="block text-[11.5px] text-chrome-muted">{session.persona.name}</span>
                </span>
                <ChevronDown size={14} className="text-chrome-muted" />
              </button>
              {menu && <UserMenu onClose={() => setMenu(false)} prefs={prefs} set={set}
                onSwitch={() => { setMenu(false); nav('/login'); }}
                onSignOut={async () => { setMenu(false); await logout(); nav('/login'); }} />}
            </div>
          </div>
        </div>
        <OpenProjectTabs userId={session.user.user_id} />
      </header>
      <main id="main" className="mx-auto max-w-[1680px] px-5 pb-28 pt-4">
        <Outlet />
      </main>
      <Piku />
    </div>
  );
}

function UserMenu({ prefs, set, onSwitch, onSignOut }: {
  onClose: () => void; prefs: ReturnType<typeof usePrefs>['prefs']; set: ReturnType<typeof usePrefs>['set']; onSwitch: () => void; onSignOut: () => void;
}) {
  const { session } = useSession();
  if (!session) return null;
  const sizes: { v: TextSize; label: string }[] = [{ v: '100', label: 'Standard' }, { v: '112', label: 'Large' }, { v: '125', label: 'Larger' }];
  return (
    <div role="menu" className="absolute right-0 z-50 mt-1.5 w-80 rounded-xl border border-line bg-surface p-1.5 text-ink shadow-pop">
      <div className="px-3 py-2.5">
        <div className="text-[14px] font-semibold">{session.user.full_name}</div>
        <div className="text-[12.5px] text-ink-muted">{session.user.email}</div>
        <div className="mt-2 inline-flex rounded-md bg-brand-soft px-2 py-[2px] text-[12px] font-medium text-brand-dark">{session.persona.name}</div>
        {session.persona.title && <p className="mt-2 text-[12.5px] text-ink-soft">{session.persona.title}</p>}
      </div>
      <div className="my-1 border-t border-line" />
      <section className="px-3 py-2" aria-labelledby="a11y-h">
        <h3 id="a11y-h" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><Accessibility size={15} /> Accessibility</h3>
        <div className="mb-2.5">
          <div className="mb-1 text-[12.5px] text-ink-soft" id="ts-label">Text size</div>
          <div className="flex rounded-md border border-line-strong p-0.5" role="radiogroup" aria-labelledby="ts-label">
            {sizes.map((s) => (
              <button key={s.v} role="radio" aria-checked={prefs.textSize === s.v} onClick={() => set({ textSize: s.v })}
                className={clsx('h-8 flex-1 rounded text-[12.5px] font-medium', prefs.textSize === s.v ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sunken')}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle label="High contrast" checked={prefs.highContrast} onChange={(v) => set({ highContrast: v })} />
        <Toggle label="Reduce motion" checked={prefs.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
      </section>
      <div className="my-1 border-t border-line" />
      <button role="menuitem" onClick={onSwitch} className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13.5px] hover:bg-sunken"><Repeat2 size={15} /> Switch persona</button>
      <button role="menuitem" onClick={onSignOut} className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13.5px] hover:bg-sunken"><LogOut size={15} /> Sign out</button>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex h-9 w-full items-center justify-between rounded-md px-1 text-[13px] hover:bg-sunken">
      <span>{label}</span>
      <span className={clsx('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', checked ? 'bg-green' : 'bg-line-strong')}>
        <span className={clsx('absolute h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

/** Chrome-style strip: pinned Dashboard + one tab per opened project. */
function OpenProjectTabs({ userId }: { userId: string }) {
  const { tabs, close } = useOpenTabs(userId);
  const loc = useLocation();
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  const moreRef = useClickOutside(() => setMore(false));
  const activeId = /^\/projects\/([^/]+)/.exec(loc.pathname)?.[1];
  const onDashboard = loc.pathname === '/';

  // Keep the active project visible even when it sits past the visible limit.
  let visible = tabs.slice(0, MAX_VISIBLE_TABS);
  if (activeId && !visible.some((t) => t.id === activeId)) {
    const act = tabs.find((t) => t.id === activeId);
    if (act) visible = [...visible.slice(0, MAX_VISIBLE_TABS - 1), act];
  }
  const overflow = tabs.filter((t) => !visible.includes(t));

  function onClose(t: OpenTab) {
    const idx = tabs.findIndex((x) => x.id === t.id);
    const rest = close(t.id);
    if (t.id === activeId) {
      const next = rest[Math.min(idx, rest.length - 1)];
      nav(next ? next.lastPath || `/projects/${next.id}` : '/');
    }
  }

  return (
    <div className="mx-auto flex h-10 max-w-[1680px] items-end gap-1 px-5" >
      <div role="tablist" aria-label="Open projects" onKeyDown={onTabListKey} className="flex min-w-0 items-end gap-1 overflow-x-auto">
        <Link role="tab" aria-selected={onDashboard} to="/"
          className={clsx('flex h-9 shrink-0 items-center gap-2 rounded-t-lg px-3.5 text-[13px] font-medium transition-colors',
            onDashboard ? 'bg-canvas text-ink' : 'bg-chrome-soft text-chrome-muted hover:bg-chrome-soft/80 hover:text-chrome-text')}>
          <LayoutDashboard size={14} aria-hidden /> Dashboard
        </Link>
        {visible.map((t) => {
          const on = t.id === activeId;
          return (
            <div key={t.id} className={clsx('group flex h-9 max-w-[220px] shrink-0 items-center rounded-t-lg transition-colors',
              on ? 'bg-canvas text-ink' : 'bg-chrome-soft text-chrome-muted hover:text-chrome-text')}>
              <Link role="tab" aria-selected={on} to={t.lastPath || `/projects/${t.id}`} title={t.name}
                className="flex h-full min-w-0 items-center gap-2 rounded-t-lg pl-3.5 pr-1 text-[13px] font-medium">
                <span className={clsx('h-2 w-2 shrink-0 rounded-full', ragDot[t.rag ?? ''] ?? 'bg-chrome-muted')} aria-hidden />
                <span className="truncate">{t.name}</span>
              </Link>
              <button onClick={() => onClose(t)} aria-label={`Close tab: ${t.name}`} title="Close tab"
                className={clsx('mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded',
                  on ? 'text-ink-muted hover:bg-sunken hover:text-ink' : 'text-chrome-muted hover:bg-chrome hover:text-chrome-text')}>
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      {overflow.length > 0 && (
        <div className="relative mb-1" ref={moreRef}>
          <button onClick={() => setMore((m) => !m)} aria-haspopup="menu" aria-expanded={more} aria-label={`${overflow.length} more open projects`}
            className="flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] text-chrome-muted hover:bg-chrome-soft hover:text-chrome-text">
            <MoreHorizontal size={15} /> {overflow.length} more
          </button>
          {more && (
            <div role="menu" className="absolute left-0 z-50 mt-1 w-64 rounded-lg border border-line bg-surface p-1 shadow-pop">
              {overflow.map((t) => (
                <div key={t.id} className="flex items-center rounded-md hover:bg-sunken">
                  <Link role="menuitem" to={t.lastPath || `/projects/${t.id}`} onClick={() => setMore(false)} className="flex h-9 min-w-0 flex-1 items-center gap-2 px-2.5 text-[13px]">
                    <span className={clsx('h-2 w-2 shrink-0 rounded-full', ragDot[t.rag ?? ''] ?? 'bg-ink-muted')} aria-hidden />
                    <span className="truncate">{t.name}</span>
                  </Link>
                  <button onClick={() => onClose(t)} aria-label={`Close tab: ${t.name}`} className="mr-1 rounded p-1 text-ink-muted hover:bg-line hover:text-ink"><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
