import { and, asc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as t from '../db/schema.js';
import { canRequestMembership, type AccessStore } from './access-store.js';

/**
 * A jogosultság-adatok PostgreSQL-megvalósítása (a `taltos_app` szerepkörrel, csak olvasás).
 * Idő és tér: kérésenként egy betöltés, csupa elsődleges kulcs szerinti illesztés (`spaces` PK, `space_members` PK
 * vagy a `space_members_active_idx`), csak a döntéshez kellő oszlopokkal; nincs N+1.
 */
export function createPgAccessStore(db: NodePgDatabase): AccessStore {
  return {
    async spaceTarget(userId, spaceId) {
      const [row] = await db
        .select({
          type: t.spaces.type,
          closed: sql<boolean>`${t.spaces.closedAt} IS NOT NULL`,
          membership: t.spaceMembers.role,
        })
        .from(t.spaces)
        .leftJoin(
          t.spaceMembers,
          and(
            eq(t.spaceMembers.spaceId, t.spaces.id),
            eq(t.spaceMembers.userId, userId),
            isNull(t.spaceMembers.removedAt),
          ),
        )
        .where(and(eq(t.spaces.id, spaceId), isNull(t.spaces.deletedAt)))
        .limit(1);
      return row && { spaceId, ...row };
    },

    // Egyetlen lekérdezés: documents → spaces (PK) → space_members (PK) → a függő kérés (részleges egyedi index:
    // change_requests_one_pending_uq) és egy EXISTS a review-er helyre. Az eldobott piszkozat (törölt, jóváhagyott
    // változat nélkül) nem betölthető; az archivált igen (tulajdonjog-átadás archivált dokumentumon is megy, D54).
    async documentTarget(userId, documentId) {
      const [row] = await db
        .select({
          spaceId: t.documents.spaceId,
          ownerId: t.documents.ownerId,
          reviewState: t.documents.reviewState,
          archived: sql<boolean>`${t.documents.deletedAt} IS NOT NULL`,
          spaceType: t.spaces.type,
          spaceClosed: sql<boolean>`${t.spaces.closedAt} IS NOT NULL`,
          membership: t.spaceMembers.role,
          initiatorId: t.changeRequests.initiatorId,
          isDesignatedReviewer: sql<boolean>`EXISTS (
            SELECT 1 FROM ${t.changeRequestReviewers}
             WHERE ${t.changeRequestReviewers.changeRequestId} = ${t.changeRequests.id}
               AND ${t.changeRequestReviewers.reviewerId} = ${userId}
               AND ${t.changeRequestReviewers.endedAt} IS NULL)`,
        })
        .from(t.documents)
        .innerJoin(t.spaces, eq(t.spaces.id, t.documents.spaceId))
        .leftJoin(
          t.spaceMembers,
          and(
            eq(t.spaceMembers.spaceId, t.documents.spaceId),
            eq(t.spaceMembers.userId, userId),
            isNull(t.spaceMembers.removedAt),
          ),
        )
        .leftJoin(
          t.changeRequests,
          and(
            eq(t.changeRequests.documentId, t.documents.id),
            eq(t.changeRequests.state, 'pending'),
          ),
        )
        .where(
          and(
            eq(t.documents.id, documentId),
            isNull(t.spaces.deletedAt),
            or(isNull(t.documents.deletedAt), isNotNull(t.documents.approvedRevisionId)),
          ),
        )
        .limit(1);
      if (!row) return undefined;
      return {
        documentId,
        space: {
          spaceId: row.spaceId,
          type: row.spaceType,
          closed: row.spaceClosed,
          membership: row.membership,
        },
        ownerId: row.ownerId,
        archived: row.archived,
        reviewState: row.reviewState,
        ...(row.initiatorId === null
          ? {}
          : { initiatorId: row.initiatorId, isDesignatedReviewer: row.isDesignatedReviewer }),
      };
    },

    // Csak elutasításkor fut: a színtér PK-ja, a gazdák a space_members PK-előtagján (space_id), a függő kérés a
    // részleges egyedi indexen. Három kis, egymástól független lekérdezés, párhuzamosan. Cím, darabszám nincs.
    async denialDetails(actor, spaceId) {
      const [space, managers, pending] = await Promise.all([
        db
          .select({
            id: t.spaces.id,
            name: t.spaces.name,
            closed: sql<boolean>`${t.spaces.closedAt} IS NOT NULL`,
          })
          .from(t.spaces)
          .where(and(eq(t.spaces.id, spaceId), isNull(t.spaces.deletedAt)))
          .limit(1),
        db
          .select({
            id: t.users.id,
            displayName: t.users.displayName,
            avatarUrl: t.users.avatarUrl,
          })
          .from(t.spaceMembers)
          .innerJoin(t.users, eq(t.users.id, t.spaceMembers.userId))
          .where(
            and(
              eq(t.spaceMembers.spaceId, spaceId),
              eq(t.spaceMembers.role, 'space_manager'),
              isNull(t.spaceMembers.removedAt),
            ),
          )
          .orderBy(asc(t.users.displayName), asc(t.users.id)),
        db
          .select({ one: sql<number>`1` })
          .from(t.membershipRequests)
          .where(
            and(
              eq(t.membershipRequests.spaceId, spaceId),
              eq(t.membershipRequests.userId, actor.userId),
              eq(t.membershipRequests.state, 'pending'),
            ),
          )
          .limit(1),
      ]);
      const found = space[0];
      if (!found) return undefined;
      return {
        space: { id: found.id, name: found.name },
        managers,
        canRequestMembership: canRequestMembership({
          systemRole: actor.systemRole,
          closed: found.closed,
          hasPendingRequest: pending.length > 0,
        }),
      };
    },
  };
}
