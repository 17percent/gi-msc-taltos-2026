import type { SpaceRole, SpaceType, SystemRole } from '@taltos/shared';
import type { ReviewState } from '../realtime/collab-store.js';

/** A művelet végrehajtója: a munkamenetből jön (a Rendszeradmin-státusz minden kérésnél friss, nem gyorsítótárazott). */
export interface Actor {
  userId: string;
  systemRole: SystemRole;
}

/** Egy színtér a hívó szemszögéből; a `membership` az AKTÍV tagság szerepe (`removed_at IS NULL`), nem tagnál `null`. */
export interface SpaceTarget {
  spaceId: string;
  type: SpaceType;
  /** Lezárt projekt-tér (`closed_at` be van állítva): D44, minden módosítás tiltott. */
  closed: boolean;
  membership: SpaceRole | null;
}

/** Egy (nem végleg törölt) dokumentum, a színterével és a hívóhoz tartozó viszonyokkal. */
export interface DocumentTarget {
  documentId: string;
  space: SpaceTarget;
  ownerId: string;
  /** Archivált (jóváhagyott törléssel kikerült) dokumentum; az eldobott piszkozat nem betölthető, 404. */
  archived: boolean;
  reviewState: ReviewState;
  /** A hívó a függő kérés aktív review-er helyén áll (függő kérés nélkül `undefined`). */
  isDesignatedReviewer?: boolean;
  /** A függő kérés indítványozója (függő kérés nélkül `undefined`). */
  initiatorId?: string;
}

/** A rendszerszintű (színtér nélküli) műveleteknek nincs célpontjuk. */
export type SystemTarget = undefined;

/** A tagság-hozzáférés elutasításának kódjai (a B5 katalógus részhalmaza). */
export type DenyCode = 'not_space_member' | 'forbidden' | 'space_closed';

export type Decision = { ok: true } | { ok: false; code: DenyCode };
