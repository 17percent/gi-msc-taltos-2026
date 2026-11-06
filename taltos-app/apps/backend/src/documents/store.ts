import type { DocumentDetail } from '@taltos/shared';
import type { Actor } from '../policy/targets.js';
import type { StoreResult } from '../spaces/store.js';

/** A létrehozás bemenete (a `POST /documents` törzse, normalizálva: levágott cím, ismétlődés nélküli címkék). */
export interface NewDocument {
  spaceId: string;
  title: string;
  kind: string;
  tagIds: string[];
  /** Duplikálás forrása; nélküle üres a dokumentum. */
  sourceDocumentId?: string;
}

/**
 * A dokumentum-mag adatelérési varrata (WP5a; mint a `SpaceStore`): egy metódus egy használati eset, az üzleti
 * hibák eredmény-unióban jönnek, a PostgreSQL-megvalósítás az éles, a tesztek memóriabeli párt használnak
 * (közös szerződés: `document-store-contract.ts`). Minden írás egy tranzakció a hozzá tartozó eseményekkel.
 *
 * A `can()` döntést a hívó (route) hozza a betöltött célponton; a tár a tér zára alatt újra meghozza ugyanazt a
 * döntést (a `can()` tiszta függvény), így a közbenjött lezárás vagy tagság-visszavonás nem csúszhat át.
 */
export interface DocumentStore {
  /**
   * Létrehozás Piszkozatként (D47, D58, D59): üresen vagy duplikálással. Egy tranzakcióban a dokumentum-sor (a
   * kezdő szöveggel a `content`-ben; `document_collab_state` nem jön létre), az első revízió (tartalom + metaadat-
   * pillanatkép, szerző a létrehozó; nem véglegesít), a címkék (a `tag_text`-et a DB-trigger állítja), duplikálásnál
   * a `származik` kapcsolat, és az események (`created`, duplikálásnál `duplicated_from` mindkét oldalon).
   * Hibák: `not_found` (hiányzó tér vagy forrás), a `can()` elutasításai, `validation_error` (ismeretlen/törölt fajta,
   * ismeretlen címke-azonosító).
   */
  createDocument(actor: Actor, input: NewDocument, now: Date): Promise<StoreResult<DocumentDetail>>;
  /**
   * A dokumentum élő metaadata és állapota, a LÁTHATÓ dokumentumok feltételén át (D44); `undefined`: nincs ilyen,
   * eldobott piszkozat, vagy a néző nem tag (a nem tag 403-át a route a `can()` + `AccessStore` adja).
   */
  getDocument(viewerId: string, documentId: string): Promise<DocumentDetail | undefined>;
  /**
   * Piszkozat-eldobás (D59 e): a `ReviewService.discardDraft` egyetlen feltételes UPDATE-jével. Hibák: `not_found`,
   * a `can()` elutasításai (a tulajdonos vagy Színtérgazda szabálya, lezárt tér), `request_pending`,
   * `has_approved_revision`. A nyitott `/collab`-kapcsolatok bontása a route dolga, a sikeres commit után.
   */
  discardDraft(actor: Actor, documentId: string, now: Date): Promise<StoreResult<null>>;
}
