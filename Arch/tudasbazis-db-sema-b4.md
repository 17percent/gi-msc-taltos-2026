# Tudásbázis — PostgreSQL séma (B4, 10. verzió)

*A [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] 4. fejezetének konkrét leképezése. Eszköz: Drizzle (D25). A napló az elvi forrás: eltérés esetén a napló nyer, és ezt a dokumentumot kell frissíteni.*

*D51-kiegészítés (2026-10-23): a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|napló D51]] tíz döntése (sessions, review-er kiesése, `edit_started`, `actor_id` NULL, élő/Jóváhagyott metaadat, `proposed_review_due_at`, `unarchive`, FK nélküli események, checkpoint-retenció, fizikai törlés kivételei) és az átvizsgálás döntés nélküli javításai (kompozit FK-k, `freshness_at`, DB-szerepek, indexterv, trigger-keményítés) átvezetve; az új vagy módosult elemek „(D51)” jelölést kapnak.*

*Változás a korábbi B4-hez képest ([[Tervezés/Tervezés (negyedik kör)/tudasbazis-db-sema-b4|B4, napló v5 szerint]]): a Git-alapú mezők (`repo_path`, `last_commit_hash`, reindex) megszűntek (D1, Postgres-only). Új a teljes revíziótörténet (D1), a közös szerkesztés állapota (D29), a színterek és szerepek (D30, D43, D44), a review-folyamat (D45), a címkék és a fajta (D34), a kapcsolatok (D39), az értesítések (D35, D46) és a felülvizsgálat (D33). A `locks` tábla (D7) megszűnt, a `categories` helyét a `tags` vette át, a pg-boss nincs (D22). A többformátumú tartalom (D42) táblái külön, második ütemes migrációban vannak (6. szakasz).*

## 0. Elvek, amelyeket a séma kódol

- **Egyetlen adatréteg (D1):** minden tábla elsődleges adat; nincs „repóból újraépíthető” kategória. Kivétel a futásidejű Yjs-állapot és a kinyert származékok (5. szakasz).
- **Soft delete (D20), kimondott kivételekkel (D51):** `deleted_at timestamptz` nullable oszlop. Fizikai `DELETE` az alkalmazásból tilos, csak a retenciós folyamat (D48) végezhet. **Kivétel (D51 j):** a privát kapcsoló- és párosítótáblák (`favorites`, `subscriptions`, `user_space_colors`, `document_tags`) sorai az alkalmazásból is fizikailag törölhetők, mert nincs auditértékük (a címkék története a revízió-pillanatképben él). Az alkalmazás DB-szerepe (`taltos_app`) kizárólag ezekre kap DELETE-jogot (3. szakasz, 0005). Minden FK `RESTRICT`; kivétel az `events` naplóhivatkozásai, amelyek FK nélküli uuid-k (S12, D51 h).
- **Dokumentum-identitás = UUID, az alkalmazás generálja:** a `documents.id`-nek nincs DB-oldali defaultja.
- **A revíziók megváltoztathatatlanok (D1, D45):** a `document_revisions` csak INSERT; visszaállítás = új revízió. Egy revízió mindig a saját dokumentumához tartozik: minden revízió-hivatkozás kompozit FK `(document_id, revision_id)` (D51, S22).
- **Kikényszerített review (D45):** a dokumentum „hivatalos” állapota az `approved_revision_id`. Ezt kizárólag a `ReviewService` állíthatja, review-kérés döntésének tranzakciójában. A `ReviewService` által írt átmenetek listája: S13.
- **Élő és Jóváhagyott metaadat (D51 e, D45):** az élő táblák (`documents.title/kind/content/tag_text`, `document_tags`, `document_links`) mindig a **legutóbbi (élő) állapotot** hordozzák. Az alkalmazáson belüli nézetek (lista, keresés, facetek, Atlasz, dokumentumnézet) ezt mutatják állapotjelzővel. A **Jóváhagyott változat** a `document_revisions.metadata` pillanatképéből és a revízió tartalmából áll elő az export, az MCP, a nyers letöltés és a vágólap számára. **Visszaállításkor** (`restore`) a pillanatkép egy tranzakcióban íródik vissza az élő táblákba (S17).
- **Személyes adat egy helyen (D48):** név és e-mail csak a `users` táblában van; minden más tábla `user_id`-vel hivatkozik. A pszeudonimizálás így egyetlen `users`-sor átírása, az append-only `events` érintése nélkül. Ismert kivétel a belépési kapu e-mail-kulcsa (`allowlist.email`); a komment @említés-formátuma nyitott (4. szakasz vége).
- **Keresési infrastruktúra, triggerek és részleges indexek kézi SQL-migrációban (D25 kikötés):** 3. szakasz.
- **Adatbázis-szerepek (D51, S23):** a séma tulajdonosa, az alkalmazás és a retenciós folyamat külön szerepkör; az append-only védelem csak így valódi (3. szakasz, 0005).

## 1. Drizzle séma (`schema.ts`)

*Megjegyzések (D51): a Drizzle- és drizzle-kit-verziót a WP1 rögzíti (a `pgTable` harmadik argumentumának tömb-formája új Drizzle-t igényel; a kifejezés-index, a `check` és a `where` interpolációk renderelését a WP1-ben ellenőrizni kell). **`drizzle-kit push` TILOS:** a `search_vector`, a kompozit FK-k és a kézi indexek a TS-sémán kívül élnek, a `push` eldobná őket. A `updated_at` nem frissül automatikusan: az alkalmazás állítja. A listázó lekérdezések explicit oszloplistát használnak (a `content` és a `metadata` nem kerül a listába).*

