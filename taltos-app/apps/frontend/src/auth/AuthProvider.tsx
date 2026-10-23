import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext } from './auth-context';
import type { AuthContextValue, AuthState, MeResponse } from './types';

const ME_PATH = '/api/v1/me';
const LOGOUT_PATH = '/auth/logout';

async function problemCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

async function loadMe(signal: AbortSignal): Promise<AuthState> {
  const response = await fetch(ME_PATH, { credentials: 'same-origin', signal });
  if (response.ok) return { kind: 'signed-in', me: (await response.json()) as MeResponse };
  if (response.status === 401) return { kind: 'signed-out' };
  if (response.status === 403 && (await problemCode(response)) === 'not_on_allowlist') {
    return { kind: 'not-allowlisted' };
  }
  return { kind: 'error' };
}

/** A munkamenet állapota: induláskor betölti a `/api/v1/me`-t, és kezeli a kijelentkezést. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' });
  const [logoutFailed, setLogoutFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadMe(controller.signal)
      .then(setState)
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);

  const csrfToken = state.kind === 'signed-in' ? state.me.csrfToken : null;

  const logout = useCallback(async () => {
    if (!csrfToken) return;
    setLogoutFailed(false);
    try {
      const response = await fetch(LOGOUT_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      // 401: a munkamenet már lejárt vagy visszavonták, tehát a felhasználó ki van jelentkezve.
      if (response.ok || response.status === 401) setState({ kind: 'signed-out' });
      else setLogoutFailed(true);
    } catch {
      setLogoutFailed(true);
    }
  }, [csrfToken]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, logoutFailed, csrfToken, logout }),
    [state, logoutFailed, csrfToken, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
