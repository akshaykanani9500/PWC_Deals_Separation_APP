/**
 * Horizontal tab row that shows fade edges and arrow buttons when its tabs do not fit,
 * so hidden tabs are discoverable (instead of being silently cut off).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  children: ReactNode;
  label: string;
  className?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** background colour token used for the fade edges, e.g. 'from-surface' */
  fadeFrom?: string;
  align?: 'center' | 'end';
  /** extra classes for the scrolling row (e.g. top padding so badges above tabs are not clipped) */
  innerClassName?: string;
}

export default function ScrollTabs({ children, label, className, onKeyDown, fadeFrom = 'from-surface', align = 'center', innerClassName }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    el.addEventListener('scroll', measure, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure); };
  }, [measure, children]);

  // keep the selected tab in view when the selection changes (not on every re-render, so manual scrolling is kept)
  const lastSel = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    const sel = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    const key = sel?.getAttribute('href') ?? sel?.textContent ?? null;
    if (!el || !sel || key === lastSel.current) return;
    lastSel.current = key;
    const left = sel.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + sel.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, left - 48);
  });

  const nudge = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const arrow = 'absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-surface text-ink shadow-card hover:bg-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-link';

  return (
    <div className={clsx('relative flex min-w-0 flex-1', className)}>
      {edges.left && (
        <>
          <span aria-hidden className={clsx('pointer-events-none absolute inset-y-0 left-0 z-[5] w-12 bg-gradient-to-r to-transparent', fadeFrom)} />
          <button type="button" className={clsx(arrow, 'left-0')} onClick={() => nudge(-1)} aria-label={`Scroll ${label} left`} tabIndex={-1}><ChevronLeft size={16} /></button>
        </>
      )}
      <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKeyDown}
        className={clsx('no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto scroll-smooth', align === 'end' ? 'items-end' : 'items-center', innerClassName)}>
        {children}
      </div>
      {edges.right && (
        <>
          <span aria-hidden className={clsx('pointer-events-none absolute inset-y-0 right-0 z-[5] w-12 bg-gradient-to-l to-transparent', fadeFrom)} />
          <button type="button" className={clsx(arrow, 'right-0')} onClick={() => nudge(1)} aria-label={`Scroll ${label} right`} tabIndex={-1}><ChevronRight size={16} /></button>
        </>
      )}
    </div>
  );
}
