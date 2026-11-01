/**
 * Open-project tabs (Chrome-style strip under the top bar). Stored per user in localStorage.
 * The project page calls `openTab` when it loads; the strip listens for changes.
 */
import { useCallback, useEffect, useState } from 'react';

export interface OpenTab { id: string; name: string; rag?: string | null; lastPath?: string }

const EVENT = 'dsh:tabs';
const keyFor = (userId: string) => `dsh.tabs.${userId}`;
export const MAX_VISIBLE_TABS = 8;

function read(userId: string): OpenTab[] {
  try { const v = JSON.parse(localStorage.getItem(keyFor(userId)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(userId: string, tabs: OpenTab[]) {
  try { localStorage.setItem(keyFor(userId), JSON.stringify(tabs.slice(0, 30))); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Add or refresh a tab (keeps its position if already open). */
export function openTab(userId: string, tab: OpenTab) {
  const tabs = read(userId);
  const i = tabs.findIndex((t) => t.id === tab.id);
  if (i >= 0) tabs[i] = { ...tabs[i], ...tab };
  else tabs.push(tab);
  write(userId, tabs);
}

export function closeTab(userId: string, id: string): OpenTab[] {
  const tabs = read(userId).filter((t) => t.id !== id);
  write(userId, tabs);
  return tabs;
}

export function useOpenTabs(userId: string | undefined) {
  const [tabs, setTabs] = useState<OpenTab[]>(() => (userId ? read(userId) : []));
  useEffect(() => {
    if (!userId) return;
    const on = () => setTabs(read(userId));
    on();
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, [userId]);
  const close = useCallback((id: string) => (userId ? closeTab(userId, id) : []), [userId]);
  return { tabs, close };
}
