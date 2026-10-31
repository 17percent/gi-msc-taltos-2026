import { useCallback, useEffect, useRef, useState } from 'react';

export type ActionResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * Mutáló művelet állapota: `pending` alatt a gomb letiltott (kettős küldés tilos: a hívás
 * `pending` közben ismét lefuttatva is csak egyszer megy el), a hiba a művelet mellett marad.
 */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  });

  const run = useCallback(async (...args: A): Promise<ActionResult<R> | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    setFailed(false);
    setError(undefined);
    try {
      const value = await actionRef.current(...args);
      return { ok: true, value };
    } catch (caught) {
      setError(caught);
      setFailed(true);
      return { ok: false, error: caught };
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(undefined);
    setFailed(false);
  }, []);

  return { run, pending, failed, error, reset };
}
