import { useEffect } from 'react';

const BASE_TITLE = 'Táltos';

/** Az oldal címe a böngészőfülön: „{cím} – Táltos”; az oldal elhagyásakor visszaáll „Táltos”-ra. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} – ${BASE_TITLE}`;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [title]);
}
