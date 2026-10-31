import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../auth/auth-context';
import { apiFetch, isApiError, type ApiRequest } from './client';

export type Api = {
  get: <T>(path: string, signal?: AbortSignal) => Promise<T>;
  post: <T = void>(path: string, body?: unknown) => Promise<T>;
  put: <T = void>(path: string, body?: unknown) => Promise<T>;
  patch: <T = void>(path: string, body?: unknown) => Promise<T>;
  del: <T = void>(path: string) => Promise<T>;
};

/**
 * Az API-kliens a bejelentkezett munkamenethez kötve: a CSRF-tokent a `/me`-ből veszi, és a
 * munkamenet-szintű hibákat itt kezeli (401 / nem engedélyezett fiók → kilépett állapot,
 * csrf_failed → a `/me` újratöltése új tokenért). A hibát minden esetben tovább is dobja.
 */
export function useApi(): Api {
  const { csrfToken, refreshMe, endSession } = useAuth();
  const csrfRef = useRef(csrfToken);
  useEffect(() => {
    csrfRef.current = csrfToken;
  }, [csrfToken]);

  return useMemo<Api>(() => {
    async function call<T>(path: string, request: ApiRequest): Promise<T> {
      try {
        return await apiFetch<T>(path, { ...request, csrfToken: csrfRef.current });
      } catch (error) {
        if (isApiError(error)) {
          if (error.code === 'unauthenticated') endSession('signed-out');
          else if (error.code === 'not_on_allowlist') endSession('not-allowlisted');
          else if (error.code === 'csrf_failed') void refreshMe();
        }
        throw error;
      }
    }
    return {
      get: (path, signal) => call(path, signal ? { signal } : {}),
      post: (path, body) => call(path, { method: 'POST', body }),
      put: (path, body) => call(path, { method: 'PUT', body }),
      patch: (path, body) => call(path, { method: 'PATCH', body }),
      del: (path) => call(path, { method: 'DELETE' }),
    };
  }, [refreshMe, endSession]);
}
