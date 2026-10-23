# Tudásbázis — PostgreSQL séma (B4, megvalósítási referencia)

*A döntési napló (5. verzió) 4. fejezetének konkrét leképezése. Eszköz: Drizzle (D25). A napló az elvi forrás — eltérés esetén a napló nyer, és ezt a dokumentumot kell frissíteni.*

## 0. Elvek, amelyeket a séma kódol

- **Soft delete mindenhol (D20):** `deleted_at timestamptz` nullable oszlop; fizikai `DELETE` az alkalmazásból tilos, csak a majdani retention-folyamat (NY4) végezhet. Emiatt **minden FK `RESTRICT`** — kaszkádolt törlés nincs, mert törlés sincs.
- **Újraépíthető vs. elsődleges adat (D4, D18, D19):** táblánként jelölve; a pg_dump a teljes DB-t menti, a megkülönböztetés elvi (mi jönne vissza a repóból reindexszel).
- **Dokumentum-identitás = UUID (a frontmatterből):** a `documents.id`-t **az alkalmazás generálja** (a frontmatterbe is beírja), ezért az oszlopnak **nincs DB-oldali defaultja** — a séma kényszeríti ki, hogy az id soha ne a DB-ből származzon.
- **Keresési infrastruktúra kézi SQL-migrációban (D25 kikötés):** extension, generált tsvector-oszlop, GIN indexek — lásd 3. szakasz.

## 1. Drizzle séma (`schema.ts`)

```ts
import {
  pgTable, pgEnum, uuid, text, timestamp, boolean, integer,
  bigserial, jsonb, primaryKey, uniqueIndex, index, customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// tsvector típus — csak a típusrendszer kedvéért; az oszlopot kézi migráció hozza létre
export const tsvector = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});

// Státusz: zárt, stabil halmaz → enum (D6 soft workflow állapotai)
export const documentStatus = pgEnum('document_status', [
  'draft', 'review', 'tested', 'published',
]);

// ── users ── OIDC-identitások; a favorites miatt már nem eldobható cache (D18)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  oidcSub: text('oidc_sub').notNull(),            // OIDC subject — a stabil külső azonosító
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('users_oidc_sub_uq').on(t.oidcSub),
  uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
]);

// ── allowlist ── beléptetési kapu (D5) — ELSŐDLEGES adat
export const allowlist = pgTable('allowlist', {
  email: text('email').primaryKey(),               // tárolás előtt lower-eljük az app-ban
  note: text('note'),                              // pl. ki/miért került fel
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── documents ── index + állapot; a tartalom forrása a repo (D1)
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey(),                     // NINCS default — az app generálja (frontmatter!)
  repoPath: text('repo_path').notNull(),           // átnevezéskor változik; az id nem
  title: text('title').notNull(),
  status: documentStatus('status').notNull().default('draft'),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  isTemplate: boolean('is_template').notNull().default(false),   // D17
  iteration: integer('iteration').notNull().default(1),
  lastCommitHash: text('last_commit_hash'),        // D4 konzisztencia-őr alapja
  contentText: text('content_text').notNull().default(''), // indexelt nyers tartalom — újraépíthető
  // search_tsv: GENERATED oszlop, kézi migrációban (3. szakasz)
  deletedAt: timestamp('deleted_at', { withTimezone: true }),    // archívum (D8)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('documents_repo_path_uq').on(t.repoPath),
  index('documents_status_idx').on(t.status),
  index('documents_owner_idx').on(t.ownerId),
]);

// ── categories ── lapos címke-entitás (D19) — az üres kategória miatt MENTENDŐ
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),    // csak üresen soft-törölhető (D19, app-szabály)
}, (t) => [
  uniqueIndex('categories_name_lower_uq').on(sql`lower(${t.name})`),
]);

// ── document_categories ── több-a-többhöz (D19) — frontmatterből ÚJRAÉPÍTHETŐ
export const documentCategories = pgTable('document_categories', {
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'restrict' }),
}, (t) => [
  primaryKey({ columns: [t.documentId, t.categoryId] }),
  index('document_categories_category_idx').on(t.categoryId),
]);

// ── favorites ── privát kedvencek (D18) — ELSŐDLEGES adat
export const favorites = pgTable('favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.documentId] }),
  index('favorites_document_idx').on(t.documentId),
]);

// ── events ── auditnyom (D6, D9, D20) — ELSŐDLEGES adat, csak INSERT (append-only)
export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),                    // nyílt halmaz → text, nem enum (indoklás: 4. szakasz)
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'restrict' }),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),
  actorId: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  details: jsonb('details'),                       // pl. komment korábbi tartalma (D20), régi/új státusz
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('events_document_idx').on(t.documentId, t.createdAt),
  index('events_type_idx').on(t.type),
]);

// ── comments ── kommentfolyam (D9, D20) — ELSŐDLEGES adat
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'restrict' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  content: text('content').notNull(),              // mindig az AKTUÁLIS tartalom; a történet az events-ben
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),      // "szerkesztve" jelölés (D20)
  deletedAt: timestamp('deleted_at', { withTimezone: true }),    // soft delete + placeholder (D20)
}, (t) => [
  index('comments_document_idx').on(t.documentId, t.createdAt),
]);

// ── locks ── pesszimista lock + heartbeat (D7) — futásidejű, nem mentendő
export const locks = pgTable('locks', {
  documentId: uuid('document_id').primaryKey()     // dokumentumonként legfeljebb EGY lock — a PK kényszeríti
    .references(() => documents.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
});
```

