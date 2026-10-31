export type ReviewState = 'draft' | 'pending' | 'changes_requested' | 'approved';

/** Ezekben az állapotokban szerkeszthető a dokumentum (D45); Review-ra vár (pending) és Jóváhagyott: csak olvasható. */
export const WRITABLE_REVIEW_STATES = [
  'draft',
  'changes_requested',
] as const satisfies readonly ReviewState[];

/** A Yjs-dokumentum betöltéséhez szükséges adat: a mentett állapot, vagy ha az nincs, a dokumentum szövege. */
export interface CollabContent {
  /** A `document_collab_state.state`; `null`, ha a dokumentumnak még nincs Yjs-állapota. */
  state: Uint8Array | null;
  /** A `documents.content`, de csak ha nincs `state` (különben `null`: a nagy szöveget nem olvassuk fölöslegesen). */
  seed: string | null;
}

/**
 * A `/collab` adatelérési varrata (mint az `AuthStore`): a PostgreSQL-megvalósítás az éles, a tesztek memóriabeli párt
 * használnak. A hozzáférés-döntés NEM itt van: azt az `AccessStore` + `can()` adja (egyetlen policy-pont, WP4a S6).
 */
export interface CollabStore {
  /** `undefined`: a dokumentum nem létezik (vagy törölt). */
  loadContent(documentId: string): Promise<CollabContent | undefined>;
  /**
   * Egy tranzakcióban menti a Yjs-állapotot és anyagosítja a `documents.content`-et. A tranzakción belül újra
   * ellenőrzi, hogy a dokumentum még írható-e; ha nem, nem ír és `false`-t ad.
   */
  saveContent(documentId: string, state: Uint8Array, text: string, now: Date): Promise<boolean>;
}
