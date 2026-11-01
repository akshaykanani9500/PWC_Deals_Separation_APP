/**
 * Accessibility preferences (text size, high contrast, reduced motion), persisted per browser.
 * Applied as attributes/classes on <html> so plain CSS can react (see index.css).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type TextSize = '100' | '112' | '125';
export interface Prefs { textSize: TextSize; highContrast: boolean; reduceMotion: boolean }

const KEY = 'dsh.a11y';
const DEFAULTS: Prefs = { textSize: '100', highContrast: false, reduceMotion: false };

function load(): Prefs {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs>) }; } catch { return DEFAULTS; }
}

function apply(p: Prefs) {
  const h = document.documentElement;
  h.dataset.textSize = p.textSize;
  h.classList.toggle('hc', p.highContrast);
  h.classList.toggle('reduce-motion', p.reduceMotion);
}

const Ctx = createContext<{ prefs: Prefs; set: (patch: Partial<Prefs>) => void } | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => { apply(prefs); try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ } }, [prefs]);
  const set = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const value = useMemo(() => ({ prefs, set }), [prefs, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return v;
}