```ts
import {
  pgTable, pgEnum, uuid, text, timestamp, boolean, integer, smallint,
  bigserial, bigint, jsonb, primaryKey, uniqueIndex, unique, index, customType, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
export const bytea    = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// ── Enumok: zárt, stabil halmazok ────────────────────────────────────────────
export const systemRole     = pgEnum('system_role',     ['user', 'system_admin']);                                // D43
export const spaceType      = pgEnum('space_type',      ['general', 'team', 'project']);                          // D30
export const spaceRole      = pgEnum('space_role',      ['author', 'space_manager']);                             // D43
export const reviewState    = pgEnum('review_state',    ['draft', 'pending', 'changes_requested', 'approved']);   // D45
export const changeKind     = pgEnum('change_kind',     ['create', 'update', 'metadata', 'restore', 'delete', 'unarchive']);  // D45, D51 g
export const changeState    = pgEnum('change_state',    ['pending', 'approved', 'rejected', 'withdrawn']);        // D45
export const reviewDecision = pgEnum('review_decision', ['approved', 'rejected']);                                // D45
export const reviewerEnd    = pgEnum('reviewer_end_reason', ['replaced', 'removed', 'closed']);                   // D51 b
export const linkType       = pgEnum('link_type',       ['hivatkozik', 'szarmazik', 'epit_ra', 'helyettesiti']);  // D39
export const requestState   = pgEnum('request_state',   ['pending', 'approved', 'rejected']);                     // D43, D44

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ── users ── OIDC-identitás; a személyes adat egyetlen helye (D48) ────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  oidcSub: text('oidc_sub'),                        // pszeudonimizáláskor NULL
  email: text('email'),                             // pszeudonimizáláskor NULL
  displayName: text('display_name').notNull(),      // pszeudonimizáláskor 'Volt munkatárs #<rövid id>'
  avatarUrl: text('avatar_url'),
  systemRole: systemRole('system_role').notNull().default('user'),   // D43 (korábban is_admin)
  createdAt: ts('created_at').notNull().defaultNow(),
  lastLoginAt: ts('last_login_at'),                 // „inaktív tulajdonosok” lista (D49, 2. ütem)
  leftAt: ts('left_at'),                            // kilépés ideje — a retenciós óra indul (D48, 2. ütem)
  pseudonymizedAt: ts('pseudonymized_at'),          // D48, 2. ütem
}, (t) => [
  uniqueIndex('users_oidc_sub_uq').on(t.oidcSub),
  uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
]);

// ── sessions ── munkamenet-tár (D51 a, D26, NY10) ────────────────────────────
// A süti opak, nagy entrópiájú tokenjének SHA-256 hash-e az id; a nyers token nem tárolódik.
// Érvényes: now() < expires_at (abszolút, létrehozás + 8 óra) ÉS now() < last_seen_at + 60 perc.
// A last_seen_at írása ritkított (legfeljebb percenként egyszer); a WebSocket-forgalom is frissíti.
// Kijelentkezés és allowlistről levétel: expires_at = now() (UPDATE, nem DELETE); a lejártak törlése a retenciós folyamatban (S21).
export const sessions = pgTable('sessions', {
  id: bytea('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
}, (t) => [
  index('sessions_user_idx').on(t.userId),          // visszavonás felhasználónként (allowlistről levétel)
  index('sessions_expires_idx').on(t.expiresAt),    // takarítás
]);

// ── allowlist ── belépési kapu (D5); MVP-ben konfigurációból seedelve (D49) ───
export const allowlist = pgTable('allowlist', {
  email: text('email').primaryKey(),                // lower-elve tárolva (CHECK)
  note: text('note'),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'restrict' }),   // konfig-seednél NULL
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),                      // újrafelvételkor a sor deleted_at-je NULL-ra áll (nincs második sor)
}, (t) => [
  check('allowlist_email_lower', sql`${t.email} = lower(${t.email})`),
]);

// ── spaces ── színterek (D30, D44) ───────────────────────────────────────────
export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: spaceType('type').notNull(),
  description: text('description'),
  color: text('color').notNull(),                   // Atlasz-alapszín (D37)
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  closedAt: ts('closed_at'),                        // lezárt projekt-tér: csak olvasható (D44)
  deletedAt: ts('deleted_at'),
}, (t) => [
  uniqueIndex('spaces_name_lower_uq').on(sql`lower(${t.name})`),
  check('spaces_closed_only_project', sql`${t.closedAt} IS NULL OR ${t.type} = 'project'`),   // D51
]);

// ── space_members ── tagság és szerep (D43); nem tag = nem lát semmit (D44) ──
// Újrafelvételkor a removed_at NULL-ra áll (a PK miatt nincs második sor); a szerep- és tagság-történet az events-ben él.
export const spaceMembers = pgTable('space_members', {
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  role: spaceRole('role').notNull(),
  addedBy: uuid('added_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  removedAt: ts('removed_at'),                      // soft delete — a tagság-történet az events-ben is
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.userId] }),
  // (D51) a user_id-indexet a 0004 részleges, role-t tartalmazó indexe váltja ki
]);

// ── space_requests ── projekt-tér kérése (D43) ───────────────────────────────
export const spaceRequests = pgTable('space_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestedBy: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  purpose: text('purpose').notNull(),
  proposedManagerId: uuid('proposed_manager_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  state: requestState('state').notNull().default('pending'),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
  decidedAt: ts('decided_at'),
  createdSpaceId: uuid('created_space_id').references(() => spaces.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── membership_requests ── felvétel kérése idegen linkről (D44) ──────────────
export const membershipRequests = pgTable('membership_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  viaDocumentId: uuid('via_document_id'),           // melyik csonkról jött (FK nélkül, S12)
  message: text('message'),
  state: requestState('state').notNull().default('pending'),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
  decidedAt: ts('decided_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── user_space_colors ── egyéni Atlasz-szín (D37), privát, nem naplózott ─────
// Fizikailag törölhető (D51 j): a szín visszaállítása a sor törlése.
export const userSpaceColors = pgTable('user_space_colors', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'restrict' }),
  color: text('color').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.spaceId] })]);

// ── document_kinds ── a fajta-lista (D34), Rendszeradmin bővíti ──────────────
export const documentKinds = pgTable('document_kinds', {
  key: text('key').primaryKey(),                    // 'prompt', 'skill', 'agent', 'mcp_server', …
  label: text('label').notNull(),
  sortOrder: smallint('sort_order').notNull().default(0),
  deletedAt: ts('deleted_at'),
});

// ── documents ── a dokumentum aktuális (élő) állapota ────────────────────────
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey(),                      // NINCS default — az app generálja
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'restrict' }),   // D30
  slug: text('slug').notNull(),                     // URL-attribútum, átnevezéskor változhat (az archivált dokumentum slugja is foglalt)
  title: text('title').notNull(),                   // élő érték (D51 e); a Jóváhagyott cím a revízióban
  kind: text('kind').notNull().references(() => documentKinds.key, { onDelete: 'restrict' }),  // D34, élő érték
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),    // D31, D43
  isTemplate: boolean('is_template').notNull().default(false),     // D47 — 2. ütem: MVP-ben nincs beállító út (sablonná jelölés review-val); csak Jóváhagyott változással áll
  content: text('content').notNull().default(''),   // az élő (legutóbbi) tartalom (D29 materializálás); a Jóváhagyott a revízióból jön
  tagText: text('tag_text').notNull().default(''),  // denormalizált címkenevek a keresővektorhoz; a document_tags triggere tartja karban (S9, D51)
  reviewState: reviewState('review_state').notNull().default('draft'),           // D45, gyorsítótár (S5)
  approvedRevisionId: uuid('approved_revision_id'), // kompozit FK (id, approved_revision_id) a 3. szakaszban (körkörös hivatkozás)
  iteration: integer('iteration').notNull().default(0),  // Jóváhagyott változások száma (D45); minden jóváhagyott kérés növeli (S24)
  reviewDueAt: ts('review_due_at'),                 // D33 — jóváhagyáskor a change_requests.proposed_review_due_at-ből (D51 f)
  freshnessAt: ts('freshness_at').notNull().defaultNow(),   // D36 „frissesség”: kizárólag jóváhagyás és „Még aktuális” írja (D51)
  // search_vector: GENERATED oszlop, kézi migrációban (3. szakasz)
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),    // az app állítja (nem a frissesség-rangsor alapja)
  deletedAt: ts('deleted_at'),                      // archívum (D8, jóváhagyott törléssel) VAGY eldobott piszkozat (approved_revision_id IS NULL)
}, (t) => [
  uniqueIndex('documents_space_slug_uq').on(t.spaceId, t.slug),     // a space_id-előtag miatt külön space_id-index nem kell (D51)
  index('documents_owner_idx').on(t.ownerId),
  index('documents_review_due_idx').on(t.reviewDueAt).where(sql`${t.reviewDueAt} IS NOT NULL AND ${t.deletedAt} IS NULL`),   // D51
  check('documents_approved_has_revision', sql`${t.reviewState} <> 'approved' OR ${t.approvedRevisionId} IS NOT NULL`),   // D51
  check('documents_iteration_nonneg', sql`${t.iteration} >= 0`),
  // TODO (WP6 méretkorlát): CHECK (length(content) <= N) — az N a WP6 méretkorlátjával egyező érték (tsvector-korlát: 1 MB); itt nincs kitalált szám.
]);

// ── document_revisions ── teljes pillanatképek (D1), csak INSERT ─────────────
// Osztályozás nincs az oszlopokon (a tábla append-only): Jóváhagyott = egy approved change_requests.proposed_revision_id;
// függő = pending kérés javaslata; különben köztes checkpoint vagy elutasított/visszavont javaslat (S20, 5. szakasz).
export const documentRevisions = pgTable('document_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),                   // a metaadat is verziózott (S10)
  content: text('content').notNull(),
  metadata: jsonb('metadata').notNull(),            // pillanatkép: kind, címke-id-k, kapcsolatok (cél-id, típus, anchor) — csak azonosítók, címek olvasáskor oldódnak fel (S17)
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  contributors: uuid('contributors').array().notNull().default(sql`'{}'::uuid[]`),  // D29
  message: text('message'),                         // mindig opcionális (D45)
  restoredFromRevisionId: uuid('restored_from_revision_id'),   // FK nélkül: a forrás-revízió a retencióval törlődhet (S20)
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('document_revisions_doc_idx').on(t.documentId, t.createdAt),
  unique('document_revisions_doc_id_uq').on(t.documentId, t.id),   // a kompozit FK-k célja (D51, S22)
]);

// ── document_collab_state ── Yjs-állapot (D29), futásidejű ───────────────────
export const documentCollabState = pgTable('document_collab_state', {
  documentId: uuid('document_id').primaryKey().references(() => documents.id, { onDelete: 'restrict' }),
  state: bytea('state').notNull(),
  pendingContributors: uuid('pending_contributors').array().notNull().default(sql`'{}'::uuid[]`),  // D51: az utolsó checkpoint óta szerkesztők (újraindítást túléli); checkpointkor a revízió contributors-ába kerül és kiürül
  lastEditAt: ts('last_edit_at').notNull().defaultNow(),   // D51: tétlenségi checkpoint (10 perc) és „utolsó szerkesztő kilépett” újraindítás után is eldönthető
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ── change_requests ── review-kérés (D45) ────────────────────────────────────
// A base/proposed revízió-hivatkozás kompozit FK (document_id, revision_id) a 3. szakaszban (S22).
export const changeRequests = pgTable('change_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  kind: changeKind('kind').notNull(),
  baseRevisionId: uuid('base_revision_id'),         // NULL: új dokumentum (create)
  proposedRevisionId: uuid('proposed_revision_id'), // csak pending/approved kérésnél kötelező; delete és unarchive esetén mindig NULL; elutasított/visszavont kérésnél a retenció NULL-ra állíthatja (D51 h)
  proposedReviewDueAt: ts('proposed_review_due_at'),// D51 f: beküldéskor kötelező (12 hónapra előtöltött) create/update/metadata/restore esetén; delete/unarchive: NULL
  initiatorId: uuid('initiator_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  message: text('message'),
  state: changeState('state').notNull().default('pending'),
  iteration: integer('iteration'),                  // D51: jóváhagyáskor kitöltve (a dokumentum új iteration-je); a revíziólista vN-je ebből jön
  createdAt: ts('created_at').notNull().defaultNow(),
  decidedAt: ts('decided_at'),
}, (t) => [
  index('change_requests_doc_idx').on(t.documentId, t.createdAt),
  index('change_requests_initiator_idx').on(t.initiatorId, t.state),
  index('change_requests_proposed_rev_idx').on(t.proposedRevisionId).where(sql`${t.proposedRevisionId} IS NOT NULL`),  // D51: Jóváhagyott-jelölés join, FK-ellenőrzés
  index('change_requests_base_rev_idx').on(t.baseRevisionId).where(sql`${t.baseRevisionId} IS NOT NULL`),             // D51
  check('cr_proposal_rules', sql`(
    (${t.kind} IN ('delete','unarchive') AND ${t.proposedRevisionId} IS NULL)
    OR (${t.kind} NOT IN ('delete','unarchive') AND (${t.state} NOT IN ('pending','approved') OR ${t.proposedRevisionId} IS NOT NULL))
  )`),                                              // D51 h (a korábbi cr_delete_has_no_proposal helyett)
  check('cr_due_rules', sql`(${t.kind} IN ('delete','unarchive')) = (${t.proposedReviewDueAt} IS NULL)`),               // D51 f
  check('cr_state_fields', sql`(${t.state} = 'pending') = (${t.decidedAt} IS NULL) AND (${t.state} = 'approved') = (${t.iteration} IS NOT NULL)`),  // D51
]);

// ── change_request_reviewers ── a review-er „helyek” (D45, D51 b) ─────────────
// Helyettesítő kulcs: ugyanaz a személy később újra megjelölhető (csere, kiesés után).
// Aktív sor: ended_at IS NULL. A csere, a kiesés (színtérből/allowlistről) és a kérés lezárása (az el nem döntött sorok
// 'closed' jelölést kapnak, így a részleges index nem hízik) a sort lezárja, a sor megmarad.
export const changeRequestReviewers = pgTable('change_request_reviewers', {
  id: uuid('id').primaryKey().defaultRandom(),
  changeRequestId: uuid('change_request_id').notNull().references(() => changeRequests.id, { onDelete: 'restrict' }),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  decision: reviewDecision('decision'),             // NULL = függő
  reason: text('reason'),
  decidedAt: ts('decided_at'),
  assignedAt: ts('assigned_at').notNull().defaultNow(),
  endedAt: ts('ended_at'),                          // D51: replaced (csere), removed (kiesés), closed (a kérés lezárult)
  endReason: reviewerEnd('end_reason'),
}, (t) => [
  index('crr_change_request_idx').on(t.changeRequestId),
  index('crr_reviewer_pending_idx').on(t.reviewerId).where(sql`${t.decision} IS NULL AND ${t.endedAt} IS NULL`),
  // az „aktív review-er egyedisége” részleges egyedi index a 0003-ban
  check('crr_reject_needs_reason', sql`${t.decision} IS DISTINCT FROM 'rejected' OR (${t.reason} IS NOT NULL AND btrim(${t.reason}) <> '')`),
  check('crr_decision_decided_at', sql`(${t.decision} IS NULL) = (${t.decidedAt} IS NULL)`),
  check('crr_end_consistent', sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`),
]);

