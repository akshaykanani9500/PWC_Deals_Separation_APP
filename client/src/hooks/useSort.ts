/** Client-side table sorting. */
import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export function useSort<T>(rows: T[], initial: { key: keyof T | string; dir?: SortDir }, accessors: Record<string, (r: T) => unknown> = {}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: String(initial.key), dir: initial.dir ?? 'asc' });
  const sorted = useMemo(() => {
    const get = accessors[sort.key] ?? ((r: T) => (r as Record<string, unknown>)[sort.key]);
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null || va === '') return 1;
      if (vb == null || vb === '') return -1;
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sort.dir === 'asc' ? r : -r;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const toggle = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return { sorted, sort, toggle };
}
