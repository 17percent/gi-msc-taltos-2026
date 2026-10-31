/**
 * A `/collab` csatorna szerződése (D29, B5 A12) — a WP3 spike és a WP6 közös alapja.
 *
 * - A Hocuspocus dokumentumneve a dokumentum UUID-ja (kisbetűs, kötőjeles alak); más név elutasítva.
 * - A Yjs-dokumentum markdown-tartalma egyetlen `Y.Text` a `COLLAB_TEXT_FIELD` néven.
 * - Írni csak Piszkozat és Átdolgozandó állapotban lehet, nem lezárt színtérben; egyébként a kapcsolat
 *   csak olvasható (D45, D44). Nem tag és nem létező dokumentum ugyanazzal az elutasítással jár (cím nem szivárog).
 */

/** A Yjs-dokumentum markdown-tartalmát hordozó `Y.Text` neve. */
export const COLLAB_TEXT_FIELD = 'content';

/** Az Awareness `user` mezője: a távoli kurzor névcímkéje és színe. */
export interface CollabAwarenessUser {
  name: string;
  /** CSS-színérték (a Táltos DS tokenjeiből választva). */
  color: string;
}

/** A dokumentumnév formája: UUID (bármely verzió), kisbetűvel. */
export const COLLAB_DOCUMENT_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
