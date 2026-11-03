/**
 * "How approval works": the exact rules and the permission -> approvals matrix, generated from shared/access.ts
 * (the same table the server enforces). Opened from the Access page, the request panel and the top-bar bell.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, ShieldCheck, X } from 'lucide-react';
import { APPROVAL_RULES, approvalMatrix } from '@shared/access';
import { PERSONA_LABEL } from '../../hooks/useUsers';
import { Button } from '../../components/ui';

export function ApprovalRulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    setTimeout(() => ref.current?.focus(), 0);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const rows = approvalMatrix();
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="approval-rules-title" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-[min(860px,96vw)] flex-col rounded-xl bg-surface shadow-pop outline-none">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <ShieldCheck size={18} className="mt-1 shrink-0 text-blue" aria-hidden />
          <div className="flex-1">
            <h2 id="approval-rules-title" className="text-[18px] font-semibold">How approval works</h2>
            <p className="text-[12.5px] text-ink-muted">The same rules the server enforces. Riskier access needs a second check by Risk &amp; Quality.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink" aria-label="Close"><X size={18} /></button>
        </header>
        <div className="overflow-y-auto px-5 py-4">
          <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[13px] text-ink-soft">
            {APPROVAL_RULES.map((r) => <li key={r}>{r}</li>)}
          </ol>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[12.5px]">
              <caption className="sr-only">Who approves each kind of extra access</caption>
              <thead><tr>
                <th className="th">What</th><th className="th">Who can get it</th><th className="th">Level 1</th><th className="th">Level 2</th><th className="th text-right">Longest</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td className="td font-medium text-ink">{r.label}{r.acting && <span className="ml-1.5 rounded bg-blue-soft px-1 text-[11px] font-medium text-blue">Acting role</span>}</td>
                    <td className="td">{r.eligible.map((p) => PERSONA_LABEL[p] ?? p).join(', ')}</td>
                    <td className="td">{r.level1}</td>
                    <td className="td">{r.level2}</td>
                    <td className="td num whitespace-nowrap text-right">{r.maxDays} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <footer className="flex justify-end border-t border-line bg-canvas/60 px-5 py-3"><Button onClick={onClose}>Close</Button></footer>
      </div>
    </div>,
    document.body,
  );
}

/** A small link-style button that opens the explainer. */
export function HowApprovalWorks({ className, label = 'How approval works' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? 'inline-flex items-center gap-1 text-[13px] font-medium text-link hover:underline'}>
        <HelpCircle size={14} aria-hidden /> {label}
      </button>
      <ApprovalRulesDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
