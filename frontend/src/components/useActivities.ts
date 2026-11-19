import { useCallback, useEffect, useState } from 'react';
import { api, errMsg, NetworkError } from '../lib/api';
import { cache } from '../lib/offline';
import type { ActivitiesResponse } from '../lib/types';

/** Loads a date range; falls back to the last cached copy when offline. Refreshes on push / sync events. */
export function useActivities(from: string, to: string) {
  const [data, setData] = useState<ActivitiesResponse | null>(() => cache.get<ActivitiesResponse>(`act:${from}:${to}`));
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api<ActivitiesResponse>(`/activities?from=${from}&to=${to}`);
      setData(r); setStale(false); setError(null); cache.set(`act:${from}:${to}`, r);
    } catch (e) {
      if (e instanceof NetworkError && cache.get(`act:${from}:${to}`)) setStale(true);
      else setError(errMsg(e));
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useEffect(() => {
    const h = () => void load();
    window.addEventListener('cymor:refresh', h);
    const t = setInterval(h, 60_000);
    return () => { window.removeEventListener('cymor:refresh', h); clearInterval(t); };
  }, [load]);
  return { data, error, stale, loading, reload: load, setData };
}
