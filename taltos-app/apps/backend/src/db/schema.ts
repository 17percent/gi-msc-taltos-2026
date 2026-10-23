import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  smallint,
  bigserial,
  bigint,
  jsonb,
  primaryKey,
  uniqueIndex,
  unique,
  index,
  customType,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
export const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// ── Enumok: zárt, stabil halmazok ────────────────────────────────────────────
export const systemRole = pgEnum('system_role', ['user', 'system_admin']); // D43
export const spaceType = pgEnum('space_type', ['general', 'team', 'project']); // D30
export const spaceRole = pgEnum('space_role', ['author', 'space_manager']); // D43
export const reviewState = pgEnum('review_state', [
  'draft',
  'pending',
  'changes_requested',
  'approved',
]); // D45
export const changeKind = pgEnum('change_kind', [
  'create',
  'update',
  'metadata',
  'restore',
  'delete',
  'unarchive',
]); // D45, D51 g
export const changeState = pgEnum('change_state', ['pending', 'approved', 'rejected', 'withdrawn']); // D45
export const reviewDecision = pgEnum('review_decision', ['approved', 'rejected']); // D45
export const reviewerEnd = pgEnum('reviewer_end_reason', ['replaced', 'removed', 'closed']); // D51 b
export const linkType = pgEnum('link_type', ['hivatkozik', 'szarmazik', 'epit_ra', 'helyettesiti']); // D39
export const requestState = pgEnum('request_state', ['pending', 'approved', 'rejected']); // D43, D44

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ── users ── OIDC-identitás; a személyes adat egyetlen helye (D48) ────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oidcSub: text('oidc_sub'), // pszeudonimizáláskor NULL
    email: text('email'), // pszeudonimizáláskor NULL
    displayName: text('display_name').notNull(), // pszeudonimizáláskor 'Volt munkatárs #<rövid id>'
    avatarUrl: text('avatar_url'),
    systemRole: systemRole('system_role').notNull().default('user'), // D43 (korábban is_admin)
    createdAt: ts('created_at').notNull().defaultNow(),
    lastLoginAt: ts('last_login_at'), // „inaktív tulajdonosok” lista (D49, 2. ütem)
    leftAt: ts('left_at'), // kilépés ideje — a retenciós óra indul (D48, 2. ütem)
    pseudonymizedAt: ts('pseudonymized_at'), // D48, 2. ütem
  },
  (t) => [
    uniqueIndex('users_oidc_sub_uq').on(t.oidcSub),
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
  ],
);

// ── sessions ── munkamenet-tár (D51 a, D26, NY10) ────────────────────────────
// A süti opak, nagy entrópiájú tokenjének SHA-256 hash-e az id; a nyers token nem tárolódik.
// Érvényes: now() < expires_at (abszolút, létrehozás + 8 óra) ÉS now() < last_seen_at + 60 perc.
// A last_seen_at írása ritkított (legfeljebb percenként egyszer); a WebSocket-forgalom is frissíti.
// Kijelentkezés és allowlistről levétel: expires_at = now() (UPDATE, nem DELETE); a lejártak törlése a retenciós folyamatban (S21).
export const sessions = pgTable(
  'sessions',
  {
    id: bytea('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId), // visszavonás felhasználónként (allowlistről levétel)
    index('sessions_expires_idx').on(t.expiresAt), // takarítás
  ],
);

// ── allowlist ── belépési kapu (D5); MVP-ben konfigurációból seedelve (D49) ───
export const allowlist = pgTable(
  'allowlist',
  {
    email: text('email').primaryKey(), // lower-elve tárolva (CHECK)
    note: text('note'),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'restrict' }), // konfig-seednél NULL
    createdAt: ts('created_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'), // újrafelvételkor a sor deleted_at-je NULL-ra áll (nincs második sor)
  },
  (t) => [check('allowlist_email_lower', sql`${t.email} = lower(${t.email})`)],
);

// ── spaces ── színterek (D30, D44) ───────────────────────────────────────────
export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: spaceType('type').notNull(),
    description: text('description'),
    color: text('color').notNull(), // Atlasz-alapszín (D37)
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    closedAt: ts('closed_at'), // lezárt projekt-tér: csak olvasható (D44)
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('spaces_name_lower_uq').on(sql`lower(${t.name})`),
    check('spaces_closed_only_project', sql`${t.closedAt} IS NULL OR ${t.type} = 'project'`), // D51
  ],
);

