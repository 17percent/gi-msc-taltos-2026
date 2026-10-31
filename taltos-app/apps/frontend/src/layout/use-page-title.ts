import { useEffect } from 'react';

/** Az oldal címe a böngészőfülön: „{cím} – Táltos”. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} – Táltos`;
  }, [title]);
}
