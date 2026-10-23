# Tudásbázis — PostgreSQL séma (B4, 10. verzió)

*A [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] 4. fejezetének konkrét leképezése. Eszköz: Drizzle (D25). A napló az elvi forrás: eltérés esetén a napló nyer, és ezt a dokumentumot kell frissíteni.*

*Változás a korábbi B4-hez képest ([[Tervezés/Tervezés (negyedik kör)/tudasbazis-db-sema-b4|B4, napló v5 szerint]]): a Git-alapú mezők (`repo_path`, `last_commit_hash`, reindex) megszűntek (D1, Postgres-only). Új a teljes revíziótörténet (D1), a közös szerkesztés állapota (D29), a színterek és szerepek (D30, D43, D44), a review-folyamat (D45), a címkék és a fajta (D34), a kapcsolatok (D39), az értesítések (D35, D46) és a felülvizsgálat (D33). A `locks` tábla (D7) megszűnt, a `categories` helyét a `tags` vette át, a pg-boss nincs (D22). A többformátumú tartalom (D42) táblái külön, második ütemes migrációban vannak (6. szakasz).*

## 0. Elvek, amelyeket a séma kódol

- **Egyetlen adatréteg (D1):** minden tábla elsődleges adat; nincs „repóból újraépíthető” kategória. Kivétel a futásidejű Yjs-állapot és a kinyert származékok (5. szakasz).
- **Soft delete mindenhol (D20):** `deleted_at timestamptz` nullable oszlop. Fizikai `DELETE` az alkalmazásból tilos, csak a retenciós folyamat (D48) végezhet. Ezért minden FK `RESTRICT`.
- **Dokumentum-identitás = UUID, az alkalmazás generálja:** a `documents.id`-nek nincs DB-oldali defaultja.
- **A revíziók megváltoztathatatlanok (D1, D45):** a `document_revisions` csak INSERT; visszaállítás = új revízió.
- **Kikényszerített review (D45):** a dokumentum „hivatalos” állapota az `approved_revision_id`. Ezt kizárólag a review-döntés tranzakciója állíthatja.
- **Személyes adat egy helyen (D48):** név és e-mail csak a `users` táblában van; minden más tábla `user_id`-vel hivatkozik. A pszeudonimizálás így egyetlen `users`-sor átírása, az append-only `events` érintése nélkül.
- **Keresési infrastruktúra, triggerek és részleges indexek kézi SQL-migrációban (D25 kikötés):** 3. szakasz.

## 1. Drizzle séma (`schema.ts`)

