import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import clsx from 'clsx';
import type { SortDir } from '../hooks/useSort';

export function SortHeader({ label, k, sort, onSort, className, align }: {
  label: string; k: string; sort: { key: string; dir: SortDir }; onSort: (k: string) => void; className?: string; align?: 'right';
}) {
  const active = sort.key === k;
  return (
    <th className={clsx('th', className)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(k)} className={clsx('inline-flex items-center gap-1 hover:text-ink', align === 'right' && 'w-full justify-end', active && 'text-ink')}>
        {label}
        {active ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  );
}