// ── space_members ── tagság és szerep (D43); nem tag = nem lát semmit (D44) ──
// Újrafelvételkor a removed_at NULL-ra áll (a PK miatt nincs második sor); a szerep- és tagság-történet az events-ben él.
export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: spaceRole('role').notNull(),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    removedAt: ts('removed_at'), // soft delete — a tagság-történet az events-ben is
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.userId] }),
    // (D51) a user_id-indexet a 0004 részleges, role-t tartalmazó indexe váltja ki
  ],
);

// ── space_requests ── projekt-tér kérése (D43) ───────────────────────────────
export const spaceRequests = pgTable('space_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  purpose: text('purpose').notNull(),
  proposedManagerId: uuid('proposed_manager_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  state: requestState('state').notNull().default('pending'),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
  decidedAt: ts('decided_at'),
  createdSpaceId: uuid('created_space_id').references(() => spaces.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── membership_requests ── felvétel kérése idegen linkről (D44) ──────────────
export const membershipRequests = pgTable('membership_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  spaceId: uuid('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'restrict' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  viaDocumentId: uuid('via_document_id'), // melyik csonkról jött (FK nélkül, S12)
  message: text('message'),
  state: requestState('state').notNull().default('pending'),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
  decidedAt: ts('decided_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── user_space_colors ── egyéni Atlasz-szín (D37), privát, nem naplózott ─────
// Fizikailag törölhető (D51 j): a szín visszaállítása a sor törlése.
export const userSpaceColors = pgTable(
  'user_space_colors',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    color: text('color').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.spaceId] })],
);

// ── document_kinds ── a fajta-lista (D34), Rendszeradmin bővíti ──────────────
export const documentKinds = pgTable('document_kinds', {
  key: text('key').primaryKey(), // 'prompt', 'skill', 'agent', 'mcp_server', …
  label: text('label').notNull(),
  sortOrder: smallint('sort_order').notNull().default(0),
  deletedAt: ts('deleted_at'),
});

// ── documents ── a dokumentum aktuális (élő) állapota ────────────────────────
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(), // NINCS default — az app generálja
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }), // D30
    slug: text('slug').notNull(), // URL-attribútum, átnevezéskor változhat (az archivált dokumentum slugja is foglalt)
    title: text('title').notNull(), // élő érték (D51 e); a Jóváhagyott cím a revízióban
    kind: text('kind')
      .notNull()
      .references(() => documentKinds.key, { onDelete: 'restrict' }), // D34, élő érték
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }), // D31, D43
    isTemplate: boolean('is_template').notNull().default(false), // D47 — 2. ütem: MVP-ben nincs beállító út (sablonná jelölés review-val); csak Jóváhagyott változással áll
    content: text('content').notNull().default(''), // az élő (legutóbbi) tartalom (D29 materializálás); a Jóváhagyott a revízióból jön
    tagText: text('tag_text').notNull().default(''), // denormalizált címkenevek a keresővektorhoz; a document_tags triggere tartja karban (S9, D51)
    reviewState: reviewState('review_state').notNull().default('draft'), // D45, gyorsítótár (S5)
    approvedRevisionId: uuid('approved_revision_id'), // kompozit FK (id, approved_revision_id) a 3. szakaszban (körkörös hivatkozás)
    iteration: integer('iteration').notNull().default(0), // Jóváhagyott változások száma (D45); minden jóváhagyott kérés növeli (S24)
    reviewDueAt: ts('review_due_at'), // D33 — jóváhagyáskor a change_requests.proposed_review_due_at-ből (D51 f)
    freshnessAt: ts('freshness_at').notNull().defaultNow(), // D36 „frissesség”: kizárólag jóváhagyás és „Még aktuális” írja (D51)
    // search_vector: GENERATED oszlop, kézi migrációban (3. szakasz)
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(), // az app állítja (nem a frissesség-rangsor alapja)
    deletedAt: ts('deleted_at'), // archívum (D8, jóváhagyott törléssel) VAGY eldobott piszkozat (approved_revision_id IS NULL)
  },
  (t) => [
    uniqueIndex('documents_space_slug_uq').on(t.spaceId, t.slug), // a space_id-előtag miatt külön space_id-index nem kell (D51)
    index('documents_owner_idx').on(t.ownerId),
    index('documents_review_due_idx')
      .on(t.reviewDueAt)
      .where(sql`${t.reviewDueAt} IS NOT NULL AND ${t.deletedAt} IS NULL`), // D51
    check(
      'documents_approved_has_revision',
      sql`${t.reviewState} <> 'approved' OR ${t.approvedRevisionId} IS NOT NULL`,
    ), // D51
    check('documents_iteration_nonneg', sql`${t.iteration} >= 0`),
    // TODO (WP6 méretkorlát): CHECK (length(content) <= N) — az N a WP6 méretkorlátjával egyező érték (tsvector-korlát: 1 MB); itt nincs kitalált szám.
  ],
);

