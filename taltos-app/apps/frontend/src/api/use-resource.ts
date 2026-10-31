import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi, type Api } from './use-api';

export type Resource<T> =
  | { status: 'loading'; data: undefined; error: undefined; reload: () => void }
  | { status: 'error'; data: undefined; error: unknown; reload: () => void }
  | { status: 'ready'; data: T; error: undefined; reload: () => void; refreshing: boolean };

type Settled<T> =
  | { base: string; key: string; ok: true; data: T }
  | { base: string; key: string; ok: false; error: unknown };

/**
 * Egyszerű lekérés-hook (nincs külön adat-könyvtár, D14): a `key` azonosítja a kérést, változásakor
 * újratölt; a `reload()` után a régi adat látszik, amíg az új meg nem érkezik (nincs villogás).
 */
export function useResource<T>(
  key: string,
  fetcher: (api: Api, signal: AbortSignal) => Promise<T>,
): Resource<T> {
  const api = useApi();
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const fullKey = `${key}#${version}`;

  useEffect(() => {
    const controller = new AbortController();
    fetcherRef
      .current(api, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSettled({ base: key, key: fullKey, ok: true, data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSettled({ base: key, key: fullKey, ok: false, error });
      });
    return () => controller.abort();
  }, [api, key, fullKey]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  if (settled?.key === fullKey) {
    return settled.ok
      ? { status: 'ready', data: settled.data, error: undefined, reload, refreshing: false }
      : { status: 'error', data: undefined, error: settled.error, reload };
  }
  if (settled?.ok && settled.base === key) {
    return { status: 'ready', data: settled.data, error: undefined, reload, refreshing: true };
  }
  return { status: 'loading', data: undefined, error: undefined, reload };
}
