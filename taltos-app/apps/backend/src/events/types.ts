import type { SpaceRole, SpaceType } from '@taltos/shared';

/**
 * A WP4a által írt események típusos uniója (B4 eseménykatalógus, D43, D55, D56). Szabályok:
 *  - a `details` CSAK azonosítót, felsorolt értéket és logikai jelzőt tartalmazhat: név, e-mail, cím, komment-szöveg
 *    soha (D48; a megjelenítő névfeloldás olvasáskor történik);
 *  - dokumentum-eseménynél a `spaceId` kötelező (CHECK `events_document_has_space`);
 *  - aktor nélkül (`actorId: null`) csak a szűk, felsorolt esetek írhatók (CHECK `events_actor_required`, D51 d, D56);
 *  - az értesítéseket a WP10 köti a `recordEvent`-re, a WP4a csak eseményt ír (D56).
 */

interface Spaced {
  spaceId: string;
}

interface Documented extends Spaced {
  documentId: string;
}

/** Aktorral írt esemény. */
interface ByActor {
  actorId: string;
}

export type SpaceEvent = Spaced &
  ByActor &
  (
    | { type: 'space_created'; details: { type: SpaceType; initialManagerId: string } }
    | { type: 'space_updated'; details: { fields: ('name' | 'description' | 'color')[] } }
    | { type: 'space_closed'; details: { withdrawnRequests: number } }
    | { type: 'space_manager_assigned'; details: { userId: string } }
    | {
        type: 'member_added';
        details: {
          userId: string;
          role: SpaceRole;
          /** A Rendszeradmin önfelvétele: értesítés nélkül (D56). */
          self_assigned?: true;
          source?: 'first_login';
        };
      }
    | { type: 'member_removed'; details: { userId: string } }
    | { type: 'role_changed'; details: { userId: string; from: SpaceRole; to: SpaceRole } }
    | { type: 'membership_requested'; details: { requestId: string; viaDocumentId?: string } }
    | {
        type: 'membership_request_decided';
        details: { requestId: string; approved: boolean; role?: SpaceRole };
      }
  );

/** Rendszerszintű (színtér nélküli) események aktorral: a projekt-tér kérése és a Rendszeradmin-szerep. */
export type SystemEvent = ByActor &
  (
    | { type: 'space_requested'; details: { requestId: string } }
    | {
        type: 'space_request_decided';
        details: { requestId: string; approved: boolean; spaceId?: string };
      }
    | { type: 'system_admin_granted'; details: { userId: string } }
    | { type: 'system_admin_revoked'; details: { userId: string } }
  );

export type DocumentEvent = Documented &
  ByActor &
  (
    | {
        type: 'owner_changed';
        details: { from: string; to: string; reason: 'handover' | 'admin_handover' };
      }
    /** Létrehozás Piszkozatként, üresen vagy duplikálással (WP5a, D47, D59). */
    | { type: 'created'; details: Record<string, never> }
    /** Soha be nem küldött piszkozat eldobása (B4 S13, D59 e). */
    | { type: 'draft_discarded'; details: Record<string, never> }
    /**
     * Duplikálás, MINDKÉT oldalon (D58, D59 b). A másolat oldalán a forrás azonosítói, a forrás oldalán a cél: az
     * utóbbi idegen színtérbeli másolatot árulhat el, ezért a feed és az audit (WP9) olvasáskor a néző láthatósága
     * szerint kitakarja (`hidden`). A WP5a-ban nincs eseményt olvasó végpont.
     */
    | {
        type: 'duplicated_from';
        details:
          | { sourceDocumentId: string; sourceSpaceId: string; sourceRevisionId: string | null }
          | { targetDocumentId: string; targetSpaceId: string };
      }
  );

/** Címke- és fajta-események (D34, B4 2. szakasz): színtér és dokumentum nélkül; a `details` csak azonosítót visz, nevet nem (D48). */
export type CatalogEvent = ByActor &
  (
    | { type: 'tag_created'; details: { tagId: string } }
    | { type: 'kind_created'; details: { key: string } }
  );

/**
 * Visszavonás és review-er kiesés: a változáshoz kötött dokumentum-események. Aktor nélkül csak a felsorolt ok
 * mellett: `review_withdrawn` / `space_closed` (D55, D56), `reviewer_removed` / `allowlist_removed` (D56 bővítés).
 */
export type ReviewEvent = Documented & {
  changeRequestId: string;
} & (
    | { type: 'review_withdrawn'; actorId: null; details: { reason: 'space_closed' } }
    | {
        type: 'review_withdrawn';
        actorId: string;
        details: { reason: 'member_removed' };
      }
    | {
        type: 'reviewer_removed';
        actorId: null;
        details: { reviewerId: string; reason: 'allowlist_removed' };
      }
    | {
        type: 'reviewer_removed';
        actorId: string;
        details: { reviewerId: string; reason: 'member_removed' };
      }
  );

export type AppEvent = SpaceEvent | SystemEvent | DocumentEvent | ReviewEvent | CatalogEvent;

export type AppEventType = AppEvent['type'];
