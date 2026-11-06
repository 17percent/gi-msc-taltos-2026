import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  ApprovedMetadata,
  DocumentDetail,
  HiddenLink,
  RevisionLink,
  SpaceType,
  TagRef,
} from '@taltos/shared';
import * as t from '../db/schema.js';
import { recordEvents } from '../events/record.js';
import type { AppEvent } from '../events/types.js';
import { can } from '../policy/policy.js';
import type { SpaceTarget } from '../policy/targets.js';
import { visibleDocumentsWhere } from '../policy/visibility.js';
import type { ReviewState } from '../realtime/collab-store.js';
import { discardDraft } from '../review/review-service.js';
import { fail, ok, type StoreResult } from '../spaces/store.js';
import { firstRevisionMetadata, readRevisionMetadata } from './metadata.js';
import { SLUG_ATTEMPTS, slugAttempt, slugify } from './slug.js';
import type { DocumentStore } from './store.js';

type Db = NodePgDatabase;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * A tér sorának OSZTOTT zára (`FOR SHARE`) és a hívó tagsága, a `can()` célpontjaként. Az osztott zár a létrehozásokat
 * és az eldobásokat nem sorosítja egymással, de kizárja a közben futó lezárást (`FOR UPDATE`, B4 S8) és a
 * tagság-visszavonást: a döntés a zár alatt ugyanaz, amit a tranzakció végéig tartó állapot mellett kell hozni.
 * Két utasítás, mert egy `READ COMMITTED` utasítás pillanatképe a zárra várás előtt készül: a tagságot a zár UTÁN olvassuk.
 */
async function lockSpaceShared(
  tx: Tx,
  userId: string,
  spaceId: string,
): Promise<SpaceTarget | undefined> {
  const locked = await tx.execute<{ type: SpaceType; closed: boolean }>(sql`
    SELECT type, closed_at IS NOT NULL AS closed
      FROM spaces WHERE id = ${spaceId} AND deleted_at IS NULL FOR SHARE`);
  const space = locked.rows[0];
  if (space === undefined) return undefined;
  const [member] = await tx
    .select({ role: t.spaceMembers.role })
    .from(t.spaceMembers)
    .where(
      and(
        eq(t.spaceMembers.spaceId, spaceId),
        eq(t.spaceMembers.userId, userId),
        isNull(t.spaceMembers.removedAt),
      ),
    );
  return { spaceId, type: space.type, closed: space.closed, membership: member?.role ?? null };
}