// ── tags, document_tags ── globális címkék (D34) ─────────────────────────────
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),   // kisbetű, ékezet nélkül, szóköz-normalizált (az app számolja)
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('tags_normalized_uq').on(t.normalizedName)]);

// Fizikailag törölhető (D51 j): a címketörténet a revízió-pillanatképben él. A tag_text triggerrel követi (0001).
export const documentTags = pgTable('document_tags', {
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'restrict' }),
}, (t) => [
  primaryKey({ columns: [t.documentId, t.tagId] }),
  index('document_tags_tag_idx').on(t.tagId),
]);

// ── document_links ── típusos kapcsolatok (D39, D44) ─────────────────────────
// A document_id-ra/cél-id-ra az indexek teljesek (nem részlegesek): a soft-deleted sorokat is érintő FK-ellenőrzést (retenció) is ki kell szolgálniuk.
export const documentLinks = pgTable('document_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromId: uuid('from_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  toId: uuid('to_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  type: linkType('type').notNull(),
  anchorText: text('anchor_text'),                  // linkenként egy kapcsolat (V54)
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
}, (t) => [
  index('document_links_from_idx').on(t.fromId),
  index('document_links_to_idx').on(t.toId),
  check('document_links_no_self', sql`${t.fromId} <> ${t.toId}`),
]);

// ── favorites ── privát kedvencek (D18); fizikailag törölhető (D51 j) ────────
export const favorites = pgTable('favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.documentId] })]);

// ── subscriptions ── követés, a kedvenctől független (D35, D49); fizikailag törölhető (D51 j) ──
export const subscriptions = pgTable('subscriptions', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.documentId] }),
  index('subscriptions_document_idx').on(t.documentId),   // D51: címzett-keresés minden eseménynél
]);

// ── events ── auditnyom, append-only (D6, D20, D48) ──────────────────────────
// A dokumentum-, színtér- és kérés-hivatkozás FK nélküli uuid (D51 h, S12): az esemény (5 év) túléli a dokumentumot (2 év);
// a törölt dokumentumra mutató esemény a felületen „törölt dokumentum”. Dokumentum-eseménynél a space_id is kitöltendő (CHECK).
export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),                     // nyílt halmaz → text (S1)
  spaceId: uuid('space_id'),                        // színtér-szintű audit (D43); nincs FK
  documentId: uuid('document_id'),                  // nincs FK
  changeRequestId: uuid('change_request_id'),       // nincs FK
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),   // D51 d: csak a rendszer-eseménytípusoknál lehet NULL
  details: jsonb('details'),                        // nem tartalmazhat nevet vagy e-mailt (D48); a megjelenítő névfeloldás olvasáskor
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('events_document_idx').on(t.documentId, t.createdAt),
  index('events_space_idx').on(t.spaceId, t.createdAt),
  index('events_actor_idx').on(t.actorId, t.createdAt).where(sql`${t.actorId} IS NOT NULL`),   // D51: GET /events actorId szűrő
  index('events_created_brin').using('brin', t.createdAt),     // D51: retenció és időablak; append-only, korrelált → BRIN (az events_type_idx megszűnt)
  check('events_actor_required', sql`${t.actorId} IS NOT NULL OR ${t.type} IN (
    'review_due_soon','review_due','review_reminder','review_stalled',
    'allowlist_added','allowlist_removed','user_pseudonymized','retention_purge')`),   // D51 d: új rendszer-típus = migráció
  check('events_document_has_space', sql`${t.documentId} IS NULL OR ${t.spaceId} IS NOT NULL`),   // D51
]);

// ── comments ── kommentfolyam (D20, D35) ─────────────────────────────────────
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  content: text('content').notNull(),               // @-említés formátuma nyitott (4. szakasz vége)
  createdAt: ts('created_at').notNull().defaultNow(),
  editedAt: ts('edited_at'),
  deletedAt: ts('deleted_at'),                      // 90 nap után végleges törlés (D48)
}, (t) => [
  index('comments_document_idx').on(t.documentId, t.createdAt),
  index('comments_deleted_idx').on(t.deletedAt).where(sql`${t.deletedAt} IS NOT NULL`),   // D51: retenciós keresés
]);