```ts
import {
  pgTable, pgEnum, uuid, text, timestamp, boolean, integer, smallint,
  bigserial, bigint, jsonb, primaryKey, uniqueIndex, index, customType, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
export const bytea    = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// ── Enumok: zárt, stabil halmazok ────────────────────────────────────────────
export const systemRole     = pgEnum('system_role',     ['user', 'system_admin']);                                // D43
export const spaceType      = pgEnum('space_type',      ['general', 'team', 'project']);                          // D30
export const spaceRole      = pgEnum('space_role',      ['author', 'space_manager']);                             // D43
export const reviewState    = pgEnum('review_state',    ['draft', 'pending', 'changes_requested', 'approved']);   // D45
export const changeKind     = pgEnum('change_kind',     ['create', 'update', 'metadata', 'restore', 'delete']);   // D45
export const changeState    = pgEnum('change_state',    ['pending', 'approved', 'rejected', 'withdrawn']);        // D45
export const reviewDecision = pgEnum('review_decision', ['approved', 'rejected']);                                // D45
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
  leftAt: ts('left_at'),                            // kilépés ideje — a retenciós óra indul (D48)
  pseudonymizedAt: ts('pseudonymized_at'),          // D48
}, (t) => [
  uniqueIndex('users_oidc_sub_uq').on(t.oidcSub),
  uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
]);

// ── allowlist ── belépési kapu (D5); MVP-ben konfigurációból seedelve (D49) ───
export const allowlist = pgTable('allowlist', {
  email: text('email').primaryKey(),                // lower-elve tárolva
  note: text('note'),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
});

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
]);

// ── space_members ── tagság és szerep (D43); nem tag = nem lát semmit (D44) ──
export const spaceMembers = pgTable('space_members', {
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  role: spaceRole('role').notNull(),
  addedBy: uuid('added_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  removedAt: ts('removed_at'),                      // soft delete — a tagság-történet az events-ben is
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.userId] }),
  index('space_members_user_idx').on(t.userId),
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

// ── documents ── a dokumentum aktuális állapota ──────────────────────────────
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey(),                      // NINCS default — az app generálja
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'restrict' }),   // D30
  slug: text('slug').notNull(),                     // URL-attribútum, átnevezéskor változhat
  title: text('title').notNull(),
  kind: text('kind').notNull().references(() => documentKinds.key, { onDelete: 'restrict' }),  // D34
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),    // D31, D43
  isTemplate: boolean('is_template').notNull().default(false),     // D47 — csak Jóváhagyott változással áll
  content: text('content').notNull().default(''),   // a piszkozat élő tartalma (D29 materializálás)
  tagText: text('tag_text').notNull().default(''),  // denormalizált címkék a keresővektorhoz (S9)
  reviewState: reviewState('review_state').notNull().default('draft'),           // D45, gyorsítótár (S5)
  approvedRevisionId: uuid('approved_revision_id'), // FK a 3. szakaszban (körkörös hivatkozás)
  iteration: integer('iteration').notNull().default(0),  // Jóváhagyott változások száma (D45)
  reviewDueAt: ts('review_due_at'),                 // D33 — a Jóváhagyott állapotba kerüléskor kötelező
  // search_vector: GENERATED oszlop, kézi migrációban (3. szakasz)
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),                      // archívum (D8) — csak Jóváhagyott törléssel
}, (t) => [
  uniqueIndex('documents_space_slug_uq').on(t.spaceId, t.slug),
  index('documents_space_idx').on(t.spaceId),
  index('documents_owner_idx').on(t.ownerId),
  index('documents_review_state_idx').on(t.reviewState),
  index('documents_review_due_idx').on(t.reviewDueAt),
]);

// ── document_revisions ── teljes pillanatképek (D1), csak INSERT ─────────────
export const documentRevisions = pgTable('document_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),                   // a metaadat is verziózott (S10)
  content: text('content').notNull(),
  metadata: jsonb('metadata').notNull(),            // kind, címkék, kapcsolatok pillanatképe
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  contributors: uuid('contributors').array().notNull().default(sql`'{}'`),  // D29
  message: text('message'),                         // mindig opcionális (D45)
  restoredFromRevisionId: uuid('restored_from_revision_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('document_revisions_doc_idx').on(t.documentId, t.createdAt),
]);

// ── document_collab_state ── Yjs-állapot (D29), futásidejű ───────────────────
export const documentCollabState = pgTable('document_collab_state', {
  documentId: uuid('document_id').primaryKey().references(() => documents.id, { onDelete: 'restrict' }),
  state: bytea('state').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ── change_requests ── review-kérés (D45) ────────────────────────────────────
export const changeRequests = pgTable('change_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  kind: changeKind('kind').notNull(),
  baseRevisionId: uuid('base_revision_id').references(() => documentRevisions.id, { onDelete: 'restrict' }),        // NULL: új dokumentum
  proposedRevisionId: uuid('proposed_revision_id').references(() => documentRevisions.id, { onDelete: 'restrict' }), // NULL: törlés
  initiatorId: uuid('initiator_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  message: text('message'),
  state: changeState('state').notNull().default('pending'),
  createdAt: ts('created_at').notNull().defaultNow(),
  decidedAt: ts('decided_at'),
}, (t) => [
  index('change_requests_doc_idx').on(t.documentId, t.createdAt),
  index('change_requests_initiator_idx').on(t.initiatorId, t.state),
  check('cr_delete_has_no_proposal', sql`(${t.kind} = 'delete') = (${t.proposedRevisionId} IS NULL)`),
]);

// ── change_request_reviewers ── a két review-er döntése (D45) ────────────────
export const changeRequestReviewers = pgTable('change_request_reviewers', {
  changeRequestId: uuid('change_request_id').notNull().references(() => changeRequests.id, { onDelete: 'restrict' }),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  decision: reviewDecision('decision'),             // NULL = függő
  reason: text('reason'),
  decidedAt: ts('decided_at'),
  assignedAt: ts('assigned_at').notNull().defaultNow(),
  replacedAt: ts('replaced_at'),                    // cserénél (reviewer_replaced) — a sor megmarad
}, (t) => [
  primaryKey({ columns: [t.changeRequestId, t.reviewerId] }),
  index('crr_reviewer_pending_idx').on(t.reviewerId).where(sql`${t.decision} IS NULL AND ${t.replacedAt} IS NULL`),
  check('crr_reject_needs_reason', sql`${t.decision} IS DISTINCT FROM 'rejected' OR ${t.reason} IS NOT NULL`),
]);

// ── tags, document_tags ── globális címkék (D34) ─────────────────────────────
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),   // kisbetű, ékezet nélkül, szóköz-normalizált
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('tags_normalized_uq').on(t.normalizedName)]);

export const documentTags = pgTable('document_tags', {
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'restrict' }),
}, (t) => [
  primaryKey({ columns: [t.documentId, t.tagId] }),
  index('document_tags_tag_idx').on(t.tagId),
]);

// ── document_links ── típusos kapcsolatok (D39, D44) ─────────────────────────
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
]);

// ── favorites ── privát kedvencek (D18) ──────────────────────────────────────
export const favorites = pgTable('favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.documentId] })]);

// ── subscriptions ── követés, a kedvenctől független (D35, D49) ──────────────
export const subscriptions = pgTable('subscriptions', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.documentId] })]);

// ── events ── auditnyom, append-only (D6, D20, D48) ──────────────────────────
export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),                     // nyílt halmaz → text (S1)
  spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'restrict' }),   // színtér-szintű audit (D43)
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'restrict' }),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id, { onDelete: 'restrict' }),
  actorId: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  details: jsonb('details'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('events_document_idx').on(t.documentId, t.createdAt),
  index('events_space_idx').on(t.spaceId, t.createdAt),
  index('events_type_idx').on(t.type),
  index('events_created_idx').on(t.createdAt),      // retenció (D48)
]);

// ── comments ── kommentfolyam (D20, D35) ─────────────────────────────────────
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  content: text('content').notNull(),               // @[név](user:uuid) említésekkel
  createdAt: ts('created_at').notNull().defaultNow(),
  editedAt: ts('edited_at'),
  deletedAt: ts('deleted_at'),                      // 90 nap után végleges törlés (D48)
}, (t) => [index('comments_document_idx').on(t.documentId, t.createdAt)]);

// ── notifications ── értesítés és dashboard-forrás (D35, D46) ────────────────
export const notifications = pgTable('notifications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  eventId: bigint('event_id', { mode: 'number' }).notNull().references(() => events.id, { onDelete: 'restrict' }),
  category: text('category').notNull(),             // dashboard-blokk: 'review_request' | 'own_request' | 'changes_requested' | 'review_due' | 'mention' | 'membership_request' | 'space_request'
  readAt: ts('read_at'),
  emailedAt: ts('emailed_at'),                      // azonnali levél vagy napi összefoglaló (D46)
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('notifications_user_unread_idx').on(t.userId, t.createdAt).where(sql`${t.readAt} IS NULL`),
  index('notifications_digest_idx').on(t.createdAt).where(sql`${t.emailedAt} IS NULL`),
]);
```

