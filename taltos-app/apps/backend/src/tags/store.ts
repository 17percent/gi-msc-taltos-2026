import type { KindRef, TagListResponse, TagRef, TagSearchResponse } from '@taltos/shared';
import type { Actor } from '../policy/targets.js';
import type { StoreResult } from '../spaces/store.js';

/** A trigram-javaslat hasonlósági küszöbe (D34) és a javaslatok felső száma. */
export const TAG_SIMILARITY_THRESHOLD = 0.4;
export const TAG_SUGGESTION_LIMIT = 3;
/** A `q` nélküli címkelista felső korlátja (a kontraktus nem lapoz; a pilot méretében ez bőven elég). */
export const TAG_LIST_LIMIT = 1000;

/**
 * A címkék és a fajták adatelérési varrata (WP5a; D34, D58, D59). A PostgreSQL-megvalósítás az éles, a tesztek
 * memóriabeli párt használnak (közös szerződés: `tag-store-contract.ts`).
 *
 * D44-szabály: a lista, a javaslat és a darabszám CSAK a nézőnek látható, nem törölt dokumentumokon használt címkékből
 * épül (a „látható dokumentumok” feltételén át); az idegen színtérben használt, vagy árva címke rejtve marad.
 */
export interface TagStore {
  /** A látható címkék darabszámmal (`GET /tags` `q` nélkül), darabszám szerint csökkenően, majd név szerint. */
  listTags(viewerId: string): Promise<TagListResponse>;
  /**
   * `GET /tags?q=`: a NORMALIZÁLT lekérdezésre (`normalizeTagName`) a pontos egyezés (ha látható) és legfeljebb 3
   * trigram-javaslat (hasonlóság ≥ 0,4, hasonlóság szerint csökkenően, egyenlőségnél név szerint).
   */
  searchTags(viewerId: string, normalizedQuery: string): Promise<TagSearchResponse>;
  /**
   * Címke létrehozása (D58, D59 f): `INSERT … ON CONFLICT (normalized_name) DO NOTHING RETURNING`, üresen a meglévő
   * sor. A válasz mindkét ágon azonos alakú (`{ id, name }`), a `tag_created` esemény csak valódi beszúrásnál íródik.
   * A név és a normalizált alak megfelelőségét (1–64 karakter, nem üres) a hívó ellenőrzi.
   */
  createTag(actor: Actor, name: string, now: Date): Promise<TagRef>;
  /** A nem törölt fajták, a rendezés szerint (`sort_order`, `key`); a lista nem tartalmaz darabszámot, nem érintett a D58-ban. */
  listKinds(): Promise<KindRef[]>;
  /**
   * Fajta bővítése (Rendszeradmin, `kind_created`): a kulcs egyedi, a már létező (törölt is) kulcs `validation_error`
   * (a katalógusban nincs külön kód). A jogosultságot a hívó (`system.kinds.manage`) döntötte el.
   */
  createKind(actor: Actor, input: KindRef, now: Date): Promise<StoreResult<KindRef>>;
}