// ── notifications ── értesítés (harang, említés, e-mail-sor; D35, D46) ───────
// A dashboard review- és kérés-blokkjai ÉLŐ lekérdezések (aktív change_request_reviewers sorok, change_requests, documents.review_due_at,
// membership_requests, space_requests), nem az értesítésekből épülnek (D51); az értesítés a harang, az @említés és az e-mail forrása.
export const notifications = pgTable('notifications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  eventId: bigint('event_id', { mode: 'number' }).notNull().references(() => events.id, { onDelete: 'restrict' }),
  category: text('category').notNull(),             // zárt halmaz (CHECK, D35/D39/D46 címzettjei)
  readAt: ts('read_at'),
  emailDue: boolean('email_due').notNull().default(false),   // D51: az app jelzi, ha e-mail (azonnali vagy napi összefoglaló) is kell
  emailedAt: ts('emailed_at'),                      // azonnali levél vagy napi összefoglaló (D46)
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('notifications_user_unread_idx').on(t.userId, t.createdAt).where(sql`${t.readAt} IS NULL`),
  index('notifications_digest_idx').on(t.createdAt).where(sql`${t.emailDue} AND ${t.emailedAt} IS NULL`),   // D51
  index('notifications_event_idx').on(t.eventId),   // D51: events retenció FK-ellenőrzése
  index('notifications_created_brin').using('brin', t.createdAt),   // D51: 90 napos retenció
  // Kategóriák és címzettjeik (D35, D39, D46, D51): review_request (megjelölt review-er), review_stalled (review-er és indítványozó, 3 munkanap),
  // reviewer_vacated (indítványozó és Színtérgazda: kieső review-er, pótlás kell), own_request (indítványozó: döntés, végeredmény),
  // changes_requested (tulajdonos, indítványozó), review_due (tulajdonos, közreműködők), mention, comment (saját vagy követett dokumentum),
  // followed_change (követett dokumentum jóváhagyott változása), link_replaced (cél tulajdonosa, D39), link_removed_by_target (forrás tulajdonosa, V50),
  // member_added (self_assigned: nincs értesítés), membership_request (Színtérgazda), membership_decision (kérő),
  // space_request (Rendszeradmin), space_request_decision (kérő).
  check('notifications_category_ck', sql`${t.category} IN (
    'review_request','review_stalled','reviewer_vacated','own_request','changes_requested','review_due',
    'mention','comment','followed_change','link_replaced','link_removed_by_target','member_added',
    'membership_request','membership_decision','space_request','space_request_decision')`),
]);
```

## 2. Eseménytípusok (a `type` mező értékkészlete, app-szinten kényszerítve)

| Csoport | Típusok |
|---|---|
| Dokumentum | `created`, `edited` (checkpoint, `contributors`-szal), `renamed`, `duplicated_from` (mindkét oldalon), `imported_from` (D47, 2. ütem), `archived`, `unarchived` (D51 g), `restored` (régi revízióra visszaállítás, D51 g), `edit_started` (Jóváhagyott → Piszkozat, D51 c), `draft_discarded` (D51), `owner_changed` (ok: `handover` \| `admin_handover`) |
| Review (D45) | `review_requested`, `review_approved`, `review_rejected` (indoklással, kommentként vetítve), `review_withdrawn`, `reviewer_replaced`, `reviewer_removed` (D51 b), `review_stalled` (rendszer, D49), `change_approved`, `change_rejected` |
| Felülvizsgálat (D33) | `review_due_set`, `review_due_soon` (rendszer), `review_due` (rendszer), `review_reminder` (rendszer), `review_confirmed` |
| Kapcsolat (D39) | `link_added`, `link_removed`, `link_removed_by_target` |
| Komment (D20) | `comment_created`, `comment_edited` (details: korábbi tartalom), `comment_deleted` |
| Címke és fajta (D34) | `tag_created`, `kind_created` (D51) |
| Színtér és szerep (D30, D43, D44) | `space_requested`, `space_request_decided`, `space_created`, `space_updated` (D51: leírás, szín, név, típus), `space_closed`, `space_manager_assigned`, `member_added` (`self_assigned` jelzővel), `member_removed`, `role_changed`, `membership_requested`, `membership_request_decided` |
| Rendszer (D43, D48) | `system_admin_granted`, `system_admin_revoked`, `allowlist_added` (rendszer, ha konfigból), `allowlist_removed` (rendszer, ha konfigból), `user_pseudonymized` (rendszer), `retention_purge` (rendszer; összesítő, tételek nélkül) |

**Aktor nélküli (rendszer) típusok (D51 d):** `review_due_soon`, `review_due`, `review_reminder`, `review_stalled`, `allowlist_added`, `allowlist_removed`, `user_pseudonymized`, `retention_purge` - csak ezeknél lehet az `events.actor_id` NULL (CHECK `events_actor_required`); a felület „Rendszer”-ként mutatja. Az `allowlist_*` típusnál az aktor akkor is kitöltendő, ha a Rendszeradmin végzi (2. ütem). Az idle-checkpoint `edited` eseményének aktora az utolsó szerkesztő.

**Nem naplózott műveletek (kimondva, D51):** kedvenc, követés, egyéni színtér-szín, értesítés olvasottra jelölése, és minden olvasás (D18). Minden más mutáló művelet eseményt ír.

A lista a kódban egyetlen TypeScript union típusként él; új típus = kódmódosítás, nem DB-migráció (kivétel az aktor nélküli típusok listája, a `events_actor_required` CHECK miatt). A korábbi `status_changed`, `category_*`, `reindex_triggered` és `lock_expired` megszűnt.

## 3. Kézi SQL-migrációk (Drizzle custom migration, D25 kikötés)

```sql
-- 0001_search_infrastructure.sql  (D4, D36, D49; D51)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- TODO (WP6 méretkorlát): ALTER TABLE documents ADD CONSTRAINT documents_content_len CHECK (length(content) <= N);
-- Az N a WP6 dokumentált méretkorlátjából jön (a tsvector 1 MB-os korlátja alatt); itt szándékosan nincs szám.

-- Súlyozás: cím (A) > tartalom (B) > címkék + fajta (C).
-- A generált oszlop csak a saját sorát olvashatja, ezért a címkék a denormalizált tag_text-ből jönnek (S9).
ALTER TABLE documents
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('hungarian', coalesce(title, '')),   'A') ||
    setweight(to_tsvector('hungarian', coalesce(content, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(tag_text, '') || ' ' || coalesce(kind, '')), 'C')
  ) STORED;

CREATE INDEX documents_search_vector_idx ON documents USING GIN (search_vector);
CREATE INDEX documents_title_trgm_idx    ON documents USING GIN (title gin_trgm_ops);           -- duplikátum-figyelmeztetés: csak cím (D49)
CREATE INDEX tags_normalized_trgm_idx    ON tags      USING GIN (normalized_name gin_trgm_ops); -- címke-felajánlás (D34)
-- A korábbi documents_content_trgm_idx megszűnt: a tartalom nem kerül trigram-összevetésre (D49).

-- (D51, S9) A tag_text-et a document_tags triggere tartja karban, nem az alkalmazás.
-- Utasításszintű, átmeneti táblás trigger: egy INSERT/DELETE utasítás dokumentumonként egyetlen UPDATE-et ad,
-- és a változatlan tag_text-et nem írja újra (a generált search_vector újraszámítása drága).
CREATE OR REPLACE FUNCTION document_tag_text(p_document_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(t.name, ' ' ORDER BY t.name), '')
    FROM document_tags dt
    JOIN tags t ON t.id = dt.tag_id
   WHERE dt.document_id = p_document_id
$$;

CREATE OR REPLACE FUNCTION document_tags_sync_after_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE documents d
     SET tag_text = x.txt
    FROM (SELECT n.document_id, document_tag_text(n.document_id) AS txt
            FROM (SELECT DISTINCT document_id FROM new_rows) n) x
   WHERE d.id = x.document_id
     AND d.tag_text IS DISTINCT FROM x.txt;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION document_tags_sync_after_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE documents d
     SET tag_text = x.txt
    FROM (SELECT o.document_id, document_tag_text(o.document_id) AS txt
            FROM (SELECT DISTINCT document_id FROM old_rows) o) x
   WHERE d.id = x.document_id
     AND d.tag_text IS DISTINCT FROM x.txt;
  RETURN NULL;
END;
$$;

CREATE TRIGGER document_tags_tag_text_ins
  AFTER INSERT ON document_tags
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION document_tags_sync_after_insert();

CREATE TRIGGER document_tags_tag_text_del
  AFTER DELETE ON document_tags
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION document_tags_sync_after_delete();
-- A címke neve nem változik (nincs átnevezés, V29), ezért a tags táblán nincs trigger.
```

```sql
-- 0002_append_only.sql  (S6; D51)
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  -- Egyetlen kivétel: a retenciós folyamat (D48) DELETE-je. A retenciós login-szerepkör a tranzakcióban
  -- kifejezetten SET LOCAL ROLE taltos_retention-t hajt végre; így a törlés tudatos, nevesített lépés.
  IF TG_OP = 'DELETE' AND current_user = 'taltos_retention' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% append-only: % nem megengedett', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER document_revisions_append_only
  BEFORE UPDATE OR DELETE ON document_revisions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- (D51) A TRUNCATE a sor-triggert megkerüli: külön utasításszintű védelem.
CREATE OR REPLACE FUNCTION forbid_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% append-only: TRUNCATE nem megengedett', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

CREATE TRIGGER document_revisions_no_truncate
  BEFORE TRUNCATE ON document_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
-- Következmény a tesztekre: teszt-adatbázis újraépítéssel (template DB / séma-eldobás) takarítható, TRUNCATE-tel nem.
```

```sql
-- 0003_review_invariants.sql  (D45, S7; D51)

-- (D51, S22) Revízió-hivatkozások: kompozit FK, így a hivatkozott revízió mindig ugyanahhoz a dokumentumhoz tartozik.
-- A cél a document_revisions UNIQUE (document_id, id) megszorítása (a TS-sémában). MATCH SIMPLE: NULL hivatkozásnál nincs ellenőrzés.
ALTER TABLE documents
  ADD CONSTRAINT documents_approved_revision_fk
  FOREIGN KEY (id, approved_revision_id) REFERENCES document_revisions (document_id, id) ON DELETE RESTRICT;

ALTER TABLE change_requests
  ADD CONSTRAINT change_requests_base_revision_fk
  FOREIGN KEY (document_id, base_revision_id) REFERENCES document_revisions (document_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT change_requests_proposed_revision_fk
  FOREIGN KEY (document_id, proposed_revision_id) REFERENCES document_revisions (document_id, id) ON DELETE RESTRICT;

-- Dokumentumonként legfeljebb egy függő kérés
CREATE UNIQUE INDEX change_requests_one_pending_uq
  ON change_requests (document_id) WHERE state = 'pending';

-- (D51) Dokumentumonként az iteration egyedi (a jóváhagyott kérések sorszáma)
CREATE UNIQUE INDEX change_requests_iteration_uq
  ON change_requests (document_id, iteration) WHERE iteration IS NOT NULL;

-- (D51 b) Egy aktív review-er-hely személyenként; a korábban lezárt (cserélt, kiesett) személy újra megjelölhető
CREATE UNIQUE INDEX crr_active_reviewer_uq
  ON change_request_reviewers (change_request_id, reviewer_id) WHERE ended_at IS NULL;

-- A review-er nem lehet az indítványozó
CREATE OR REPLACE FUNCTION reviewer_not_initiator() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM change_requests
             WHERE id = NEW.change_request_id AND initiator_id = NEW.reviewer_id) THEN
    RAISE EXCEPTION 'reviewer_is_initiator';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crr_not_initiator
  BEFORE INSERT ON change_request_reviewers
  FOR EACH ROW EXECUTE FUNCTION reviewer_not_initiator();