## 2. Eseménytípusok (a `type` mező értékkészlete, app-szinten kényszerítve)

| Csoport | Típusok |
|---|---|
| Dokumentum | `created`, `edited` (checkpoint, `contributors`-szal), `renamed`, `duplicated_from` (mindkét oldalon), `imported_from` (D47, 2. ütem), `archived`, `restored`, `owner_changed` (ok: `handover` \| `admin_handover`) |
| Review (D45) | `review_requested`, `review_approved`, `review_rejected` (indoklással, kommentként vetítve), `review_withdrawn`, `reviewer_replaced`, `change_approved`, `change_rejected` |
| Felülvizsgálat (D33) | `review_due_set`, `review_due_soon`, `review_due`, `review_reminder`, `review_confirmed` |
| Kapcsolat (D39) | `link_added`, `link_removed`, `link_removed_by_target` |
| Komment (D20) | `comment_created`, `comment_edited` (details: korábbi tartalom), `comment_deleted` |
| Címke (D34) | `tag_created` |
| Színtér és szerep (D30, D43, D44) | `space_requested`, `space_request_decided`, `space_created`, `space_closed`, `space_manager_assigned`, `member_added` (`self_assigned` jelzővel), `member_removed`, `role_changed`, `membership_requested`, `membership_request_decided` |
| Rendszer (D43, D48) | `system_admin_granted`, `system_admin_revoked`, `allowlist_added`, `allowlist_removed`, `user_pseudonymized`, `retention_purge` (összesítő, tételek nélkül) |