*(A pg-boss a saját sématerét — `pgboss` schema — maga hozza létre és migrálja; nem része a Drizzle-láncnak, és nem mentendő adat.)*

## 2. Eseménytípusok (a `type` mező értékkészlete, app-szinten kényszerítve)

`created`, `edited`, `status_changed`, `renamed`, `deleted`, `restored`,
`duplicated_from` (D17 — mindkét dokumentumnál megjelenik, a `details` hordozza a másik oldal id-ját),
`comment_created`, `comment_edited` (details: korábbi tartalom, D20), `comment_deleted`,
`category_created`, `category_updated`, `category_deleted`,
`reindex_triggered` (D4 konzisztencia-őr), `lock_expired`.

A lista a kódban egyetlen TypeScript union típusként él — új típus felvétele kódmódosítás, de nem DB-migráció.

## 3. Kézi SQL-migrációk (Drizzle custom migration, D25 kikötés)

```sql
-- 0001_search_infrastructure.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Súlyozott, magyar nyelvű keresővektor: cím (A) > tartalom (B)
ALTER TABLE documents
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('hungarian', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('hungarian', coalesce(content_text, '')), 'B')
  ) STORED;

CREATE INDEX documents_search_tsv_idx
  ON documents USING GIN (search_tsv);

-- Ragozás-/elírás-tűrő kiegészítés (pg_trgm, ILIKE '%...%' és similarity)
CREATE INDEX documents_title_trgm_idx
  ON documents USING GIN (title gin_trgm_ops);
CREATE INDEX documents_content_trgm_idx
  ON documents USING GIN (content_text gin_trgm_ops);
```

```sql
-- 0002_events_append_only.sql
-- Az auditnyom hitelességének DB-szintű támasza (6. fejezet, vállalt kockázat enyhítése):
-- az events tábla append-only — UPDATE és DELETE triggerrel tiltva.
CREATE OR REPLACE FUNCTION forbid_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events tabla append-only: % nem megengedett', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_no_update_delete
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();
```

*(Megjegyzés: a majdani retention-folyamatnak (NY4) — ha az auditra is kiterjedne — ezt a triggert kellene ideiglenesen feloldania; ez szándékos súrlódás, a NY4-nél előre jelzett feszültség DB-szintű megjelenése.)*

## 4. Séma-szintű mikrodöntések és indoklásuk

| # | Döntés | Indoklás |
|---|---|---|
| S1 | `status` = Postgres **enum**, `events.type` = **text** | A státusz zárt, stabil halmaz (D6 workflow); az eseménytípus nyílt, bővülő halmaz — enum-bővítés migrációt igényelne minden új típusnál, a text + TS-union a kódban ugyanazt a biztonságot adja migráció nélkül. |
| S2 | `content_text` a DB-ben tárolva | Újraépíthető adat, de nélküle nincs `pg_trgm` index és nincs `ts_headline` (találati szövegkörnyezet). A tárolás ára elhanyagolható, a repo marad a source of truth (D1). |
| S3 | Minden FK `RESTRICT` | Soft delete világban (D20) fizikai törlés nincs — a kaszkád értelmetlen, a RESTRICT viszont védőháló egy hibás kézi DELETE ellen. |
| S4 | E-mail egyediség `lower(email)` egyedi indexszel, nem citext-tel | Egy extension-nel kevesebb; az app amúgy is normalizál. |
| S5 | `events` kap `category_id` oszlopot | D19 szerint a kategória-műveletek is naplózódnak, de nincs dokumentumuk — a két nullable hivatkozás (document_id / category_id) fedi mindkét esetet. |
| S6 | `events` append-only trigger (0002) | A 6. fejezet vállalt kockázata ("az audit gyökere az alkalmazás") DB-szinten enyhíthető olcsón: az alkalmazás hibája/kompromittálódása se tudja észrevétlenül átírni a múltat. |
| S7 | `locks.document_id` = PK | Az "egy dokumentum — legfeljebb egy lock" invariáns nem app-logika, hanem séma-kényszer; a lock-megszerzés versenyhelyzete `INSERT ... ON CONFLICT`-tal atomi. |
| S8 | Kategória védelmi szabályai ("használatban nem törölhető/nevezhető át", D19) **app-szinten** | DB-triggerrel is kifejezhető lenne, de a hibaüzenet-minőség és a soft delete-tel való összjáték miatt a szerviz-rétegben él; a `RESTRICT` FK a fizikai törlés ellen így is véd. |

## 5. Backup-kategorizálás (D4/D18 leképezése)

| Tábla | Kategória |
|---|---|
| `events`, `comments`, `allowlist`, `favorites`, `categories` | **Elsődleges — sehonnan nem újraépíthető** |
| `users` | Elsődleges (a favorites hivatkozásai miatt, D18) |
| `documents` (metaadat + index), `document_categories` | Repóból újraépíthető (reindex, D4) |
| `locks`, pg-boss `pgboss.*` | Futásidejű, mentése nem szükséges |

A pg_dump a teljes adatbázist menti (egyszerűbb és biztosabb); a kategorizálás azt rögzíti, mi az, aminek elvesztése valódi adatvesztés.