-- (D51 b) Legfeljebb két aktív review-er kérésenként — a tranzakció végén ellenőrizve
-- (csere: az új sor beszúrása és a régi lezárása egy tranzakcióban, átmenetileg három aktív sorral).
CREATE OR REPLACE FUNCTION crr_at_most_two() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM change_request_reviewers
   WHERE change_request_id = NEW.change_request_id AND ended_at IS NULL;
  IF n > 2 THEN RAISE EXCEPTION 'too_many_reviewers'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER crr_at_most_two
  AFTER INSERT OR UPDATE ON change_request_reviewers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION crr_at_most_two();

-- (D51 b) Beküldéskor pontosan két aktív review-er: a kérés létrehozó tranzakciója végén ellenőrizve.
-- Később (kiesés után) lehet egy aktív hely: a kérés addig nem dönthető el (lásd change_requests_guard).
CREATE OR REPLACE FUNCTION cr_exactly_two_at_submission() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM change_request_reviewers
   WHERE change_request_id = NEW.id AND ended_at IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'exactly_two_reviewers_required'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER cr_exactly_two_at_submission
  AFTER INSERT ON change_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cr_exactly_two_at_submission();

-- (D51) Lezárt kérés megváltoztathatatlan; a függő kérés azonosító mezői is. Jóváhagyáshoz két aktív jóváhagyó döntés kell.
-- Egyetlen kivétel: elutasított/visszavont kérés javasolt revíziójának lecsatolása (retenció, D51 h).
CREATE OR REPLACE FUNCTION change_requests_guard() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  IF OLD.state <> 'pending' THEN
    IF OLD.state IN ('rejected', 'withdrawn')
       AND NEW.proposed_revision_id IS NULL
       AND (to_jsonb(NEW) - 'proposed_revision_id') = (to_jsonb(OLD) - 'proposed_revision_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'change_request_closed';
  END IF;

  IF NEW.document_id <> OLD.document_id
     OR NEW.kind <> OLD.kind
     OR NEW.initiator_id <> OLD.initiator_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.base_revision_id IS DISTINCT FROM OLD.base_revision_id
     OR NEW.proposed_revision_id IS DISTINCT FROM OLD.proposed_revision_id
     OR NEW.proposed_review_due_at IS DISTINCT FROM OLD.proposed_review_due_at THEN
    RAISE EXCEPTION 'change_request_immutable_fields';
  END IF;

  IF NEW.state = 'approved' THEN
    SELECT count(*) INTO n
      FROM change_request_reviewers
     WHERE change_request_id = NEW.id AND ended_at IS NULL AND decision = 'approved';
    IF n <> 2 THEN RAISE EXCEPTION 'two_approvals_required'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER change_requests_guard
  BEFORE UPDATE ON change_requests
  FOR EACH ROW EXECUTE FUNCTION change_requests_guard();

-- (D51) Review-ra várás alatt az élő tartalom és metaadat befagyott (D45). Az állapotváltással járó
-- írás (jóváhagyás, visszavonás, restore-alkalmazás) nem érintett: a WHEN csak a pending → pending frissítésre igaz.
CREATE OR REPLACE FUNCTION documents_frozen_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.tag_text IS DISTINCT FROM OLD.tag_text THEN
    RAISE EXCEPTION 'document_frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_frozen_while_pending
  BEFORE UPDATE ON documents
  FOR EACH ROW
  WHEN (OLD.review_state = 'pending' AND NEW.review_state = 'pending')
  EXECUTE FUNCTION documents_frozen_guard();
```

```sql
-- 0004_partial_indexes.sql  (D51 indexterv)
-- Aktív tagság gyors ellenőrzése (policy-függvény, láthatósági szűrés — D43, D44); a role a covering miatt kerül bele,
-- így a can() szerep-ellenőrzése index-only. Ez váltja ki a korábbi space_members_user_idx-et.
CREATE INDEX space_members_active_idx
  ON space_members (user_id, space_id) INCLUDE (role) WHERE removed_at IS NULL;

-- Az Általános színtérből pontosan egy van (D43)
CREATE UNIQUE INDEX spaces_one_general_uq ON spaces (type) WHERE type = 'general';

-- Egy felhasználónak egy színtérbe egyszerre egy függő felvételi kérése lehet (D44)
CREATE UNIQUE INDEX membership_requests_one_pending_uq
  ON membership_requests (space_id, user_id) WHERE state = 'pending';
```

**Szerepkörök létrehozása (D51, S23):** a `0005` előtt a Postgres init-szkriptje (`taltos-app/db/initdb/10-roles.sh`, az üres adatkönyvtárnál egyszer, superuserként) előre létrehozza a három NOLOGIN csoportot és a két jelszavas login-szerepkört (`taltos_migrator` a `taltos_owner` tagja, `taltos_backend` a `taltos_app` tagja; a jelszavak Compose secretek, `\getenv`-vel jutnak a psql-hez), elveszi a PUBLIC DB-jogait (`REVOKE ALL ON DATABASE … FROM PUBLIC`, majd `GRANT CONNECT` a csoportoknak és `GRANT CREATE` a `taltos_owner`-nek a `drizzle` séma és a `pg_trgm` miatt), és a `public` séma tulajdonosává a `taltos_owner`-t teszi. A migrátor (`apps/backend/src/db/migrator.ts`) a kapcsolat elején `SET ROLE taltos_owner`-t hajt végre, így minden objektum tulajdonosa a `taltos_owner`; ezért **`CREATEROLE` nem kell**, a 0005 `IF NOT EXISTS` blokkja csak védőháló más telepítésekre. Az integrációs tesztek (`test-db.ts`) ugyanezt a telepítést tükrözik.

```sh
#!/bin/sh
# Egyszeri Postgres-inicializálás (B4 S23, D51). A postgres-konténer ÜRES adatkönyvtárnál futtatja,
# superuserként; meglévő adatkönyvtárnál nem fut le újra. Itt jönnek létre:
#   - a NOLOGIN csoportszerepkörök (taltos_owner, taltos_app, taltos_retention): a migrátor a kapcsolat elején
#     SET ROLE taltos_owner-t hajt végre, ezért a csoportoknak a migráció ELŐTT létezniük kell;
#   - a két jelszavas login-szerepkör: taltos_migrator (a taltos_owner tagja) és taltos_backend (a taltos_app tagja);
#   - a séma-tulajdonjog és a DB-szintű jogok: a taltos_owner hozhat létre sémát, bővítményt (a pg_trgm megbízható)
#     és objektumot.
# A jogosultságok táblánkénti része a 0005 migráció. A jelszavak a Compose secretekből (fájl) jönnek (D13),
# környezeti változón át adjuk a psql-nek (\getenv), így nem kerülnek a parancssorba.
# Alrétegben fut, hogy a `set -eu` ne szivárogjon a postgres entrypoint shelljébe, ha az sourcolja a szkriptet.
(
  set -eu
  MIGRATOR_PW="$(tr -d '\r\n' < "${DB_MIGRATOR_PASSWORD_FILE:?hiányzik a DB_MIGRATOR_PASSWORD_FILE}")"
  APP_PW="$(tr -d '\r\n' < "${DB_APP_PASSWORD_FILE:?hiányzik a DB_APP_PASSWORD_FILE}")"
  # Üres jelszóval nem hozunk létre login-szerepkört (az érték soha nem kerül a kimenetre).
  [ -n "$MIGRATOR_PW" ] || { echo "HIBA: a migrátor jelszava (DB_MIGRATOR_PASSWORD_FILE) üres" >&2; exit 1; }
  [ -n "$APP_PW" ] || { echo "HIBA: az alkalmazás jelszava (DB_APP_PASSWORD_FILE) üres" >&2; exit 1; }
  export MIGRATOR_PW APP_PW

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv migrator_pw MIGRATOR_PW
\getenv app_pw APP_PW

-- A jelszavas CREATE ROLE utasítások ne kerüljenek a szerver naplójába (sem utasításként, sem hibaüzenet részeként).
-- Superuser a munkamenetben beállíthatja; a beállítás csak erre az init-munkamenetre érvényes.
SET log_statement = 'none';
SET log_min_error_statement = 'panic';

CREATE ROLE taltos_owner NOLOGIN;
CREATE ROLE taltos_app NOLOGIN;
CREATE ROLE taltos_retention NOLOGIN;
CREATE ROLE taltos_migrator LOGIN PASSWORD :'migrator_pw' IN ROLE taltos_owner;
CREATE ROLE taltos_backend LOGIN PASSWORD :'app_pw' IN ROLE taltos_app;

-- Csak a megnevezett szerepkörök csatlakozhatnak (a PUBLIC alapértelmezett CONNECT/TEMP joga elvéve).
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO taltos_owner, taltos_app, taltos_retention', current_database()) \gexec
-- A migráció sémát (drizzle) és bővítményt (pg_trgm) hoz létre.
SELECT format('GRANT CREATE ON DATABASE %I TO taltos_owner', current_database()) \gexec

ALTER SCHEMA public OWNER TO taltos_owner;
SQL
)
```

```sql
-- 0005_roles_and_grants.sql  (S23, D51; a retenciós jogok a WP33-ban finomítandók)
-- Három NOLOGIN csoportszerepkör: taltos_owner (séma-tulajdonos), taltos_app (alkalmazás), taltos_retention (2. ütem).
-- A jelszavas LOGIN-szerepköröket (taltos_migrator, taltos_backend) NEM ez a migráció hozza létre: azokat a Postgres
-- init-szkriptje (db/initdb) a Compose secretekből (D13). Az init-szkript a csoportszerepköröket is előre létrehozza, mert
-- a migrátor a kapcsolat elején SET ROLE taltos_owner-t hajt végre; az alábbi blokk csak védőháló más telepítésekre
-- (hiányzó szerepkör létrehozásához CREATEROLE jog kell). A migrátor tagja a taltos_owner-nek, a backend a taltos_app-nak.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taltos_owner')     THEN CREATE ROLE taltos_owner NOLOGIN;     END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taltos_app')       THEN CREATE ROLE taltos_app NOLOGIN;       END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taltos_retention') THEN CREATE ROLE taltos_retention NOLOGIN; END IF;
END $$;

