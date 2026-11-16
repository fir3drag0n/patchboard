// Lists the Library and Requests pages read straight from an app while
// they're open, rather than from the snapshot.

import { useCallback, useEffect, useState } from 'react';

export const ACTION = { 'X-Patchboard': 'action', 'Content-Type': 'application/json' };

/** Fetch JSON, or throw the server's own words. */
export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/** One list, loaded when asked for. With `every`, it keeps itself fresh while the tab is in view. */
export function useList<T>(url: string | null, every = 0): { data: T | null; err: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(timer);
      try {
        const got = await call<T>(url);
        if (gone) return;
        setData(got);
        setErr('');
      } catch (e) {
        if (!gone) setErr((e as Error).message);
      }
      if (!gone && every && document.visibilityState === 'visible') timer = setTimeout(() => void load(), every);
    };
    const onShow = () => every && document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onShow);
    void load();
    return () => {
      gone = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [url, every, n]);
  useEffect(() => setData(null), [url]);
  return { data, err, reload: useCallback(() => setN((x) => x + 1), []) };
}