A lista a kódban egyetlen TypeScript union típusként él; új típus = kódmódosítás, nem DB-migráció. A korábbi `status_changed`, `category_*`, `reindex_triggered` és `lock_expired` megszűnt.

## 3. Kézi SQL-migrációk (Drizzle custom migration, D25 kikötés)

```sql
-- 0001_search_infrastructure.sql  (D4, D36, D49)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
```

```sql
-- 0002_append_only.sql  (S6)
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  -- Egyetlen kivétel: a retenciós folyamat (D48) DELETE-je, külön adatbázis-szerepben.
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
```

```sql
-- 0003_review_invariants.sql  (D45, S7)
-- Körkörös FK: documents.approved_revision_id → document_revisions.id
ALTER TABLE documents
  ADD CONSTRAINT documents_approved_revision_fk
  FOREIGN KEY (approved_revision_id) REFERENCES document_revisions(id) ON DELETE RESTRICT;

-- Dokumentumonként legfeljebb egy függő kérés
CREATE UNIQUE INDEX change_requests_one_pending_uq
  ON change_requests (document_id) WHERE state = 'pending';

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

-- Függő kérésenként pontosan két aktív review-er — a tranzakció végén ellenőrizve
CREATE OR REPLACE FUNCTION exactly_two_reviewers() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM change_request_reviewers r
    JOIN change_requests c ON c.id = r.change_request_id
   WHERE r.change_request_id = NEW.change_request_id
     AND r.replaced_at IS NULL
     AND c.state = 'pending';
  IF n NOT IN (0, 2) THEN RAISE EXCEPTION 'exactly_two_reviewers_required'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER crr_exactly_two
  AFTER INSERT OR UPDATE ON change_request_reviewers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION exactly_two_reviewers();
```

```sql
-- 0004_partial_indexes.sql
-- Aktív tagság gyors ellenőrzése (policy-függvény, láthatósági szűrés — D43, D44)
CREATE INDEX space_members_active_idx
  ON space_members (user_id, space_id) WHERE removed_at IS NULL;

-- Az Általános színtérből pontosan egy van (D43)
CREATE UNIQUE INDEX spaces_one_general_uq ON spaces (type) WHERE type = 'general';

-- Egy felhasználónak egy színtérbe egyszerre egy függő felvételi kérése lehet (D44)
CREATE UNIQUE INDEX membership_requests_one_pending_uq
  ON membership_requests (space_id, user_id) WHERE state = 'pending';
```

## 4. Séma-szintű mikrodöntések és indoklásuk