-- A táblák tulajdonosa a taltos_owner (az app nem tulajdonos: nem tilthatja le a triggereket, nem TRUNCATE-elhet).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO taltos_owner', r.tablename);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO taltos_app, taltos_retention;

-- Alkalmazás: olvasás, beszúrás, módosítás; fizikai törlés csak a D51 (j) táblákon; TRUNCATE sehol.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO taltos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taltos_app, taltos_retention;
GRANT DELETE ON favorites, subscriptions, user_space_colors, document_tags TO taltos_app;
-- Az append-only táblákon az UPDATE-jog is elvéve (a trigger mellett második védvonal).
REVOKE UPDATE ON events, document_revisions FROM taltos_app;

-- Későbbi táblákra ugyanez az alap (új append-only táblánál a jogot kézzel kell szűkíteni).
ALTER DEFAULT PRIVILEGES FOR ROLE taltos_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO taltos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE taltos_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO taltos_app, taltos_retention;

-- Retenciós folyamat (használat: 2. ütem, WP33). A login-szerepkör tagja, és tranzakciónként SET LOCAL ROLE taltos_retention-t hajt végre
-- (a forbid_mutation current_user-t ellenőriz). Pszeudonimizálás: csak a személyes oszlopok.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO taltos_retention;
GRANT INSERT ON events TO taltos_retention;                      -- retention_purge, user_pseudonymized
GRANT DELETE ON events, document_revisions, documents, document_collab_state, change_requests,
                change_request_reviewers, comments, notifications, document_links,
                favorites, subscriptions, document_tags, sessions TO taltos_retention;
