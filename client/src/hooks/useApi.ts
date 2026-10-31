/** Small data-fetching hook: { data, error, loading, reload, setData }. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const seq = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!path) { setLoading(false); return; }
    const id = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const d = await api<T>(path);
      if (id === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, (e as Error).message));
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => { load(); }, [load]);

  return { data, error, loading, reload: () => load(true), setData };
}
