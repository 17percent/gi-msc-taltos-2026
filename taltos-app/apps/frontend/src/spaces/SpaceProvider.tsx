import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SpaceSummary } from '@taltos/shared';
import { messageFor } from '../api/errors';
import { isApiError } from '../api/client';
import { useApi } from '../api/use-api';
import { useResource } from '../api/use-resource';
import { useAuth } from '../auth/auth-context';
import type { MeResponse } from '../auth/types';
import { compareSpaces } from './labels';
import {
  SpaceContext,
  fallbackSpaceId,
  type SpaceContextValue,
  type SwitcherSpace,
} from './space-context';

function SignedInSpaceProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  const api = useApi();
  const { refreshMe } = useAuth();
  const summaries = useResource('spaces', (client, signal) =>
    client.get<SpaceSummary[]>('/api/v1/spaces', signal),
  );
  const { reload } = summaries;
  const [override, setOverride] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const currentSpaceId = fallbackSpaceId(me, override ?? me.currentSpaceId);

  const memberSpaces = useMemo<SwitcherSpace[]>(() => {
    const byId = new Map((summaries.data ?? []).map((summary) => [summary.id, summary]));
    return me.spaces
      .map((space) => ({
        ...space,
        color: byId.get(space.id)?.color ?? null,
        closed: byId.get(space.id)?.closed ?? false,
      }))
      .sort(compareSpaces);
  }, [me.spaces, summaries.data]);

  const refreshMembership = useCallback(async () => {
    reload();
    await refreshMe();
  }, [reload, refreshMe]);

  const clearSwitchError = useCallback(() => setSwitchError(null), []);

  // Gyors egymás utáni váltásnál csak a legutóbbi kérés állíthat vissza; a visszaállás célja az
  // utolsó, a szerver által megerősített érték (`null`: a `/me` currentSpaceId-je).
  const latestRequest = useRef(0);
  const confirmed = useRef<string | null>(null);

  const selectSpace = useCallback(
    async (spaceId: string): Promise<boolean> => {
      if (spaceId === currentSpaceId) return true;
      const request = ++latestRequest.current;
      setSwitchError(null);
      setOverride(spaceId);
      try {
        await api.put('/api/v1/me/current-space', { spaceId });
        confirmed.current = spaceId;
        return true;
      } catch (error) {
        // Nem sikerült rögzíteni a szerveren: a váltó visszaáll, és a felhasználó látja az okot.
        if (request === latestRequest.current) {
          setOverride(confirmed.current);
          setSwitchError(messageFor(error, { action: 'switch-space' }));
          if (isApiError(error) && error.code === 'not_space_member') await refreshMembership();
        }
        return false;
      }
    },
    [api, currentSpaceId, refreshMembership],
  );

  const value = useMemo<SpaceContextValue>(
    () => ({
      status: summaries.status,
      summaries: summaries.data ?? [],
      memberSpaces,
      currentSpaceId,
      switchError,
      selectSpace,
      clearSwitchError,
      reload,
      refreshMembership,
    }),
    [
      summaries.status,
      summaries.data,
      memberSpaces,
      currentSpaceId,
      switchError,
      selectSpace,
      clearSwitchError,
      reload,
      refreshMembership,
    ],
  );
  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}

/** Csak bejelentkezve tölt: kijelentkezve nincs színtér-kontextus (a fejléc egyedül marad). */
export function SpaceProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.kind !== 'signed-in') return <>{children}</>;
  return <SignedInSpaceProvider me={state.me}>{children}</SignedInSpaceProvider>;
}