| # | Döntés | Indoklás |
|---|---|---|
| S1 | Zárt halmazok Postgres **enum**ok (szerep, review-állapot, kapcsolattípus); `events.type` **text** | Az enumok ritkán változnak, a DB-kényszer olcsó védőháló. Az eseménytípus nyílt, bővülő halmaz: text + TS-union, migráció nélkül. |
| S2 | A fajta-lista külön tábla (`document_kinds`), nem enum | A D34 szerint a Rendszeradminisztrátor bővíti: futásidejű adat, nem migráció. |
| S3 | Minden FK `RESTRICT` | Soft delete világban (D20) fizikai törlés csak a retenciós folyamatból van, ott a törlési sorrend szándékos. |
| S4 | E-mail-egyediség `lower(email)` egyedi indexszel | Egy extension-nel kevesebb; pszeudonimizáláskor NULL, ezért az index ütközés nélkül engedi. |
| S5 | `documents.review_state` gyorsítótár, a kérésekből származtatott | Az állapot-facet (D49) és a dashboard olcsó marad; a kéréssel azonos tranzakcióban frissül. |
| S6 | `events` és `document_revisions` append-only trigger; a retenció külön DB-szerep (`taltos_retention`) | A 6. fejezet vállalt kockázata (az audit gyökere az alkalmazás) DB-szinten enyhül. A D48 törlése egyetlen, nevesített szerepből történhet. |
| S7 | Az „egy függő kérés” és a „két review-er” invariáns DB-kényszer | Versenyhelyzetben (két egyidejű beküldés) a részleges egyedi index és a halasztott constraint trigger atomi; az app-ellenőrzés csak a jó hibaüzenetért van. |
| S8 | Az „utolsó Színtérgazda”, a „legalább három tag” és a „legalább egy Rendszeradmin” szabály **app-szinten**, `SELECT … FOR UPDATE`-tel | Több táblát érintő, üzleti hibakódot (409) adó szabályok; triggerben a hibaüzenet-minőség rosszabb. |
| S9 | A címkék denormalizálva a `documents.tag_text`-ben | A generált oszlop nem olvashat más táblát; a `tag_text` a címke-hozzárendeléssel azonos tranzakcióban frissül. |
| S10 | A revízió a metaadatot is tárolja (`title`, `metadata` JSONB) | A D45 a metaadat-változást is review-köteles változásnak tekinti; a diffhez a régi és az új metaadat kell. |
| S11 | Láthatósági szűrés (D44) **app-szinten**, egyetlen lekérdezés-építőben; RLS nem az MVP-ben | Az RLS erősebb, de session-változót igényel minden kapcsolaton (Drizzle és Hocuspocus közös pool). Az MVP-ben a lekérdezés-építő + végpontonkénti teszt; az RLS a második ütemben mérlegelendő. |
| S12 | `membership_requests.via_document_id` FK nélkül | A kérő nem láthatja a dokumentumot; az azonosító csak a Színtérgazda kontextusához kell. |
| S13 | A `review_state` és a `deleted_at` csak a review-döntés tranzakciójában változhat (kivétel: soha be nem küldött piszkozat eldobása) | A D45 kikényszerítése a szerviz-rétegben, egyetlen `ReviewService`-ben; a mátrixtesztek ezt is lefedik. |

## 5. Mentés és retenció táblánként (D48)

| Tábla | Mentés | Végleges törlés |
|---|---|---|
| `documents`, `document_revisions` (Jóváhagyott) | elsődleges | nincs automatikus; archivált dokumentum 2 év után, a revízióival együtt |
| `document_revisions` (elutasított vagy visszavont kérés javaslata) | elsődleges | 1 év után |
| `change_requests`, `change_request_reviewers` | elsődleges | a dokumentummal együtt |
| `comments` | elsődleges | törölt komment 90 nap után |
| `notifications` | elsődleges | 90 nap után |
| `events` | elsődleges | 5 év után (`taltos_retention` szerep) |
| `users` | elsődleges | nem törlődik; kilépés után a retenciós idő végén pszeudonimizálódik |
| `spaces`, `space_members`, kérések, `tags`, `document_tags`, `document_links`, `favorites`, `subscriptions`, `allowlist`, `document_kinds`, `user_space_colors` | elsődleges | a hivatkozott dokumentummal vagy felhasználóval együtt |
| `document_collab_state` | futásidejű; elvesztésekor a `documents.content`-ből újraépül | — |

A `pg_dump` a teljes adatbázist menti (napi, 30 napos + 12 havi megőrzés, D48).

## 6. Második ütem: többformátumú tartalom (D42)

```sql
-- 0100_multiformat.sql  — csak a második ütemben futtatandó
ALTER TABLE documents
  ADD COLUMN format text NOT NULL DEFAULT 'markdown'
    CHECK (format IN ('markdown','html_report','skill_bundle','pdf','xlsx','md_file')),
  ADD COLUMN search_text text;   -- kinyert szöveg; a search_vector képlete coalesce(content, search_text)-re bővül

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

A hivatkozás nélküli blob (egyetlen `revision_files` sor sem mutat rá) 1 év után törlődik (D48). A `blob_derivatives` nem mentendő, újragenerálható.