// ── document_revisions ── teljes pillanatképek (D1), csak INSERT ─────────────
// Osztályozás nincs az oszlopokon (a tábla append-only): Jóváhagyott = egy approved change_requests.proposed_revision_id;
// függő = pending kérés javaslata; különben köztes checkpoint vagy elutasított/visszavont javaslat (S20, 5. szakasz).
export const documentRevisions = pgTable(
  'document_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    title: text('title').notNull(), // a metaadat is verziózott (S10)
    content: text('content').notNull(),
    metadata: jsonb('metadata').notNull(), // pillanatkép: kind, címke-id-k, kapcsolatok (cél-id, típus, anchor) — csak azonosítók, címek olvasáskor oldódnak fel (S17)
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    contributors: uuid('contributors')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`), // D29
    message: text('message'), // mindig opcionális (D45)
    restoredFromRevisionId: uuid('restored_from_revision_id'), // FK nélkül: a forrás-revízió a retencióval törlődhet (S20)
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('document_revisions_doc_idx').on(t.documentId, t.createdAt),
    unique('document_revisions_doc_id_uq').on(t.documentId, t.id), // a kompozit FK-k célja (D51, S22)
  ],
);

// ── document_collab_state ── Yjs-állapot (D29), futásidejű ───────────────────
export const documentCollabState = pgTable('document_collab_state', {
  documentId: uuid('document_id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'restrict' }),
  state: bytea('state').notNull(),
  pendingContributors: uuid('pending_contributors')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`), // D51: az utolsó checkpoint óta szerkesztők (újraindítást túléli); checkpointkor a revízió contributors-ába kerül és kiürül
  lastEditAt: ts('last_edit_at').notNull().defaultNow(), // D51: tétlenségi checkpoint (10 perc) és „utolsó szerkesztő kilépett” újraindítás után is eldönthető
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ── change_requests ── review-kérés (D45) ────────────────────────────────────
// A base/proposed revízió-hivatkozás kompozit FK (document_id, revision_id) a 3. szakaszban (S22).
export const changeRequests = pgTable(
  'change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    kind: changeKind('kind').notNull(),
    baseRevisionId: uuid('base_revision_id'), // NULL: új dokumentum (create)
    proposedRevisionId: uuid('proposed_revision_id'), // csak pending/approved kérésnél kötelező; delete és unarchive esetén mindig NULL; elutasított/visszavont kérésnél a retenció NULL-ra állíthatja (D51 h)
    proposedReviewDueAt: ts('proposed_review_due_at'), // D51 f: beküldéskor kötelező (12 hónapra előtöltött) create/update/metadata/restore esetén; delete/unarchive: NULL
    initiatorId: uuid('initiator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    message: text('message'),
    state: changeState('state').notNull().default('pending'),
    iteration: integer('iteration'), // D51: jóváhagyáskor kitöltve (a dokumentum új iteration-je); a revíziólista vN-je ebből jön
    createdAt: ts('created_at').notNull().defaultNow(),
    decidedAt: ts('decided_at'),
  },
  (t) => [
    index('change_requests_doc_idx').on(t.documentId, t.createdAt),
    index('change_requests_initiator_idx').on(t.initiatorId, t.state),
    index('change_requests_proposed_rev_idx')
      .on(t.proposedRevisionId)
      .where(sql`${t.proposedRevisionId} IS NOT NULL`), // D51: Jóváhagyott-jelölés join, FK-ellenőrzés
    index('change_requests_base_rev_idx')
      .on(t.baseRevisionId)
      .where(sql`${t.baseRevisionId} IS NOT NULL`), // D51
    check(
      'cr_proposal_rules',
      sql`(
    (${t.kind} IN ('delete','unarchive') AND ${t.proposedRevisionId} IS NULL)
    OR (${t.kind} NOT IN ('delete','unarchive') AND (${t.state} NOT IN ('pending','approved') OR ${t.proposedRevisionId} IS NOT NULL))
  )`,
    ), // D51 h (a korábbi cr_delete_has_no_proposal helyett)
    check(
      'cr_due_rules',
      sql`(${t.kind} IN ('delete','unarchive')) = (${t.proposedReviewDueAt} IS NULL)`,
    ), // D51 f
    check(
      'cr_state_fields',
      sql`(${t.state} = 'pending') = (${t.decidedAt} IS NULL) AND (${t.state} = 'approved') = (${t.iteration} IS NOT NULL)`,
    ), // D51
  ],
);

