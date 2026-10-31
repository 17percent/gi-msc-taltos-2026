import { useSyncExternalStore } from 'react';

/** `matchMedia` követése; ha a környezet nem ismeri (pl. teszt), `fallback` az érték. */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

/** DS `md` töréspont (768px): efölött táblázat, alatta kártya-lista. */
export function useIsMdUp(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
