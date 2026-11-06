import { randomUUID } from 'node:crypto';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { displayTagName, normalizeTagName, type TagWithCount } from '@taltos/shared';
import * as t from '../db/schema.js';
import { recordEvent } from '../events/record.js';
import { visibleDocumentsWhere } from '../policy/visibility.js';
import { fail, ok } from '../spaces/store.js';
import {
  TAG_LIST_LIMIT,
  TAG_SIMILARITY_THRESHOLD,
  TAG_SUGGESTION_LIMIT,
  type TagStore,
} from './store.js';

type Db = NodePgDatabase;

interface CountRow extends Record<string, unknown> {
  id: string;
  name: string;
  n: number;
}

const toTag = (row: CountRow): TagWithCount => ({ id: row.id, name: row.name, count: row.n });

/**
 * A címkék és a fajták PostgreSQL-megvalósítása (WP5a, `taltos_app` szerepkör).
 *
 * A lista, a javaslat és a darabszám a hívó számára LÁTHATÓ, nem törölt dokumentumokon használt címkékből épül (D58,
 * D44): a `document_tags` sorait a dokumentumhoz kötjük, a `visibleDocumentsWhere` EXISTS-ével és a `deleted_at IS
 * NULL` feltétellel szűrjük; az árva vagy csak idegen színtérben használt címke így kiesik (az illesztés belső, a
 * csoportosítás után csak a látott használat marad). A darabszám felhasználónként számolódik (D58 vállalt ár).
 */
