/**
 * Gantt-style timeline: one row per item, bar from start to end, month ticks and a "today" marker.
 * Used for stages (project overview) and tasks (activity Timeline view).
 */
import clsx from 'clsx';
import { date, today } from '../lib/format';

export interface TimelineItem {
  id: string;
  label: string;
  sublabel?: string;
  start?: string | null;
  end?: string | null;
  /** tailwind bg class for the bar */
  tone?: string;
  progress?: number | null;
  onClick?: () => void;
  ariaLabel?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / 864e5;

export default function Timeline({ items, labelWidth = 220, emptyText = 'No dates to show yet.' }: { items: TimelineItem[]; labelWidth?: number; emptyText?: string }) {
  const dated = items.map((it) => {
    const end = it.end || it.start;
    const start = it.start || (end ? new Date((day(end) - 7) * 864e5).toISOString().slice(0, 10) : null);
    return { ...it, s: start, e: end };
  });
  const withDates = dated.filter((d) => d.s && d.e);
  if (!withDates.length) return <p className="py-6 text-center text-[13px] text-ink-muted">{emptyText}</p>;
  const t0 = today();
  let lo = Math.min(...withDates.map((d) => day(d.s!)), day(t0));
  let hi = Math.max(...withDates.map((d) => day(d.e!)), day(t0));
  if (hi - lo < 14) { hi += 7; lo -= 7; }
  const span = hi - lo;
  const X = (s: string) => ((day(s) - lo) / span) * 100;

  // Month ticks
  const ticks: { pct: number; label: string }[] = [];
  const first = new Date(lo * 864e5);
  let y = first.getUTCFullYear(), m = first.getUTCMonth() + 1;
  for (let i = 0; i < 40; i++) {
    if (m > 11) { m = 0; y += 1; }
    const d = Date.UTC(y, m, 1) / 864e5;
    if (d > hi) break;
    ticks.push({ pct: ((d - lo) / span) * 100, label: `${MONTHS[m]}${m === 0 ? ` ${y}` : ''}` });
    m += 1;
  }
  const step = Math.max(1, Math.ceil(ticks.length / 10));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="flex border-b border-line pb-1 text-[11.5px] text-ink-muted">
          <div style={{ width: labelWidth }} className="shrink-0" />
          <div className="relative h-4 flex-1">
            {ticks.filter((_, i) => i % step === 0).map((t) => (
              <span key={t.pct} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${t.pct}%` }}>{t.label}</span>
            ))}
          </div>
        </div>
        <ul>
          {dated.map((it) => {
            const has = it.s && it.e;
            const left = has ? X(it.s!) : 0;
            const width = has ? Math.max(1.2, X(it.e!) - left) : 0;
            const Bar = it.onClick ? 'button' : 'div';
            return (
              <li key={it.id} className="flex items-center border-b border-line/60 py-1.5">
                <div style={{ width: labelWidth }} className="min-w-0 shrink-0 pr-3">
                  <div className="truncate text-[13px] font-medium" title={it.label}>{it.label}</div>
                  {it.sublabel && <div className="truncate text-[11.5px] text-ink-muted">{it.sublabel}</div>}
                </div>
                <div className="relative h-7 flex-1">
                  {ticks.map((t) => <span key={t.pct} className="absolute inset-y-0 w-px bg-line/70" style={{ left: `${t.pct}%` }} aria-hidden />)}
                  <span className="absolute inset-y-0 w-0.5 bg-brand-bright" style={{ left: `${X(t0)}%` }} title="Today" aria-hidden />
                  {has ? (
                    <Bar
                      {...(it.onClick ? { type: 'button' as const, onClick: it.onClick } : {})}
                      aria-label={it.ariaLabel ?? `${it.label}: ${date(it.s)} to ${date(it.e)}`}
                      title={`${it.label}: ${date(it.s)} to ${date(it.e)}`}
                      className={clsx('absolute top-1 h-5 overflow-hidden rounded-md border border-ink/10', it.tone ?? 'bg-blue/70',
                        it.onClick && 'cursor-pointer hover:ring-2 hover:ring-link focus-visible:ring-2 focus-visible:ring-link')}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      {it.progress != null && <span className="absolute inset-y-0 left-0 bg-ink/20" style={{ width: `${Math.min(100, it.progress)}%` }} />}
                    </Bar>
                  ) : <span className="absolute top-1.5 text-[11.5px] text-ink-muted">No dates</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex items-center gap-3 text-[11.5px] text-ink-muted">
          <span className="inline-flex items-center gap-1"><span className="h-3 w-0.5 bg-brand-bright" /> Today</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-ink/20" /> Completed share</span>
        </div>
      </div>
    </div>
  );
}
