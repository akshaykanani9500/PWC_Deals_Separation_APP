/**
 * Global toasts. useToast().success('Saved') / .error(err) / .info('…')
 * v1.4: an optional second argument can be an action ({ label, run }) as before, or options
 * ({ action?, title?, duration? }). Long messages stay up longer; "\n" starts a new line.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
type ToastAction = { label: string; run: () => void };
export interface ToastOptions { action?: ToastAction; title?: string; duration?: number }
interface Toast { id: number; kind: Kind; message: string; title?: string; action?: ToastAction }
interface ToastCtx {
  success: (m: string, opts?: ToastAction | ToastOptions) => void;
  error: (e: unknown) => void;
  info: (m: string, opts?: ToastAction | ToastOptions) => void;
}

const Ctx = createContext<ToastCtx | null>(null);
let seq = 0;

const norm = (o?: ToastAction | ToastOptions): ToastOptions => (!o ? {} : 'run' in o ? { action: o } : o);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, message: string, opts: ToastOptions = {}) => {
    const id = ++seq;
    setItems((s) => [...s.slice(-3), { id, kind, message, title: opts.title, action: opts.action }]);
    // Reading time grows with the text (names of approvers etc.), within 3.5 - 10 s.
    const base = kind === 'error' ? 6500 : opts.action ? 6000 : 3500;
    const ms = opts.duration ?? Math.min(10000, Math.max(base, 1500 + (message.length + (opts.title?.length ?? 0)) * 45));
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), ms);
  }, []);
  const value = useMemo<ToastCtx>(() => ({
    success: (m, o) => push('success', m, norm(o)),
    info: (m, o) => push('info', m, norm(o)),
    error: (e) => push('error', e instanceof Error ? e.message : typeof e === 'string' ? e : 'Something went wrong. Try again.'),
  }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex w-[min(460px,92vw)] -translate-x-1/2 flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto flex items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-[13px] shadow-pop',
            t.kind === 'error' ? 'border-rose/30' : 'border-line')}>
            {t.kind === 'success' && <CheckCircle2 size={16} className="mt-[1px] shrink-0 text-green" />}
            {t.kind === 'error' && <AlertTriangle size={16} className="mt-[1px] shrink-0 text-rose" />}
            {t.kind === 'info' && <Info size={16} className="mt-[1px] shrink-0 text-blue" />}
            <span className="flex-1 whitespace-pre-line">
              {t.title && <span className="block font-semibold text-ink">{t.title}</span>}
              {t.message}
            </span>
            {t.action && (
              <button className="link shrink-0 text-[13px]" onClick={() => { t.action!.run(); setItems((s) => s.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>
            )}
            <button className="rounded p-0.5 text-ink-muted hover:text-ink" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} aria-label="Dismiss"><X size={14} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