export function createPgTagStore(db: Db): TagStore {
  return {
    // Idő: a `document_tags` olvasása (a PK-ja és a `document_tags_tag_idx` szolgál ki), a `documents` PK-ja, a
    // láthatósági EXISTS a `space_members_active_idx`-en. A méret a látható címkehasználatokkal arányos, nem a teljes
    // adatbázissal; a `LIMIT` felső korlát. Új index nem kell.
    async listTags(viewerId) {
      const result = await db.execute<CountRow>(sql`
        SELECT tg.id, tg.name, count(*)::int AS n
          FROM document_tags dt
          JOIN documents ON documents.id = dt.document_id
          JOIN tags tg ON tg.id = dt.tag_id
         WHERE documents.deleted_at IS NULL
           AND ${visibleDocumentsWhere(viewerId)}
         GROUP BY tg.id, tg.name
         ORDER BY n DESC, tg.name, tg.id
         LIMIT ${TAG_LIST_LIMIT}`);
      return { tags: result.rows.map(toTag) };
    },

    // Egyetlen lekérdezés, tranzakcióban (a `set_config(…, true)` a `SET LOCAL` megfelelője paraméterezhető alakban:
    // a hasonlósági küszöb csak a tranzakció végéig él). A `%` operátor a `tags_normalized_trgm_idx` GIN-indexet
    // használja (a `similarity() >= 0.4` nem tenné). A pontos egyezés hasonlósága 1, ezért ugyanebbe a jelölt-halmazba
    // esik; a jelöltekre CSAK EZUTÁN jön a láthatóság (a `LIMIT 3` a látható javaslatokra vonatkozik, nem a rejtettekre
    // pazarolódik): jelölt → `document_tags_tag_idx` (tag_id) → `documents` PK → láthatósági EXISTS.
    async searchTags(viewerId, normalizedQuery) {
      if (normalizedQuery === '') return { exact: null, similar: [] };
      const rows = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('pg_trgm.similarity_threshold', ${String(TAG_SIMILARITY_THRESHOLD)}, true)`,
        );
        const result = await tx.execute<CountRow & { is_exact: boolean }>(sql`
          WITH cand AS (
            SELECT id, name, normalized_name,
                   normalized_name = ${normalizedQuery} AS is_exact,
                   similarity(normalized_name, ${normalizedQuery}) AS sim
              FROM tags
             WHERE normalized_name % ${normalizedQuery} OR normalized_name = ${normalizedQuery}
          ), used AS (
            SELECT cand.id, cand.name, cand.normalized_name, cand.is_exact, cand.sim, count(*)::int AS n
              FROM cand
              JOIN document_tags dt ON dt.tag_id = cand.id
              JOIN documents ON documents.id = dt.document_id
             WHERE documents.deleted_at IS NULL
               AND ${visibleDocumentsWhere(viewerId)}
             GROUP BY cand.id, cand.name, cand.normalized_name, cand.is_exact, cand.sim
          ), ranked AS (
            SELECT used.*,
                   row_number() OVER (PARTITION BY is_exact ORDER BY sim DESC, normalized_name) AS rn
              FROM used
          )
          SELECT id, name, n, is_exact
            FROM ranked
           WHERE is_exact OR rn <= ${TAG_SUGGESTION_LIMIT}
           ORDER BY is_exact DESC, sim DESC, normalized_name`);
        return result.rows;
      });
      const exact = rows.find((row) => row.is_exact);
      return {
        exact: exact === undefined ? null : toTag(exact),
        similar: rows.filter((row) => !row.is_exact).map(toTag),
      };
    },

    createTag: (actor, name, now) =>
      db.transaction(async (tx) => {
        const display = displayTagName(name);
        const normalized = normalizeTagName(name);
        // Normalizált ütközésnél nincs hiba és nincs esemény: a meglévő sor azonosítója megy vissza (D58, D59 f). Az
        // azonosítót az alkalmazás generálja; a `DO NOTHING` megvárja az egyidejű beszúró commitját, így a következő
        // SELECT látja a sort.
        const inserted = await tx
          .insert(t.tags)
          .values({
            id: randomUUID(),
            name: display,
            normalizedName: normalized,
            createdBy: actor.userId,
            createdAt: now,
          })
          .onConflictDoNothing({ target: t.tags.normalizedName })
          .returning({ id: t.tags.id, name: t.tags.name });
        const created = inserted[0];
        const [existing] =
          created === undefined
            ? await tx
                .select({ id: t.tags.id, name: t.tags.name })
                .from(t.tags)
                .where(eq(t.tags.normalizedName, normalized))
            : [created];
        if (existing === undefined) throw new Error('A címke ütközött, de nem található.');
        // D44: a név (az elsőként létrehozó írásmódja) csak akkor megy ki, ha a hívó látja a címke használatát egy
        // látható, nem törölt dokumentumon; különben a hívó saját írásmódja. A vizsgálat MINDKÉT ágon lefut
        // (azonos lekérdezés-alak), az új címkénél természetesen nincs használat.
        const used = await tx.execute<{ seen: boolean }>(sql`
          SELECT EXISTS (
            SELECT 1 FROM document_tags dt
              JOIN documents ON documents.id = dt.document_id
             WHERE dt.tag_id = ${existing.id}
               AND documents.deleted_at IS NULL
               AND ${visibleDocumentsWhere(actor.userId)}) AS seen`);
        if (created !== undefined) {
          await recordEvent(
            tx,
            { type: 'tag_created', actorId: actor.userId, details: { tagId: created.id } },
            now,
          );
        }
        return { id: existing.id, name: used.rows[0]?.seen === true ? existing.name : display };
      }),

    async listKinds() {
      return db
        .select({ key: t.documentKinds.key, label: t.documentKinds.label })
        .from(t.documentKinds)
        .where(isNull(t.documentKinds.deletedAt))
        .orderBy(asc(t.documentKinds.sortOrder), asc(t.documentKinds.key));
    },

    createKind: (actor, input, now) =>
      db.transaction(async (tx) => {
        const [next] = await tx
          .select({ n: sql<number>`COALESCE(MAX(${t.documentKinds.sortOrder}) + 1, 0)::int` })
          .from(t.documentKinds);
        const inserted = await tx
          .insert(t.documentKinds)
          .values({ key: input.key, label: input.label, sortOrder: next?.n ?? 0 })
          .onConflictDoNothing({ target: t.documentKinds.key })
          .returning({ key: t.documentKinds.key, label: t.documentKinds.label });
        const created = inserted[0];
        if (created === undefined) {
          return fail('validation_error', 'Ilyen kulcsú fajta már létezik.');
        }
        await recordEvent(
          tx,
          { type: 'kind_created', actorId: actor.userId, details: { key: created.key } },
          now,
        );
        return ok(created);
      }),
  };
}