GRANT UPDATE (tag_text) ON documents TO taltos_retention;                    -- a document_tags törlés triggere frissíti (B4 S9)
GRANT UPDATE (proposed_revision_id) ON change_requests TO taltos_retention;   -- javasolt revízió lecsatolása (D51 h)
GRANT UPDATE (oidc_sub, email, display_name, avatar_url, pseudonymized_at) ON users TO taltos_retention;
```

**Rögzített `search_path` a függvényeken (D51, S26):** a 0001-0003 trigger- és guard-függvényei a hívó munkamenet `search_path`-ját öröklik, így egy másik sémában előre létrehozott, azonos nevű objektum eltéríthetné őket. A 0006 migráció `ALTER FUNCTION … SET search_path = pg_catalog, public`-kel rögzíti mindegyiknek (külön migráció, mert a 0001-0005 már alkalmazva van a dev és CI előzményekben; az új függvényeket innentől eleve `SET search_path` záradékkal kell létrehozni).

```sql
-- 0006_function_search_path.sql  (S26, D51; appsec F-9)
-- A 0001-0003 trigger- és guard-függvényei rögzített search_path-szal futnak: a hívó munkamenet search_path-ja
-- (pl. egy előre létrehozott, azonos nevű objektum egy másik sémában) nem módosíthatja, mely táblát és operátort oldják fel.
-- A 0001-0005 már alkalmazva van a dev/CI előzményekben, ezért külön migráció (ALTER FUNCTION), nem szerkesztés.
-- A függvények csak a public séma tábláit és a pg_catalog beépítettjeit használják; az átmeneti táblákat (new_rows, old_rows) névvel oldja fel a trigger.
ALTER FUNCTION document_tag_text(uuid)                SET search_path = pg_catalog, public;
ALTER FUNCTION document_tags_sync_after_insert()      SET search_path = pg_catalog, public;
ALTER FUNCTION document_tags_sync_after_delete()      SET search_path = pg_catalog, public;
ALTER FUNCTION forbid_mutation()                      SET search_path = pg_catalog, public;
ALTER FUNCTION forbid_truncate()                      SET search_path = pg_catalog, public;
ALTER FUNCTION reviewer_not_initiator()               SET search_path = pg_catalog, public;
ALTER FUNCTION crr_at_most_two()                      SET search_path = pg_catalog, public;
ALTER FUNCTION cr_exactly_two_at_submission()         SET search_path = pg_catalog, public;
ALTER FUNCTION change_requests_guard()                SET search_path = pg_catalog, public;
ALTER FUNCTION documents_frozen_guard()               SET search_path = pg_catalog, public;
```

## 4. Séma-szintű mikrodöntések és indoklásuk

| # | Döntés | Indoklás |
|---|---|---|
| S1 | Zárt halmazok Postgres **enum**ok (szerep, review-állapot, kapcsolattípus, review-er lezárás oka); `events.type` **text**; a `notifications.category` zárt halmaz **CHECK**-kel | Az enumok ritkán változnak, a DB-kényszer olcsó védőháló. Az eseménytípus nyílt, bővülő halmaz: text + TS-union, migráció nélkül. Az értesítés-kategória a dashboard és a címzett-szabályok zárt halmaza (D51). |
| S2 | A fajta-lista külön tábla (`document_kinds`), nem enum | A D34 szerint a Rendszeradminisztrátor bővíti: futásidejű adat, nem migráció. |
| S3 | Minden FK `RESTRICT`, kivéve az `events` naplóhivatkozásait (nincs FK, S12) | Soft delete világban (D20) fizikai törlés csak a retenciós folyamatból van, ott a törlési sorrend szándékos. A kompozit FK-k szintén `RESTRICT` (a `SET NULL` a `document_id`-t is nullázná). |
| S4 | E-mail-egyediség `lower(email)` egyedi indexszel; az allowlist e-mailje CHECK-kel kisbetűs | Egy extension-nel kevesebb; pszeudonimizáláskor NULL, ezért az index ütközés nélkül engedi. |
| S5 | `documents.review_state` gyorsítótár, a kérésekből származtatott | Az állapot-facet (D49) és a dashboard olcsó marad; a kéréssel azonos tranzakcióban frissül. DB-védelem: a `documents_approved_has_revision` CHECK és a befagyás-trigger; a gyorsítótár és a kérések egyezését ellenőrző SELECT (WP1 teszt) védi a drift ellen. |
| S6 | `events` és `document_revisions` append-only trigger (UPDATE/DELETE soronként, TRUNCATE utasításonként); a retenció külön DB-szerep (`taltos_retention`, `SET LOCAL ROLE`) | A 6. fejezet vállalt kockázata (az audit gyökere az alkalmazás) DB-szinten enyhül. A védelem csak akkor valódi, ha az app nem tulajdonos és nincs UPDATE/TRUNCATE joga (S23). |
| S7 | Az „egy függő kérés” és a review-er-invariánsok DB-kényszerek (D51 b): beküldéskor pontosan két aktív review-er (halasztott constraint trigger a `change_requests` INSERT-en), később legfeljebb kettő (halasztott constraint trigger a review-er sorokon); jóváhagyáshoz két aktív jóváhagyó döntés (guard trigger); az aktív review-er egyedi (részleges egyedi index); az indítványozó nem lehet review-er | Versenyhelyzetben (két egyidejű beküldés) a részleges egyedi index és a halasztott constraint trigger atomi; az app-ellenőrzés csak a jó hibaüzenetért van. A halasztott triggerek COMMIT-kor dobnak: a negatív tesztek commitolnak (vagy `SET CONSTRAINTS ALL IMMEDIATE`). Az „review-er tag-e” és a „nem azonos” hibakód (422) app-szintű. |
| S8 | Az „utolsó Színtérgazda”, a „legalább három tag” (beküldési előfeltétel, nem tagsági kényszer) és a „legalább egy Rendszeradmin” szabály **app-szinten**, `SELECT … FOR UPDATE`-tel; a zárolás a **szülő sorra** megy: a `spaces` sorra (színtér-szabályok), illetve az összes `system_admin` `users` sorra `ORDER BY id` (admin-szabály) | Több táblát érintő, üzleti hibakódot (409) adó szabályok; triggerben a hibaüzenet-minőség rosszabb. A szülő-sor zárolása nélkül két egyidejű eltávolítás átmenne, mert mindkettő látja a másik tagot. |
| S9 | A címkék denormalizálva a `documents.tag_text`-ben, **`document_tags` utasításszintű triggerrel** karbantartva (D51) | A generált oszlop nem olvashat más táblát; a trigger az app-hibát is kizárja, és dokumentumonként egy UPDATE-et ad. A `kind` kulcsa közvetlenül a vektorban van (azonos sor). |
| S10 | A revízió a metaadatot is tárolja (`title`, `metadata` JSONB) | A D45 a metaadat-változást is review-köteles változásnak tekinti; a diffhez a régi és az új metaadat kell. |
| S11 | Láthatósági szűrés (D44) **app-szinten**, egyetlen lekérdezés-építőben; RLS nem az MVP-ben | Az RLS erősebb, de session-változót igényel minden kapcsolaton (Drizzle és Hocuspocus közös pool). Az MVP-ben a lekérdezés-építő + végpontonkénti teszt; az RLS a második ütemben mérlegelendő. A builder alá tartozik a címke-darabszám és az értesítés is (az `events` nullable `document_id`/`space_id`-n át). |
| S12 | `membership_requests.via_document_id` és az `events` `space_id`/`document_id`/`change_request_id` oszlopa FK nélküli uuid (D51 h) | A kérő nem láthatja a dokumentumot (az azonosító csak a Színtérgazda kontextusa). Az esemény (5 év) túléli a dokumentumot (2 év), ezért FK nem védheti; a törölt dokumentumra mutató esemény „törölt dokumentum”. A hivatkozás-épséget az app és a tesztek védik; dokumentum-eseménynél a `space_id` kitöltése CHECK-kel kényszerített. |
| S13 | A Jóváhagyott állapotot (`approved_revision_id`, `iteration`, `deleted_at`) és a `review_state`-et kizárólag a `ReviewService` írja. Átmenetei: beküldés (→ pending), döntés és jóváhagyás/elutasítás (→ approved / changes_requested; `delete`: `deleted_at` beáll; `unarchive`: `deleted_at` NULL), visszavonás (→ draft), **Módosítás indítása: Jóváhagyott → Piszkozat, `edit_started` (D51 c)**; kivétel: soha be nem küldött piszkozat eldobása (nincs `change_requests` sora és Jóváhagyott revíziója; `deleted_at` beáll, `draft_discarded`). A `restore` jóváhagyásakor a pillanatkép visszaíródik az élő táblákba (S17) | A D45 kikényszerítése a szerviz-rétegben, egyetlen `ReviewService`-ben; a mátrixtesztek ezt is lefedik. A „Módosítás indítása” explicit lépés: addig a szerkesztő csak olvasható (D29, B5 `/collab`). |
| S14 | Munkamenet-tár: `sessions` tábla (D51 a) | Újraindítást túlél, a kijelentkezés és az allowlistről levétel azonnal visszavonja, nincs új infrastruktúra (D1). Az id a süti-token hash-e; a `last_seen_at` írása ritkított (percenként legfeljebb egyszer). Visszavonás = `expires_at` előrehozása (nincs fizikai DELETE az appnak). |
| S15 | A review-er hely helyettesítő kulcsú sor (`change_request_reviewers.id`); a csere, a kiesés és a lezárás `ended_at`/`end_reason` jelölés, a sor megmarad (D51 b) | Ugyanaz a személy csere vagy kiesés után újra megjelölhető; a kiesés a dokumentált folyamat része (Szerepkörök), nem hiba. Lezáráskor az el nem döntött sorok `closed` jelölést kapnak, így a függő-review részleges index nem hízik. |
| S16 | `events.actor_id` nullable, de csak a rendszer-eseménytípusoknál (CHECK, D51 d) | A cron (D33, D49), a konfigból seedelt allowlist és a retenció nem emberi aktor; ál-felhasználó (jelzők, választhatóság) nélkül. Új rendszer-típus = migráció (tudatos ár: a CHECK szigorúbb a puszta TS-uniónál). |
| S17 | Élő és Jóváhagyott metaadat (D51 e): az élő táblák a legutóbbi állapotot hordozzák; a Jóváhagyott nézet a `document_revisions` pillanatképéből jön. A `metadata` csak azonosítókat tartalmaz (`kind`, címke-id-k, kapcsolatok: cél-id, típus, anchor); címek és nevek olvasáskor, láthatósági szűréssel oldódnak fel. Visszaállításkor (`restore`) a pillanatkép egy tranzakcióban íródik vissza (`documents.title/kind/content`, `document_tags`, `document_links`, `tag_text`), és a Yjs-állapot újraépül | A D45 alapnézete a legutóbbi változat; az export, az MCP, a nyers letöltés és a vágólap a Jóváhagyottat adja. Az azonosító-alapú pillanatkép nem szivárogtat idegen színtér-címet (D44) és átnevezés-biztos. |
| S18 | Esedékesség (D51 f): a `change_requests.proposed_review_due_at` beküldéskor kötelező (12 hónapra előtöltött) `create`/`update`/`metadata`/`restore` esetén, `delete`/`unarchive` esetén NULL (CHECK); jóváhagyáskor kerül a `documents.review_due_at`-be | A két review-er ezzel együtt hagyja jóvá; az `unarchive` és a `delete` nem ad új esedékességet. |
| S19 | `unarchive` kérésfajta (D51 g): nincs javasolt revízió; jóváhagyáskor `deleted_at = NULL`, a legutóbbi Jóváhagyott revízió érvényes marad; esemény: `unarchived`. A `restore` csak régi revízióra visszaállítás | A korábbi `restore` kétféle jelentése a `proposed_revision_id` kényszerrel nem volt megvalósítható. |
| S20 | Retenció és hivatkozások (D51 h, i): a javasolt revízió csak pending/approved kérésnél kötelező; az elutasított/visszavont kérés javasolt revíziójának törlése előtt a retenció a kérésen NULL-ra állítja (a guard trigger ezt az egy módosítást engedi). A `restored_from_revision_id` FK nélküli | A `document_revisions` 1 éves törlése nem ütközik FK-val; a lezárt kérés megmarad (WP22 mérőszámok). A checkpoint-revíziók osztályozása az oszlopokon nincs (append-only), a retenció a kérés-hivatkozásokból és az `approved_revision_id`-ből vezeti le (5. szakasz). |
| S21 | Fizikai törlés kivételei (D51 j): `favorites`, `subscriptions`, `user_space_colors`, `document_tags`; az app DB-szerepe csak ezekre kap DELETE-jogot | Nincs auditértékük; a címketörténet a revízióban él. A `sessions` lejárt sorait a retenciós folyamat törli (2. ütem; a D51 j-ben nem szerepel, lásd Nyitott). |
| S22 | Kompozit FK-k `(document_id, revision_id)` az `approved_revision_id`, a `base_revision_id` és a `proposed_revision_id` hivatkozásra; `UNIQUE (document_id, id)` a revíziókon | A sima FK csak létezést ellenőriz: hibás app-kódnál másik színtér revíziója lehetne „hivatalos”, és a nyers letöltés kiszivárogtatná. Ár: egy plusz egyedi index a revíziókon. |
| S23 | DB-szerepek (init-szkript + 0005): `taltos_owner` (a séma és minden tábla tulajdonosa; a migrátor `SET ROLE`-lal váltja), `taltos_app` (DML, DELETE csak S21 táblákon, nincs TRUNCATE, nincs UPDATE az `events`/`document_revisions` táblán), `taltos_retention` (törlés, `SET LOCAL ROLE`; a `document_tags` törlési trigger az invoker nevében frissíti a `documents`-et, ezért `UPDATE (tag_text) ON documents` joga is van); NOLOGIN csoportszerepkörök, a jelszavas `taltos_migrator` és `taltos_backend` login-szerepkört az init-szkript hozza létre a secretekből; a PUBLIC DB-jogai elvéve | Az append-only és a „fizikai DELETE tilos” csak akkor érvényes, ha az app nem tulajdonos és nem superuser: a tulajdonos kikapcsolhatná a triggereket. Az init-szkript előre létrehozza a szerepköröket, így a migrátornak nem kell `CREATEROLE`. |
| S24 | `iteration` (D51): minden jóváhagyott kérés növeli a `documents.iteration`-t, és a `change_requests.iteration`-be kerül (a revíziólista „v1, v2 …” címkéje a Jóváhagyott kérés javasolt revíziójából jön); `delete` és `unarchive` is jóváhagyott változás, ezért a revíziók vN-je kihagyhat számot | Az append-only revíziók utólag nem címkézhetők; a sorszám a kérésen él. Értelmezés: a D45 „Jóváhagyott változások száma” minden fajtára érvényes. |
| S25 | Indexterv (D51): megszűnt a `documents_space_idx` (a `documents_space_slug_uq` előtagja), a `documents_review_state_idx` (4 érték), az `events_type_idx`, a `space_members_user_idx` (a részleges index váltja); új: `change_requests` revízió-indexek (részleges), `subscriptions(document_id)`, `events(actor_id, created_at)`, `notifications(event_id)`, BRIN az `events` és a `notifications` időoszlopán, részleges indexek a `review_due_at`-re és a törölt kommentekre. A `document_links` indexei teljesek maradnak | A retenció FK-ellenőrzései a soft-deleted sorokat is nézik, ezért a részleges link-index nem szolgálná ki őket. A `favorites(document_id)` szándékosan nincs: csak a (kötegelt) retenció használná. Néhány ezer dokumentumnál a többi index mérés nélkül nem indokolt. |
| S26 | A trigger- és guard-függvények rögzített `search_path = pg_catalog, public` mellett futnak (0006); az init-szkript a jelszavas utasítások előtt kikapcsolja az utasítás-naplózást és üres jelszóval nem hoz létre szerepkört | A hívó `search_path`-ja ne változtassa meg, mely táblát és operátort oldanak fel (S6, S7 védelmei erre épülnek); a szerepkör-jelszavak ne kerüljenek a szerver naplójába. Ár: a `SET` záradékos SQL-függvény nem inline-olható (itt csak triggerből hívott, elhanyagolható). |

**Nyitott (a megfelelő WP előtt) - nem eldöntött, itt nincs rögzítve:**
- **Yjs `generation` mező (WP6 előtt):** az `y-indexeddb` gyorsítótárú kliensek a szerveren újraépített Yjs-állapottal (backup-visszaállítás, `restore`) szöveget duplikálhatnak. Egy `document_collab_state.generation` és a Hocuspocus dokumentumnévbe építése megoldaná; a döntés nincs meg.
- **@említés formátuma (WP9 előtt):** a `@[név](user:uuid)` a nevet a komment szövegébe és a `comment_edited` részleteibe másolja (D48 ütközés); csak uuid-s forma esetén a név olvasáskor oldódna fel. Az `allowlist.email` kivétele is ide tartozik.
- **Címke- és fajtanevek, darabszámok láthatósága (WP5, WP11 előtt, D44):** a globális címkelista és a `tag_exists` 409 zárt színtérben használt címkét is felfedhet.
- **Legal hold tárolásának hatóköre (WP33 előtt):** nincs `retention_holds` tábla; nem eldöntött, hogy a dokumentum-hold az eseményeket, revíziókat és kommenteket is védi-e (B5 retenciós végpontjai második ütemesek).
- **Rendszeradmin által látható mezők (WP9, WP33 előtt):** az `events.details` és a retenciós előnézet cím- és komment-tartalmat adhat, a Rendszeradminnak tartalmi joga nincs (D43).
- **Az első Rendszeradmin forrása (WP2 előtt):** konfig-seed vagy első belépés; sehol nincs rögzítve.
- **V50 rendszer-revízió (WP21 előtt):** a cél általi `helyettesíti`-törlés rendszer-revíziója kap-e `approved_revision_id`-t/`iteration`-t/`change_requests` sort, és hogyan kerül a futó Yjs-piszkozatba.
- **Tulajdonos-átadás végpontja (WP2, WP4 előtt, B5):** a `owner_handover_required` feloldásához csak az admin-átadás létezik.
- **`sessions` lejárt sorainak törlése (WP2 előtt):** a D51 (j) kivétel-listája nem tartalmazza; a séma a retenciós folyamatra bízza (2. ütem), a tábla addig lassan nő.
- **Keresés (WP11 előtt):** a vektor a `kind` kulcsát (nem a magyar címkét) indexeli; a trigram-index csak a címre van, így a tartalomban elírt szó nem talál.
- **Duplikálás forrása (WP5 előtt):** az élő vagy a Jóváhagyott változat másolódik.
- **Körkörös RESTRICT FK-k a retenciónál (WP33 előtt):** a `documents.approved_revision_id` és a `document_revisions.document_id` kölcsönösen hivatkozik egymásra, ezért egy dokumentum és revízióinak törlése egyetlen utasításban (CTE-s `DELETE`) vagy halasztható (`DEFERRABLE`) FK-val oldható meg; a WP33 választ.
- **`crr_at_most_two` write-skew egy kiesett hellyel (WP8 előtt):** két párhuzamos tranzakció egyszerre pótolhatja a megüresedett helyet, és külön-külön látja a „legfeljebb kettő” invariánst teljesülni. Az alkalmazásnak a `change_requests` sort `SELECT … FOR UPDATE`-tel kell zárolnia a pótlás és a döntés előtt (WP8 versenyhelyzet-teszt).
- **A retenciós folyamat saját login-szerepköre (WP33 előtt):** nem a `taltos_backend`; külön login-szerepkör a `taltos_retention` csoport tagjaként `INHERIT FALSE, SET TRUE` tagsággal, így a jogai csak tudatos `SET LOCAL ROLE taltos_retention` után élnek (a `forbid_mutation` ezt az `current_user` ellenőrzéssel kényszeríti).

## 5. Mentés és retenció táblánként (D48, D51)

| Tábla | Mentés | Végleges törlés |
|---|---|---|
| `documents`, `document_revisions` (Jóváhagyott, vagy pending kérés javaslata) | elsődleges | revíziók: soha automatikusan. Dokumentum: archivált (`deleted_at` van, Jóváhagyott revízióval) 2 év után, a revízióival együtt; **eldobott piszkozat (`deleted_at` van, `approved_revision_id` NULL) a revízióival együtt 1 évvel az eldobás után (D51 i)** |
| `document_revisions` (elutasított vagy visszavont kérés javaslata) | elsődleges | 1 év után; előbb a kérésen `proposed_revision_id` NULL-ra áll (D51 h) |
| `document_revisions` (köztes checkpoint: se Jóváhagyott, se kérés javaslata) | elsődleges | **1 évvel azután, hogy egy újabb Jóváhagyott revízió meghaladta (D51 i)**; levezetés: nincs `change_requests.proposed_revision_id` hivatkozás, és a `change_requests.decided_at` szerinti következő jóváhagyás 1 évnél régebbi |
| `change_requests`, `change_request_reviewers` | elsődleges | a dokumentummal együtt |
| `comments` | elsődleges | törölt komment 90 nap után |
| `notifications` | elsődleges | 90 nap után |
| `events` | elsődleges | 5 év után (`taltos_retention` szerep); FK nélküli hivatkozások, a törölt dokumentumra mutató esemény „törölt dokumentum” (D51 h) |
| `users` | elsődleges | nem törlődik; kilépés után a retenciós idő végén pszeudonimizálódik (csak a személyes oszlopok) |
| `sessions` | elsődleges (nem mentendő érték) | lejárat után, a retenciós folyamatban (2. ütem; lásd Nyitott) |
| `spaces`, `space_members`, kérések, `tags`, `document_links`, `allowlist`, `document_kinds` | elsődleges | a hivatkozott dokumentummal vagy felhasználóval együtt |
| `favorites`, `subscriptions`, `user_space_colors`, `document_tags` | elsődleges | **az alkalmazásból is fizikailag törölhető (D51 j)**; a dokumentummal együtt is |
| `document_collab_state` | futásidejű; elvesztésekor a `documents.content`-ből újraépül (a `generation` kérdés nyitott, lásd 4. szakasz) | — |

Törlési sorrend a retenciónál: értesítések, esemény-hivatkozás nélküli kapcsoló sorok, kérések és review-er sorok, revíziók, dokumentum; az `events` külön, kor szerint. A `pg_dump` a teljes adatbázist menti (napi, 30 napos + 12 havi megőrzés, D48).

## 6. Második ütem: többformátumú tartalom (D42)

```sql
-- 0100_multiformat.sql  — csak a második ütemben futtatandó
ALTER TABLE documents
  ADD COLUMN format text NOT NULL DEFAULT 'markdown'
    CHECK (format IN ('markdown','html_report','skill_bundle','pdf','xlsx','md_file')),
  ADD COLUMN search_text text;   -- kinyert szöveg; a search_vector képlete bővül (lásd alább)

