import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as t from '../db/schema.js';
import { WRITABLE_REVIEW_STATES, type CollabStore } from './collab-store.js';

/** A `/collab` PostgreSQL-megvalósítása (a `taltos_app` szerepkörrel: SELECT/INSERT/UPDATE elég, a 0005 migráció szerint). */
export function createPgCollabStore(db: NodePgDatabase): CollabStore {
  return {
    // Egyetlen lekérdezés, csupa elsődleges kulcs szerinti illesztés (documents, spaces, space_members PK); nincs N+1.
    // Nem létező, törölt és nem tag ugyanúgy nulla sor: a hívó nem tud különbséget tenni (nincs cím- vagy létezés-szivárgás).
    async findAccess(userId, documentId) {
      const [row] = await db
        .select({
          reviewState: t.documents.reviewState,
          spaceClosed: sql<boolean>`${t.spaces.closedAt} IS NOT NULL`,
        })
        .from(t.documents)
        .innerJoin(t.spaces, eq(t.spaces.id, t.documents.spaceId))
        .innerJoin(
          t.spaceMembers,
          and(
            eq(t.spaceMembers.spaceId, t.documents.spaceId),
            eq(t.spaceMembers.userId, userId),
            isNull(t.spaceMembers.removedAt),
          ),
        )
        .where(
          and(
            eq(t.documents.id, documentId),
            isNull(t.documents.deletedAt),
            isNull(t.spaces.deletedAt),
          ),
        )
        .limit(1);
      return row;
    },

    // A szöveget csak akkor olvassuk, ha nincs Yjs-állapot (a seedeléshez); különben az oszlop érintetlen marad.
    async loadContent(documentId) {
      const [row] = await db
        .select({
          state: t.documentCollabState.state,
          seed: sql<
            string | null
          >`CASE WHEN ${t.documentCollabState.state} IS NULL THEN ${t.documents.content} END`,
        })
        .from(t.documents)
        .leftJoin(t.documentCollabState, eq(t.documentCollabState.documentId, t.documents.id))
        .where(and(eq(t.documents.id, documentId), isNull(t.documents.deletedAt)))
        .limit(1);
      return row;
    },

    // Az UPDATE sorzárat vesz a dokumentumon: a feltétel (írható állapot, élő és nem lezárt színtér) ugyanabban a
    // tranzakcióban dől el, mint az írás, így egy közbeni állapotváltás (pl. review-ra küldés) nem csúszhat át.
    // A WP6 revízió-, checkpoint- és eseményírása és a pending_contributors itt szándékosan nincs.
    async saveContent(documentId, state, text, now) {
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(t.documents)
          .set({ content: text, updatedAt: now })
          .where(
            and(
              eq(t.documents.id, documentId),
              isNull(t.documents.deletedAt),
              inArray(t.documents.reviewState, [...WRITABLE_REVIEW_STATES]),
              sql`EXISTS (SELECT 1 FROM ${t.spaces}
                           WHERE ${t.spaces.id} = ${t.documents.spaceId}
                             AND ${t.spaces.closedAt} IS NULL AND ${t.spaces.deletedAt} IS NULL)`,
            ),
          )
          .returning({ id: t.documents.id });
        if (updated.length === 0) return false;
        await tx
          .insert(t.documentCollabState)
          .values({ documentId, state: Buffer.from(state), lastEditAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: t.documentCollabState.documentId,
            set: { state: sql`excluded.state`, lastEditAt: now, updatedAt: now },
          });
        return true;
      });
    },
  };
}
