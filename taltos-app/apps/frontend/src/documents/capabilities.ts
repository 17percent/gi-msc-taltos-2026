import type { DocumentDetail, SpaceRole, SystemRole } from '@taltos/shared';
import type { SwitcherSpace } from '../spaces/space-context';

/** Színterek, ahová a felhasználó dokumentumot hozhat létre: tag és nem lezárt (spec 1., 7.). */
export function creatableSpaces(memberSpaces: readonly SwitcherSpace[]): SwitcherSpace[] {
  return memberSpaces.filter((space) => !space.closed);
}

export type DocumentCapabilityInput = {
  systemRole: SystemRole;
  userId: string;
  doc: Pick<DocumentDetail, 'reviewState' | 'approvedRevisionId' | 'archived' | 'owner'>;
  /** A dokumentum színtere a felhasználó tagságai közül (`null`: nem tag, vagy még nem töltődött be). */
  space: { closed: boolean; role: SpaceRole } | null;
  /** Van-e legalább egy nem lezárt tagsági színtér (a Duplikálás célja). */
  hasCreatableSpace: boolean;
};

export type DocumentCapabilities = { duplicate: boolean; discard: boolean };

/**
 * A spec 5. és 7. szakasza: a felület elrejti, amit a hívó nem tehet meg (a backend dönt).
 * A nem tag Rendszeradmin semmit nem lát ezen a fejlécen (a 403 hozzáférés-állapot kezeli).
 * A kliensoldali eldobás-szabály (D60 NK6): Piszkozat, nincs Jóváhagyott revízió, nem archivált,
 * nem lezárt tér, a hívó a tulajdonos vagy a Színtérgazda.
 */
export function documentCapabilities({
  userId,
  doc,
  space,
  hasCreatableSpace,
}: DocumentCapabilityInput): DocumentCapabilities {
  const mayDiscard =
    space !== null && !space.closed && (doc.owner.id === userId || space.role === 'space_manager');
  return {
    duplicate: space !== null && hasCreatableSpace,
    discard:
      mayDiscard && doc.reviewState === 'draft' && doc.approvedRevisionId === null && !doc.archived,
  };
}