// ── change_request_reviewers ── a review-er „helyek” (D45, D51 b) ─────────────
// Helyettesítő kulcs: ugyanaz a személy később újra megjelölhető (csere, kiesés után).
// Aktív sor: ended_at IS NULL. A csere, a kiesés (színtérből/allowlistről) és a kérés lezárása (az el nem döntött sorok
// 'closed' jelölést kapnak, így a részleges index nem hízik) a sort lezárja, a sor megmarad.
export const changeRequestReviewers = pgTable(
  'change_request_reviewers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    changeRequestId: uuid('change_request_id')
      .notNull()
      .references(() => changeRequests.id, { onDelete: 'restrict' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decision: reviewDecision('decision'), // NULL = függő
    reason: text('reason'),
    decidedAt: ts('decided_at'),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
    endedAt: ts('ended_at'), // D51: replaced (csere), removed (kiesés), closed (a kérés lezárult)
    endReason: reviewerEnd('end_reason'),
  },
  (t) => [
    index('crr_change_request_idx').on(t.changeRequestId),
    index('crr_reviewer_pending_idx')
      .on(t.reviewerId)
      .where(sql`${t.decision} IS NULL AND ${t.endedAt} IS NULL`),
    // az „aktív review-er egyedisége” részleges egyedi index a 0003-ban
    check(
      'crr_reject_needs_reason',
      sql`${t.decision} IS DISTINCT FROM 'rejected' OR (${t.reason} IS NOT NULL AND btrim(${t.reason}) <> '')`,
    ),
    check('crr_decision_decided_at', sql`(${t.decision} IS NULL) = (${t.decidedAt} IS NULL)`),
    check('crr_end_consistent', sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`),
  ],
);

// ── tags, document_tags ── globális címkék (D34) ─────────────────────────────
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(), // kisbetű, ékezet nélkül, szóköz-normalizált (az app számolja)
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tags_normalized_uq').on(t.normalizedName)],
);

// Fizikailag törölhető (D51 j): a címketörténet a revízió-pillanatképben él. A tag_text triggerrel követi (0001).
export const documentTags = pgTable(
  'document_tags',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.tagId] }),
    index('document_tags_tag_idx').on(t.tagId),
  ],
);

// ── document_links ── típusos kapcsolatok (D39, D44) ─────────────────────────
// A document_id-ra/cél-id-ra az indexek teljesek (nem részlegesek): a soft-deleted sorokat is érintő FK-ellenőrzést (retenció) is ki kell szolgálniuk.
export const documentLinks = pgTable(
  'document_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    type: linkType('type').notNull(),
    anchorText: text('anchor_text'), // linkenként egy kapcsolat (V54)
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('document_links_from_idx').on(t.fromId),
    index('document_links_to_idx').on(t.toId),
    check('document_links_no_self', sql`${t.fromId} <> ${t.toId}`),
  ],
);

// ── favorites ── privát kedvencek (D18); fizikailag törölhető (D51 j) ────────
export const favorites = pgTable(
  'favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.documentId] })],
);

// ── subscriptions ── követés, a kedvenctől független (D35, D49); fizikailag törölhető (D51 j) ──
export const subscriptions = pgTable(
  'subscriptions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.documentId] }),
    index('subscriptions_document_idx').on(t.documentId), // D51: címzett-keresés minden eseménynél
  ],
);

// ── events ── auditnyom, append-only (D6, D20, D48) ──────────────────────────
// A dokumentum-, színtér- és kérés-hivatkozás FK nélküli uuid (D51 h, S12): az esemény (5 év) túléli a dokumentumot (2 év);
// a törölt dokumentumra mutató esemény a felületen „törölt dokumentum”. Dokumentum-eseménynél a space_id is kitöltendő (CHECK).
export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: text('type').notNull(), // nyílt halmaz → text (S1)
    spaceId: uuid('space_id'), // színtér-szintű audit (D43); nincs FK
    documentId: uuid('document_id'), // nincs FK
    changeRequestId: uuid('change_request_id'), // nincs FK
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }), // D51 d: csak a rendszer-eseménytípusoknál lehet NULL
    details: jsonb('details'), // nem tartalmazhat nevet vagy e-mailt (D48); a megjelenítő névfeloldás olvasáskor
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('events_document_idx').on(t.documentId, t.createdAt),
    index('events_space_idx').on(t.spaceId, t.createdAt),
    index('events_actor_idx')
      .on(t.actorId, t.createdAt)
      .where(sql`${t.actorId} IS NOT NULL`), // D51: GET /events actorId szűrő
    index('events_created_brin').using('brin', t.createdAt), // D51: retenció és időablak; append-only, korrelált → BRIN (az events_type_idx megszűnt)
    check(
      'events_actor_required',
      sql`${t.actorId} IS NOT NULL OR ${t.type} IN (
    'review_due_soon','review_due','review_reminder','review_stalled',
    'allowlist_added','allowlist_removed','user_pseudonymized','retention_purge')`,
    ), // D51 d: új rendszer-típus = migráció
    check('events_document_has_space', sql`${t.documentId} IS NULL OR ${t.spaceId} IS NOT NULL`), // D51
  ],
);

// ── comments ── kommentfolyam (D20, D35) ─────────────────────────────────────
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    content: text('content').notNull(), // @-említés formátuma nyitott (4. szakasz vége)
    createdAt: ts('created_at').notNull().defaultNow(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'), // 90 nap után végleges törlés (D48)
  },
  (t) => [
    index('comments_document_idx').on(t.documentId, t.createdAt),
    index('comments_deleted_idx')
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} IS NOT NULL`), // D51: retenciós keresés
  ],
);

// ── notifications ── értesítés (harang, említés, e-mail-sor; D35, D46) ───────
// A dashboard review- és kérés-blokkjai ÉLŐ lekérdezések (aktív change_request_reviewers sorok, change_requests, documents.review_due_at,
// membership_requests, space_requests), nem az értesítésekből épülnek (D51); az értesítés a harang, az @említés és az e-mail forrása.
export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    category: text('category').notNull(), // zárt halmaz (CHECK, D35/D39/D46 címzettjei)
    readAt: ts('read_at'),
    emailDue: boolean('email_due').notNull().default(false), // D51: az app jelzi, ha e-mail (azonnali vagy napi összefoglaló) is kell
    emailedAt: ts('emailed_at'), // azonnali levél vagy napi összefoglaló (D46)
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_unread_idx')
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} IS NULL`),
    index('notifications_digest_idx')
      .on(t.createdAt)
      .where(sql`${t.emailDue} AND ${t.emailedAt} IS NULL`), // D51
    index('notifications_event_idx').on(t.eventId), // D51: events retenció FK-ellenőrzése
    index('notifications_created_brin').using('brin', t.createdAt), // D51: 90 napos retenció
    // Kategóriák és címzettjeik (D35, D39, D46, D51): review_request (megjelölt review-er), review_stalled (review-er és indítványozó, 3 munkanap),
    // reviewer_vacated (indítványozó és Színtérgazda: kieső review-er, pótlás kell), own_request (indítványozó: döntés, végeredmény),
    // changes_requested (tulajdonos, indítványozó), review_due (tulajdonos, közreműködők), mention, comment (saját vagy követett dokumentum),
    // followed_change (követett dokumentum jóváhagyott változása), link_replaced (cél tulajdonosa, D39), link_removed_by_target (forrás tulajdonosa, V50),
    // member_added (self_assigned: nincs értesítés), membership_request (Színtérgazda), membership_decision (kérő),
    // space_request (Rendszeradmin), space_request_decision (kérő).
    check(
      'notifications_category_ck',
      sql`${t.category} IN (
    'review_request','review_stalled','reviewer_vacated','own_request','changes_requested','review_due',
    'mention','comment','followed_change','link_replaced','link_removed_by_target','member_added',
    'membership_request','membership_decision','space_request','space_request_decision')`,
    ),
  ],
);
