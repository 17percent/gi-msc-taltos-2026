import type { UserRef } from '@taltos/shared';
import { useCallback } from 'react';
import { useApi } from '../api/use-api';
import type { UserOption } from './UserPicker';

/** `GET /api/v1/users?q=`: legalább 2 karakter, legfeljebb 10 találat, csak név és avatar (D56). */
export function useUserSearch(): (query: string, signal: AbortSignal) => Promise<UserOption[]> {
  const api = useApi();
  return useCallback(
    (query, signal) => api.get<UserRef[]>(`/api/v1/users?q=${encodeURIComponent(query)}`, signal),
    [api],
  );
}