CREATE TABLE blobs (
  sha256     bytea  PRIMARY KEY,
  size_bytes bigint NOT NULL CHECK (size_bytes <= 25 * 1024 * 1024),
  mime_type  text   NOT NULL,
  data       bytea  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE blobs ALTER COLUMN data SET STORAGE EXTERNAL;

CREATE TABLE revision_files (
  revision_id uuid  NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
  path        text  NOT NULL,
  blob_sha256 bytea NOT NULL REFERENCES blobs(sha256) ON DELETE RESTRICT,
  PRIMARY KEY (revision_id, path)
);

CREATE TABLE blob_derivatives (
  blob_sha256 bytea NOT NULL REFERENCES blobs(sha256) ON DELETE RESTRICT,
  kind        text  NOT NULL,   -- 'text' | 'pages' | 'cells' | 'normalized_html' | 'snapshot_png'
  extractor   text  NOT NULL,
  content     jsonb,
  preview     bytea,
  PRIMARY KEY (blob_sha256, kind)
);
```

**A `search_vector` bővítése (D51-javítás):** a `documents.content` `NOT NULL` (üres szöveg is érték), ezért a korábban tervezett `coalesce(content, search_text)` sosem esne vissza a `search_text`-re. A helyes képlet: `to_tsvector('hungarian', coalesce(content, '') || ' ' || coalesce(search_text, ''))` a B súlyú tagban. A generált oszlop képlete nem módosítható: a bővítés `DROP COLUMN` + `ADD COLUMN … GENERATED … STORED` + a GIN-index újraépítése (táblaújraírás, karbantartási ablakban).

A hivatkozás nélküli blob (egyetlen `revision_files` sor sem mutat rá) 1 év után törlődik (D48). A `blob_derivatives` nem mentendő, újragenerálható.

**Második ütemes (vagy abban használt) elemek az MVP-sémában (azonosításhoz):** `documents.is_template` (D47: MVP-ben nincs beállító út, a „Sablon” facet üres), `users.left_at` és `users.pseudonymized_at` (D48), a `taltos_retention` szerep és jogai (WP33), `users.last_login_at` olvasása az „inaktív tulajdonosok” listához (D49, WP32), az `imported_from` esemény (D47), a `user_pseudonymized` és `retention_purge` események, a `sessions` lejárt sorainak törlése, valamint a 6. szakasz táblái és oszlopai (D42, WP30).
