import type { MeResponse } from '@taltos/shared';

/**
 * A `GET /me` `currentSpaceId`-je (D57). A tárolt érték csak akkor érvényes, ha a felhasználó még aktív tagja a
 * (nem törölt) színtérnek: a `spaces` az aktív, nem törölt tagságokat tartalmazza, így a tagság-ellenőrzés nem kér
 * újabb lekérdezést. Különben tartalék: az Általános, majd az első saját tér (a `spacesOf` sorrendje), majd null.
 */
export function resolveCurrentSpaceId(
  stored: string | null,
  spaces: MeResponse['spaces'],
): string | null {
  if (stored !== null && spaces.some((space) => space.id === stored)) return stored;
  return (spaces.find((space) => space.type === 'general') ?? spaces[0])?.id ?? null;
}
