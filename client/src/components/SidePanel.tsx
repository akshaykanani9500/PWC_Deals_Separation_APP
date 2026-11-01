/** Right-hand drawer used by every edit and detail screen. Esc or the overlay closes it. */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Button } from './ui';

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Extra header actions (e.g. AI suggestion button) */
  headerRight?: ReactNode;
  children: ReactNode;
  /** Custom footer. When omitted and onSave is given, a Save/Cancel footer is rendered. */
  footer?: ReactNode;
  onSave?: () => void;
  saveLabel?: string;
  saving?: boolean;
  saveDisabled?: boolean;
  width?: 'md' | 'lg' | 'xl';
}

let openPanels = 0;

export function SidePanel({ open, onClose, title, subtitle, headerRight, children, footer, onSave, saveLabel = 'Save changes', saving, saveDisabled, width = 'md' }: SidePanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    // Lets other floating UI (e.g. the Piku bubble) know a side panel is open. Counted, so nested panels work.
    openPanels += 1;
    document.body.dataset.sidepanel = 'open';
    setTimeout(() => ref.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      openPanels = Math.max(0, openPanels - 1);
      if (openPanels === 0) delete document.body.dataset.sidepanel;
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const w = width === 'xl' ? 'w-[min(920px,96vw)]' : width === 'lg' ? 'w-[min(720px,96vw)]' : 'w-[min(520px,96vw)]';

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={clsx('absolute right-0 top-0 flex h-full flex-col bg-surface shadow-panel outline-none animate-[slidein_.18s_ease-out]', w)}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-[200px] flex-1">
            <h2 className="text-[19px] font-semibold leading-tight text-ink">{title}</h2>
            {subtitle && <div className="mt-1 text-[12.5px] text-ink-muted">{subtitle}</div>}
          </div>
          {headerRight && <div className="flex shrink-0 items-start">{headerRight}</div>}
          <button onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink" aria-label="Close panel"><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {(footer || onSave) && (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-canvas/60 py-3 px-5">
            {footer ?? (
              <>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={onSave} loading={saving} disabled={saveDisabled}>{saveLabel}</Button>
              </>
            )}
          </footer>
        )}
      </div>
      <style>{'@keyframes slidein{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}'}</style>
    </div>,
    document.body,
  );
}

/** Simple confirm dialog. */
export function ConfirmDialog({ open, title, body, confirmLabel = 'Delete', onConfirm, onCancel, busy }: {
  open: boolean; title: string; body?: ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/30 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-pop" role="alertdialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {body && <div className="mt-2 text-[13px] text-ink-soft">{body}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={busy} autoFocus>{confirmLabel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
