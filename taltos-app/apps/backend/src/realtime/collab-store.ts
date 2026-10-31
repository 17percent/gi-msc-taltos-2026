export type ReviewState = 'draft' | 'pending' | 'changes_requested' | 'approved';

/** Ezekben az állapotokban szerkeszthető a dokumentum (D45); Review-ra vár (pending) és Jóváhagyott: csak olvasható. */
export const WRITABLE_REVIEW_STATES = [
  'draft',
  'changes_requested',
] as const satisfies readonly ReviewState[];

/** A kapcsolat hozzáférési adatai: csak ha a felhasználó aktív tag, és a dokumentum és a színtér él. */
export interface CollabAccess {
  reviewState: ReviewState;
  /** A színtér lezárt (`closed_at` be van állítva): D44, csak olvasható. */
  spaceClosed: boolean;
}

/** A Yjs-dokumentum betöltéséhez szükséges adat: a mentett állapot, vagy ha az nincs, a dokumentum szövege. */
export interface CollabContent {
  /** A `document_collab_state.state`; `null`, ha a dokumentumnak még nincs Yjs-állapota. */
  state: Uint8Array | null;
  /** A `documents.content`, de csak ha nincs `state` (különben `null`: a nagy szöveget nem olvassuk fölöslegesen). */
  seed: string | null;
}

/** Írhat-e a kapcsolat (a Hocuspocus csak ekkor alkalmazza a kliens módosításait). */
export function isWritable(access: CollabAccess): boolean {
  return (
    !access.spaceClosed &&
    (WRITABLE_REVIEW_STATES as readonly string[]).includes(access.reviewState)
  );
}

/**
 * A `/collab` adatelérési varrata (mint az `AuthStore`): a PostgreSQL-megvalósítás az éles, a tesztek memóriabeli párt
 * használnak. A hozzáférés-döntés SQL-je ideiglenes: a WP4 `can(user, action, resource)` policy-ja váltja le.
 */
export interface CollabStore {
  /** `undefined`: nincs hozzáférés. A „nem létezik / törölt / nem tag” okát szándékosan nem különbözteti meg. */
  findAccess(userId: string, documentId: string): Promise<CollabAccess | undefined>;
  /** `undefined`: a dokumentum nem létezik (vagy törölt). */
  loadContent(documentId: string): Promise<CollabContent | undefined>;
  /**
   * Egy tranzakcióban menti a Yjs-állapotot és anyagosítja a `documents.content`-et. A tranzakción belül újra
   * ellenőrzi, hogy a dokumentum még írható-e; ha nem, nem ír és `false`-t ad.
   */
  saveContent(documentId: string, state: Uint8Array, text: string, now: Date): Promise<boolean>;
}
