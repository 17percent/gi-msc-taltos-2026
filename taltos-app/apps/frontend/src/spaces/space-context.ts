import type { SpaceColor, SpaceRole, SpaceSummary, SpaceType } from '@taltos/shared';
import { createContext, useContext } from 'react';
import { compareSpaces } from './labels';

/** A színtérváltó egy eleme: tagság és szerep a `/me`-ből, szín és lezárt-állapot a `GET /spaces`-ből. */
export type SwitcherSpace = {
  id: string;
  name: string;
  type: SpaceType;
  role: SpaceRole;
  color: SpaceColor | null;
  closed: boolean;
};

export type SpaceContextValue = {
  status: 'loading' | 'ready' | 'error';
  /** A `GET /spaces` teljes listája (Rendszeradminnak minden színtér, lezártak is). */
  summaries: SpaceSummary[];
  /** Csak azok a színterek, amelyeknek a felhasználó tagja. */
  memberSpaces: SwitcherSpace[];
  currentSpaceId: string | null;
  /** A váltás sikertelen volt: felhasználói üzenet, vagy `null`. */
  switchError: string | null;
  /** Sikerrel tér vissza; hibánál a váltó visszaáll és a `switchError` kitöltődik. */
  selectSpace: (spaceId: string) => Promise<boolean>;
  clearSwitchError: () => void;
  /** Újratölti a `GET /spaces`-t. */
  reload: () => void;
  /** A saját tagságot érintő művelet után: `/me` és `GET /spaces` újratöltése (spec 2.5). */
  refreshMembership: () => Promise<void>;
};

export const SpaceContext = createContext<SpaceContextValue | null>(null);

/** Az aktuális színtér: a szerver `currentSpaceId`-je; ha az nem (már) saját tér, az Általános, majd az első. */
export function fallbackSpaceId(
  me: { spaces: Array<{ id: string; name: string; type: SpaceType }> },
  candidate: string | null,
): string | null {
  if (candidate && me.spaces.some((space) => space.id === candidate)) return candidate;
  const general = me.spaces.find((space) => space.type === 'general');
  const sorted = [...me.spaces].sort(compareSpaces);
  return general?.id ?? sorted[0]?.id ?? null;
}

export function useSpaces(): SpaceContextValue {
  const value = useContext(SpaceContext);
  if (!value) throw new Error('A useSpaces a SpaceProvideren belül használható.');
  return value;
}