/** A címke-azonosítók neve, a kért sorrendben (a metaadat-pillanatkép azonosítóinak névfeloldása). */
async function tagRefs(db: Db | Tx, ids: readonly string[]): Promise<TagRef[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: t.tags.id, name: t.tags.name })
    .from(t.tags)
    .where(inArray(t.tags.id, [...ids]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * A pillanatkép kapcsolatainak feloldása a néző láthatósága szerint (D44, B5 `/links`): a látható célpont marad, a
 * nem látható (idegen színtér, eldobott) `{ hidden, spaceId }` lesz, azonosító és cím nélkül. Egy lekérdezés a
 * célpontok PK-ján; a láthatóság a `visibleDocumentsWhere`-ből. A már nem létező célpont kimarad.
 */
async function resolveLinks(
  db: Db | Tx,
  viewerId: string,
  links: readonly RevisionLink[],
): Promise<(RevisionLink | HiddenLink)[]> {
  if (links.length === 0) return [];
  const rows = await db
    .select({
      id: t.documents.id,
      spaceId: t.documents.spaceId,
      visible: sql<boolean>`(${t.documents.deletedAt} IS NULL OR ${t.documents.approvedRevisionId} IS NOT NULL)
        AND ${visibleDocumentsWhere(viewerId)}`,
    })
    .from(t.documents)
    .where(inArray(t.documents.id, [...new Set(links.map((link) => link.toId))]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return links.flatMap((link): (RevisionLink | HiddenLink)[] => {
    const target = byId.get(link.toId);
    if (target === undefined) return [];
    return [target.visible ? link : { hidden: true, spaceId: target.spaceId }];
  });
}

/**
 * A dokumentum élő metaadata és állapota a LÁTHATÓ dokumentumok feltételén át (D44). Az archivált dokumentum
 * betöltődik (olvasható, D54), az eldobott piszkozat nem. Idő: dokumentum PK + `users` PK + a láthatósági EXISTS
 * (`space_members_active_idx`); a címkék a `document_tags` PK-előtagján; a Jóváhagyott revízió PK-n, a nevek `tags` PK-n.
 */
async function loadDetail(
  db: Db | Tx,
  viewerId: string,
  documentId: string,
): Promise<DocumentDetail | undefined> {
  const [row] = await db
    .select({
      id: t.documents.id,
      spaceId: t.documents.spaceId,
      slug: t.documents.slug,
      title: t.documents.title,
      kind: t.documents.kind,
      ownerId: t.documents.ownerId,
      ownerName: t.users.displayName,
      ownerAvatar: t.users.avatarUrl,
      reviewState: t.documents.reviewState,
      approvedRevisionId: t.documents.approvedRevisionId,
      iteration: t.documents.iteration,
      archived: sql<boolean>`${t.documents.deletedAt} IS NOT NULL`,
      createdAt: t.documents.createdAt,
      updatedAt: t.documents.updatedAt,
    })
    .from(t.documents)
    .innerJoin(t.users, eq(t.users.id, t.documents.ownerId))
    .where(
      and(
        eq(t.documents.id, documentId),
        or(isNull(t.documents.deletedAt), isNotNull(t.documents.approvedRevisionId)),
        visibleDocumentsWhere(viewerId),
      ),
    )
    .limit(1);
  if (row === undefined) return undefined;

  const tags = await db
    .select({ id: t.tags.id, name: t.tags.name })
    .from(t.documentTags)
    .innerJoin(t.tags, eq(t.tags.id, t.documentTags.tagId))
    .where(eq(t.documentTags.documentId, documentId))
    .orderBy(asc(t.tags.name), asc(t.tags.id));

  let approvedMetadata: ApprovedMetadata | null = null;
  if (row.approvedRevisionId !== null) {
    const [revision] = await db
      .select({ title: t.documentRevisions.title, metadata: t.documentRevisions.metadata })
      .from(t.documentRevisions)
      .where(
        and(
          eq(t.documentRevisions.id, row.approvedRevisionId),
          eq(t.documentRevisions.documentId, documentId),
        ),
      );
    if (revision !== undefined) {
      const metadata = readRevisionMetadata(revision.metadata);
      approvedMetadata = {
        revisionId: row.approvedRevisionId,
        title: revision.title,
        kind: metadata.kind,
        tags: await tagRefs(db, metadata.tagIds),
        links: await resolveLinks(db, viewerId, metadata.links),
      };
    }
  }

  return {
    id: row.id,
    spaceId: row.spaceId,
    slug: row.slug,
    title: row.title,
    kind: row.kind,
    owner: { id: row.ownerId, displayName: row.ownerName, avatarUrl: row.ownerAvatar },
    reviewState: row.reviewState,
    approvedRevisionId: row.approvedRevisionId,
    iteration: row.iteration,
    archived: row.archived,
    tags,
    approvedMetadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A dokumentum-mag PostgreSQL-megvalósítása (WP5a, `taltos_app` szerepkör: SELECT/INSERT/UPDATE; a `document_revisions`
 * és az `events` csak INSERT). Az `approved_revision_id`-t, az `iteration`-t és a `deleted_at`-et NEM írja: az első
 * revízió nem véglegesít (D59 d), az eldobás a `ReviewService`-ben él (B4 S13).
 */
export function createPgDocumentStore(db: Db): DocumentStore {
  return {
    createDocument: (actor, input, now) =>
      db.transaction(async (tx): Promise<StoreResult<DocumentDetail>> => {
        const space = await lockSpaceShared(tx, actor.userId, input.spaceId);
        if (space === undefined) return fail('not_found');
        const decision = can(actor, 'document.create', space);
        if (!decision.ok) return fail(decision.code);

        const [kind] = await tx
          .select({ key: t.documentKinds.key })
          .from(t.documentKinds)
          .where(and(eq(t.documentKinds.key, input.kind), isNull(t.documentKinds.deletedAt)));
        if (kind === undefined) {
          return fail('validation_error', 'Ismeretlen vagy törölt fajta.');
        }
        const tagIds = [...new Set(input.tagIds)];
        if (tagIds.length > 0) {
          const found = await tx
            .select({ id: t.tags.id })
            .from(t.tags)
            .where(inArray(t.tags.id, tagIds));
          if (found.length !== tagIds.length) {
            return fail('validation_error', 'Ismeretlen címke-azonosító.');
          }
        }

        // A forrás betöltése a LÁTHATÓSÁGI feltétellel (D44): a Jóváhagyott revízió tartalma, ha van, különben az élő.
        // Az archivált forrás is jó, az eldobott piszkozat nem; a nem tag számára a forrás nem létezik.
        let content = '';
        let source: { spaceId: string; revisionId: string | null } | undefined;
        if (input.sourceDocumentId !== undefined) {
          const loaded = await tx.execute<{
            space_id: string;
            content: string;
            revision_id: string | null;
          }>(sql`
            SELECT documents.space_id,
                   COALESCE(r.content, documents.content) AS content,
                   documents.approved_revision_id AS revision_id
              FROM documents
              LEFT JOIN document_revisions r
                     ON r.id = documents.approved_revision_id AND r.document_id = documents.id
             WHERE documents.id = ${input.sourceDocumentId}
               AND (documents.deleted_at IS NULL OR documents.approved_revision_id IS NOT NULL)
               AND ${visibleDocumentsWhere(actor.userId)}`);
          const row = loaded.rows[0];
          if (row === undefined) return fail('not_found');
          content = row.content;
          source = { spaceId: row.space_id, revisionId: row.revision_id };
        }

        // Az azonosítót az alkalmazás generálja. A slug a címből; ütközésnél (a `documents_space_slug_uq` az
        // archiváltakra is érvényes) rövid utótaggal, `ON CONFLICT DO NOTHING`, így a tranzakció nem szakad meg.
        const id = randomUUID();
        const base = slugify(input.title);
        let inserted = false;
        for (let attempt = 0; attempt < SLUG_ATTEMPTS && !inserted; attempt += 1) {
          const rows = await tx
            .insert(t.documents)
            .values({
              id,
              spaceId: input.spaceId,
              slug: slugAttempt(base, attempt),
              title: input.title,
              kind: kind.key,
              ownerId: actor.userId,
              content,
              createdBy: actor.userId,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing({ target: [t.documents.spaceId, t.documents.slug] })
            .returning({ id: t.documents.id });
          inserted = rows.length > 0;
        }
        if (!inserted) throw new Error('A slug-ütközés nem oldódott fel a kísérletek alatt.');

        // Első revízió (D59 d): tartalom + metaadat-pillanatkép; nem véglegesít (nincs `approved_revision_id`).
        await tx.insert(t.documentRevisions).values({
          id: randomUUID(),
          documentId: id,
          title: input.title,
          content,
          metadata: firstRevisionMetadata({
            kind: kind.key,
            tagIds,
            sourceDocumentId: input.sourceDocumentId,
          }),
          authorId: actor.userId,
          createdAt: now,
        });
        // A `tag_text`-et a `document_tags` triggere állítja, ugyanebben a tranzakcióban (B4 S9): az alkalmazás nem írja.
        if (tagIds.length > 0) {
          await tx
            .insert(t.documentTags)
            .values(tagIds.map((tagId) => ({ documentId: id, tagId })));
        }
        const events: AppEvent[] = [
          {
            type: 'created',
            spaceId: input.spaceId,
            documentId: id,
            actorId: actor.userId,
            details: {},
          },
        ];
        if (source !== undefined && input.sourceDocumentId !== undefined) {
          await tx.insert(t.documentLinks).values({
            id: randomUUID(),
            fromId: id,
            toId: input.sourceDocumentId,
            type: 'szarmazik',
            createdBy: actor.userId,
            createdAt: now,
          });
          events.push(
            {
              type: 'duplicated_from',
              spaceId: input.spaceId,
              documentId: id,
              actorId: actor.userId,
              details: {
                sourceDocumentId: input.sourceDocumentId,
                sourceSpaceId: source.spaceId,
                sourceRevisionId: source.revisionId,
              },
            },
            {
              type: 'duplicated_from',
              spaceId: source.spaceId,
              documentId: input.sourceDocumentId,
              actorId: actor.userId,
              details: { targetDocumentId: id, targetSpaceId: input.spaceId },
            },
          );
        }
        await recordEvents(tx, events, now);

        const detail = await loadDetail(tx, actor.userId, id);
        if (detail === undefined) throw new Error('A létrehozott dokumentum nem tölthető be.');
        return ok(detail);
      }),

    getDocument: (viewerId, documentId) => loadDetail(db, viewerId, documentId),

    discardDraft: (actor, documentId, now) =>
      db.transaction(async (tx): Promise<StoreResult<null>> => {
        const located = await tx.execute<{ space_id: string }>(sql`
          SELECT space_id FROM documents
           WHERE id = ${documentId} AND (deleted_at IS NULL OR approved_revision_id IS NOT NULL)`);
        const spaceId = located.rows[0]?.space_id;
        if (spaceId === undefined) return fail('not_found');
        const space = await lockSpaceShared(tx, actor.userId, spaceId);
        if (space === undefined) return fail('not_found');
        // A dokumentum sorának zára (térzár UTÁN: zársorrend tér → dokumentum), KÜLÖN utasításban. Egy beküldés a
        // `change_requests` INSERT-jével az FK miatt csak `FOR KEY SHARE`-t vesz a soron, ami a `FOR UPDATE`-tel ütközik:
        // az eldobás megvárja a beküldés commitját, és az ezt követő feltételes UPDATE (új utasítás, friss pillanatkép)
        // már látja a kérést. Zár nélkül az UPDATE EvalPlanQual-újraellenőrzése a régi pillanatképet használná a
        // `NOT EXISTS (change_requests)` részlekérdezésre. A zárolt sor tulajdonosával dönt újra a `can()`: az
        // egyidejű tulajdonjog-átadás után a volt tulajdonos nem dobhatja el.
        const locked = await tx.execute<{
          owner_id: string;
          review_state: ReviewState;
          archived: boolean;
        }>(sql`
          SELECT owner_id, review_state, deleted_at IS NOT NULL AS archived
            FROM documents WHERE id = ${documentId} FOR UPDATE`);
        const doc = locked.rows[0];
        if (doc === undefined) return fail('not_found');
        const decision = can(actor, 'document.draft.discard', {
          documentId,
          space,
          ownerId: doc.owner_id,
          archived: doc.archived,
          reviewState: doc.review_state,
        });
        if (!decision.ok) return fail(decision.code);
        const result = await discardDraft(tx, { documentId, actorId: actor.userId }, now);
        return result.ok ? ok(null) : fail(result.reason);
      }),
  };
}
