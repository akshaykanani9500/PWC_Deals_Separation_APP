/** Small, shared UI primitives. Keep visual decisions here so every screen stays consistent. */
import clsx from 'clsx';
import { Fragment, forwardRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, CheckCircle2, ChevronRight, Circle, CircleDashed, CircleDot, Clock3, PauseCircle, XCircle } from 'lucide-react';
import { initials } from '../lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
  /** Shown as tooltip when disabled - explain WHY. */
  disabledReason?: string;
}

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark border border-brand-dark shadow-card active:translate-y-px',
  secondary: 'bg-surface text-ink border border-line-strong shadow-card hover:bg-sunken hover:border-ink-muted active:translate-y-px',
  ghost: 'bg-transparent text-ink-soft hover:bg-sunken hover:text-ink border border-transparent',
  danger: 'bg-surface text-rose border border-rose/50 hover:bg-rose-soft',
  subtle: 'bg-sunken text-ink hover:bg-line border border-transparent',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, disabledReason, className, children, disabled, title, ...rest }, ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type="button"
      title={isDisabled && disabledReason ? disabledReason : title}
      disabled={isDisabled}
      className={clsx(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium transition-colors whitespace-nowrap',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[13.5px]',
        variants[variant], className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

/** A router link that looks like a Button (use for navigation, so we never nest a button inside a link). */
export function ButtonLink({ to, icon, children, variant = 'secondary', size = 'md', className, title }: {
  to: string; icon?: ReactNode; children: ReactNode; variant?: Variant; size?: Size; className?: string; title?: string;
}) {
  return (
    <Link to={to} title={title} className={clsx(
      'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors whitespace-nowrap',
      size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[13.5px]', variants[variant], className,
    )}>
      {icon}{children}
    </Link>
  );
}

/** Wraps a disabled control so the tooltip still shows (disabled buttons swallow hover in some browsers). */
export function Gate({ allowed, reason, children }: { allowed: boolean; reason: string; children: ReactNode }) {
  if (allowed) return <>{children}</>;
  return <span title={reason} className="inline-flex cursor-not-allowed">{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent', className)} aria-hidden />;
}

const statusTone: Record<string, string> = {
  // work status
  'Not Started': 'bg-sunken text-ink-soft',
  'In Progress': 'bg-blue-soft text-blue',
  Blocked: 'bg-rose-soft text-rose',
  Done: 'bg-green-soft text-green',
  // project status
  Planning: 'bg-sunken text-ink-soft',
  Active: 'bg-blue-soft text-blue',
  'At Risk': 'bg-rose-soft text-rose',
  'On Hold': 'bg-amber-soft text-amber',
  Closing: 'bg-piku-soft text-piku',
  Closed: 'bg-green-soft text-green',
  // gates / knowledge
  'Not Ready': 'bg-sunken text-ink-soft',
  'Pending Approval': 'bg-amber-soft text-amber',
  Approved: 'bg-green-soft text-green',
  'Pending Review': 'bg-amber-soft text-amber',
  Rejected: 'bg-rose-soft text-rose',
  Granted: 'bg-green-soft text-green',
  'Not Granted': 'bg-rose-soft text-rose',
  Pending: 'bg-amber-soft text-amber',
  // TSA
  Exiting: 'bg-amber-soft text-amber',
  Exited: 'bg-green-soft text-green',
  Extended: 'bg-rose-soft text-rose',
  // access requests (v1.3)
  'Pending L1': 'bg-amber-soft text-amber',
  'Pending L2': 'bg-amber-soft text-amber',
  Expired: 'bg-sunken text-ink-muted',
  Revoked: 'bg-rose-soft text-rose',
  Cancelled: 'bg-sunken text-ink-muted',
  // finance workspace (v1.3)
  Identified: 'bg-sunken text-ink-soft',
  'In discussion': 'bg-piku-soft text-piku',
  'Term sheet': 'bg-amber-soft text-amber',
  Committed: 'bg-blue-soft text-blue',
  Drawn: 'bg-green-soft text-green',
  Declined: 'bg-rose-soft text-rose',
  Draft: 'bg-sunken text-ink-soft',
  Sent: 'bg-blue-soft text-blue',
  Paid: 'bg-green-soft text-green',
  Overdue: 'bg-rose-soft text-rose',
  Planned: 'bg-sunken text-ink-soft',
  Spent: 'bg-green-soft text-green',
  // priority
  Critical: 'bg-rose-soft text-rose',
  High: 'bg-amber-soft text-amber',
  Medium: 'bg-sunken text-ink-soft',
  Low: 'bg-sunken text-ink-muted',
};

/** Shape cue for each status so meaning never depends on colour alone (WCAG 1.4.1). */
const statusIcon: Record<string, ReactNode> = {
  'Not Started': <CircleDashed size={12} />, 'In Progress': <CircleDot size={12} />, Blocked: <Ban size={12} />, Done: <CheckCircle2 size={12} />,
  Planning: <CircleDashed size={12} />, Active: <CircleDot size={12} />, 'At Risk': <AlertTriangle size={12} />, 'On Hold': <PauseCircle size={12} />,
  Closing: <Clock3 size={12} />, Closed: <CheckCircle2 size={12} />, 'Not Ready': <CircleDashed size={12} />, 'Pending Approval': <Clock3 size={12} />,
  Approved: <CheckCircle2 size={12} />, 'Pending Review': <Clock3 size={12} />, Rejected: <XCircle size={12} />, Granted: <CheckCircle2 size={12} />,
  'Not Granted': <XCircle size={12} />, Pending: <Clock3 size={12} />,
  'Pending L1': <Clock3 size={12} />, 'Pending L2': <Clock3 size={12} />, Expired: <CircleDashed size={12} />, Revoked: <Ban size={12} />,
  Cancelled: <XCircle size={12} />, Identified: <CircleDashed size={12} />, 'In discussion': <CircleDot size={12} />, 'Term sheet': <Clock3 size={12} />,
  Committed: <CircleDot size={12} />, Drawn: <CheckCircle2 size={12} />, Declined: <XCircle size={12} />, Draft: <CircleDashed size={12} />,
  Sent: <CircleDot size={12} />, Paid: <CheckCircle2 size={12} />, Overdue: <AlertTriangle size={12} />, Planned: <CircleDashed size={12} />, Spent: <CheckCircle2 size={12} />,
};

export function Pill({ children, tone, className, icon = true }: { children: ReactNode; tone?: string; className?: string; icon?: boolean }) {
  const key = typeof children === 'string' ? children : '';
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[12px] font-medium whitespace-nowrap', tone ?? statusTone[key] ?? 'bg-sunken text-ink-soft', className)}>
      {icon && statusIcon[key]}
      {children}
    </span>
  );
}

const ragColor: Record<string, string> = { Green: 'bg-green', Amber: 'bg-amber', Red: 'bg-rose' };
const ragText: Record<string, string> = { Green: 'text-green', Amber: 'text-amber', Red: 'text-rose' };
/** RAG marker: coloured shape + (optional) word. Shapes differ (circle / triangle / octagon) for colour-blind users. */
export function RagDot({ rag, withLabel }: { rag?: string | null; withLabel?: boolean }) {
  if (!rag) return <span className="text-ink-muted">–</span>;
  const shape = rag === 'Red' ? 'rounded-[2px] rotate-45' : rag === 'Amber' ? 'rounded-[1px]' : 'rounded-full';
  return (
    <span className="inline-flex items-center gap-1.5" title={`RAG status: ${rag}`}>
      <span className={clsx('h-2.5 w-2.5 shrink-0', shape, ragColor[rag] ?? 'bg-ink-muted')} aria-hidden />
      {withLabel ? <span className={clsx('text-[12.5px] font-medium', ragText[rag] ?? 'text-ink-soft')}>{rag}</span> : <span className="sr-only">RAG {rag}</span>}
    </span>
  );
}

export function Progress({ value, className, showLabel = true }: { value?: number | null; className?: string; showLabel?: boolean }) {
  const v = Math.max(0, Math.min(100, Number(value ?? 0)));
  return (
    <div className={clsx('flex items-center gap-2', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-2 w-full min-w-[48px] overflow-hidden rounded-full bg-sunken">
        <div className={clsx('h-full rounded-full', v >= 100 ? 'bg-green' : 'bg-blue')} style={{ width: `${v}%` }} />
      </div>
      {showLabel && <span className="num w-9 shrink-0 text-right text-[12px] text-ink-soft">{Math.round(v)}%</span>}
    </div>
  );
}

/** Circular completion meter. */
export function ProgressRing({ value, size = 44, stroke = 5, label }: { value?: number | null; size?: number; stroke?: number; label?: string }) {
  const v = Math.max(0, Math.min(100, Number(value ?? 0)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(v)}% complete`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-sunken" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={v >= 100 ? 'stroke-green' : 'stroke-blue'} strokeDasharray={c} strokeDashoffset={c - (v / 100) * c} />
      </svg>
      <span className="num absolute text-[11px] font-medium">{Math.round(v)}%</span>
    </span>
  );
}

/** In-app navigation link that looks like a link. */
export function TextLink({ to, children, className, arrow, title }: { to: string; children: ReactNode; className?: string; arrow?: boolean; title?: string }) {
  return (
    <Link to={to} title={title} className={clsx('link inline-flex items-center gap-0.5', className)}>
      {children}{arrow && <ChevronRight size={14} aria-hidden />}
    </Link>
  );
}

/** Breadcrumb trail; the last crumb is the current page. */
export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
        {items.map((it, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronRight size={14} className="shrink-0 text-ink-muted" aria-hidden />}
            <li className="min-w-0 truncate">
              {it.to && i < items.length - 1 ? <Link to={it.to} className="link">{it.label}</Link>
                : <span aria-current="page" className="font-medium text-ink">{it.label}</span>}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/** Arrow-key navigation for role=tablist containers (WAI-ARIA tabs pattern). */
export function onTabListKey(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
}

/** Status dot used where only a small marker fits (still paired with text by the caller). */
export function StatusIcon({ status }: { status: string }) {
  return <span className="inline-flex" aria-hidden>{statusIcon[status] ?? <Circle size={12} />}</span>;
}

export function Avatar({ name, size = 24 }: { name?: string | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-sunken font-medium text-ink-soft"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      title={name ?? undefined}
    >
      {initials(name)}
    </span>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-ink-muted">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx('input', className)} {...p} />;
});

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx('input pr-7', className)} {...p}>{children}</select>;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx('input min-h-[72px] resize-y', className)} {...p} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-ink-muted">{icon}</div>}
      <p className="text-[14.5px] font-semibold text-ink">{title}</p>
      {body && <p className="max-w-sm text-[13px] text-ink-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[14px] font-semibold text-ink">{children}</h3>
      {right}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-ink-muted">{label}</div>
      <div className="truncate text-[13.5px] text-ink">{children}</div>
    </div>
  );
}

/** Small "AI-generated" label required by the responsible-AI rules. */
export function AiLabel({ mode }: { mode?: string }) {
  return (
    <span className="inline-flex items-center rounded bg-piku-soft px-1.5 py-[1px] text-[11px] font-medium text-piku" title={mode ? `Mode: ${mode}` : undefined}>
      AI-generated{mode ? ` (${mode === 'offline' ? 'offline' : mode})` : ''}
    </span>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('inline-flex items-center gap-2', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input type="checkbox" className="h-4 w-4 accent-[#B83F04]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label && <span className="text-[13px]">{label}</span>}
    </label>
  );
}

/** Container for an AI suggestion button inside a panel body: short explanation + the (full-width) AI control. */
export function AiStrip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-dashed border-piku/30 bg-piku-soft/30 px-3 py-2.5">
      <p className="mb-2 text-[12.5px] text-ink-soft">{text}</p>
      {children}
    </div>
  );
}
