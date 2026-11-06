import type { UserRef } from './users.js';

/** A dokumentum-kapcsolat típusai (B4 `link_type`, D39). */
export const LINK_TYPES = ['hivatkozik', 'szarmazik', 'epit_ra', 'helyettesiti'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** Egy kimenő kapcsolat a revízió metaadat-pillanatképében: csak azonosító és típus (B4 S17, D44). */
export interface RevisionLink {
  toId: string;
  type: LinkType;
  /** A hivatkozás szövege (V54); a duplikálás `származik` kapcsolatánál `null`. */
  anchor: string | null;
}

/**
 * A `document_revisions.metadata` JSONB alakja (B4 S10, S17; D59 d): a fajta, a címkék és a kapcsolatok pillanatképe.
 * CSAK azonosítókat tartalmaz: a címkenevek és a dokumentumcímek olvasáskor, láthatósági szűréssel oldódnak fel
 * (így idegen színtér címe nem szivárog, és az átnevezés nem érinti a történetet). A WP5a első revíziója, a WP6
 * checkpointjai és a WP8 beküldése is ezt írja. A `tagIds` rendezett (az azonos állapot azonos JSON-t ad).
 */
export interface RevisionMetadata {
  kind: string;
  tagIds: string[];
  links: RevisionLink[];
}

/** JSON-séma minták: a NUL (`U+0000`) karaktert a Postgres `text` nem tárolja, ezért a bemeneti határon utasítjuk el (400). */
export const NO_NUL_PATTERN = '^[^\\u0000]*$';
/** Legalább egy nem szóköz karakter, NUL nélkül. */
export const NON_BLANK_NO_NUL_PATTERN = '^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$';

/** Dokumentum-cím felső korlátja karakterben (a megjelenítés és a slug miatt; a WP5a feltevése, a napló nem rögzít). */
export const DOCUMENT_TITLE_MAX = 200;

/** Címkenév hossza karakterben (D59 g). */
export const TAG_NAME_MIN = 1;
export const TAG_NAME_MAX = 64;

/**
 * A címke normalizált alakja (D34, D59 g): szóközök összevonva és levágva, kisbetű, az ékezet (összetett
 * jelek, NFD) lemosva. Az egyediség a `tags.normalized_name`-en él; a megjelenítési név az elsőként
 * létrehozó írásmódja marad. Az alkalmazás számolja (a DB nem), a kliens és a szerver ugyanezt használja.
 */
export function normalizeTagName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** A címke megjelenítési neve: levágva, a szóközök összevonva, a betűk írásmódja megtartva. */
export function displayTagName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim();
}

/** Egy címke azonosítóval és névvel. */
export interface TagRef {
  id: string;
  name: string;
}

/** Címke a látható, nem törölt dokumentumokon való használat számával (D58). */
export interface TagWithCount extends TagRef {
  count: number;
}

/** `GET /api/v1/tags` `q` nélkül: a hívó számára látható dokumentumokon használt címkék. */
export interface TagListResponse {
  tags: TagWithCount[];
}

/**
 * `GET /api/v1/tags?q=`: a normalizált pontos egyezés (ha látható) és legfeljebb 3 trigram-javaslat
 * (hasonlóság ≥ 0,4, D34). Idegen színtérben használt címke egyikben sem jelenik meg (D58).
 */
export interface TagSearchResponse {
  exact: TagWithCount | null;
  similar: TagWithCount[];
}

/** `POST /api/v1/tags`: mindkét ágon (új vagy már létező) ugyanez a 200-as válasz (D58, D59 f). */
export interface CreateTagRequest {
  name: string;
}

/** Egy fajta a `document_kinds` listából (D34). */
export interface KindRef {
  key: string;
  label: string;
}

/** A fajta kulcsa: kisbetűs azonosító (`prompt`, `mcp_server`). */
export const KIND_KEY_PATTERN = '^[a-z][a-z0-9_]{0,31}$';
export const KIND_LABEL_MAX = 64;

/** `POST /api/v1/kinds` (Rendszeradmin). */
export interface CreateKindRequest {
  key: string;
  label: string;
}

/** `POST /api/v1/documents` (D47, D58, D59): üres vagy duplikálás (`sourceDocumentId`). */
export interface CreateDocumentRequest {
  spaceId: string;
  title: string;
  kind: string;
  tagIds?: string[];
  sourceDocumentId?: string;
}

/**
 * Kapcsolat, amelynek célpontját a néző nem láthatja (idegen színtér, D44): csak a színtér azonosítója, a célpont
 * azonosítója és címe nélkül (B5 `/links` szabálya).
 */
export interface HiddenLink {
  hidden: true;
  spaceId: string;
}

/**
 * A legutóbbi Jóváhagyott revízió metaadata, a duplikálás előtöltéséhez (D58, D59 a): a cím a revízióból, a fajta,
 * a címkék (nevekkel feloldva) és a kapcsolatok a pillanatképből.
 */
export interface ApprovedMetadata {
  revisionId: string;
  title: string;
  kind: string;
  tags: TagRef[];
  links: (RevisionLink | HiddenLink)[];
}

/**
 * `GET /api/v1/documents/:id` és a `POST /api/v1/documents` válasza (WP5a, D59 a): az ÉLŐ metaadat és állapot,
 * tartalom nélkül. A függő kérés, a kedvenc és a követés mezői a saját csomagjukkal jönnek.
 */
export interface DocumentDetail {
  id: string;
  spaceId: string;
  slug: string;
  title: string;
  kind: string;
  owner: UserRef;
  reviewState: 'draft' | 'pending' | 'changes_requested' | 'approved';
  approvedRevisionId: string | null;
  iteration: number;
  /** Archivált (jóváhagyott törléssel kikerült) dokumentum: olvasható, de csak olvasható. */
  archived: boolean;
  tags: TagRef[];
  approvedMetadata: ApprovedMetadata | null;
  createdAt: string;
  updatedAt: string;
}
