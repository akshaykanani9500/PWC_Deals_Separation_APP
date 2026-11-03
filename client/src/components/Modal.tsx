/**
 * v1.4 (C): centred modal rendered into document.body (portal), so sticky asides and stage/activity bars can never
 * paint over it or clip it. Dimmed backdrop, Esc / backdrop closes, focus moves in and returns, body scrolls while the
 * header and footer stay visible. Sits above side panels (z-60) and confirm dialogs (z-70), below toasts (z-80).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, icon, headerRight, children, footer, width = 'lg', label }: {
  open: boolean; onClose: () => void; title: ReactNode; icon?: ReactNode; headerRight?: ReactNode; children: ReactNode; footer?: ReactNode;
  width?: 'md' | 'lg' | 'xl'; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0]; const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    setTimeout(() => ref.current?.focus(), 0);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const w = width === 'xl' ? 'max-w-3xl' : width === 'md' ? 'max-w-md' : 'max-w-2xl';
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-3 sm:p-6" data-testid="modal">
      <div className="absolute inset-0 bg-ink/45" onClick={onClose} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        className={clsx('relative flex max-h-[92vh] w-full flex-col rounded-2xl border border-line bg-surface shadow-pop outline-none', w)}>
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          {icon && <span className="text-piku">{icon}</span>}
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{title}</h3>
          {headerRight}
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-muted hover:bg-sunken hover:text-ink" aria-label="Close dialog"><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-canvas/60 px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
