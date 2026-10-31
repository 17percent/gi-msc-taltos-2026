import type { NotSpaceMemberDetails } from '@taltos/shared';
import type { Actor, DocumentTarget, SpaceTarget } from './targets.js';

/**
 * A jogosultság-döntés adatelérési varrata (mint az `AuthStore`): a PostgreSQL-megvalósítás az éles, a tesztek
 * memóriabeli párt használnak; a közös szerződést a `access-store-contract` teszt mindkettőn lefuttatja.
 *
 * Szabályok:
 *  - kérésenként EGY betöltés (a `can()` bemenete); a tagság SOHA nem gyorsítótárazott;
 *  - nem létező, törölt színtér vagy dokumentum: `undefined` (404 `not_found`); a nem tag ettől különbözik,
 *    mert annak a célpontja létezik, csak a `membership` null;
 *  - a Rendszeradmin-státuszt NEM innen vesszük (az `Actor` a munkamenetből jön).
 */
export interface AccessStore {
  /** A színtér a hívó aktív tagságával; `undefined`: nincs ilyen (vagy törölt) színtér. */
  spaceTarget(userId: string, spaceId: string): Promise<SpaceTarget | undefined>;
  /**
   * A dokumentum a színterével, a tulajdonossal és a függő kérés viszonyaival; `undefined`: nincs ilyen, vagy
   * eldobott piszkozat (az archivált dokumentum betöltődik, `archived: true`), vagy a színtere törölt.
   */
  documentTarget(userId: string, documentId: string): Promise<DocumentTarget | undefined>;
  /**
   * A `not_space_member` részletei, CSAK elutasításkor kérdezzük. Cím, darabszám és taglétszám soha nincs benne (D44).
   * `undefined`: a színtér nem létezik.
   */
  denialDetails(actor: Actor, spaceId: string): Promise<NotSpaceMemberDetails | undefined>;
}

/**
 * A felvételi kérés lehetősége a nem tagnak: a Rendszeradmin önfelvétellel lép be (D56), lezárt térbe nincs új kérés
 * (D56 bővítés), függő kérésnél a második 409 lenne. A két adapter ugyanezt a szabályt használja.
 */
export function canRequestMembership(input: {
  systemRole: Actor['systemRole'];
  closed: boolean;
  hasPendingRequest: boolean;
}): boolean {
  return input.systemRole !== 'system_admin' && !input.closed && !input.hasPendingRequest;
}
