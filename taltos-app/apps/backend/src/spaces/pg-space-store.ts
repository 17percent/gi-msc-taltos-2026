import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  AdminUser,
  SpaceColor,
  SpaceDetail,
  SpaceMember,
  SpaceSummary,
  SpaceType,
  UserRef,
} from '@taltos/shared';
import * as t from '../db/schema.js';
import { recordEvent, recordEvents } from '../events/record.js';
import { isSystemAdmin } from '../policy/policy.js';
import { visibleSpacesWhere } from '../policy/visibility.js';
import {
  vacateReviewer,
  withdrawAllInSpace,
  withdrawForInitiator,
} from '../review/review-service.js';
import { otherActiveAdminExists, otherActiveManagerExists } from './guards.js';
import { fail, ok, type SpaceStore, type StoreResult } from './store.js';

type Db = NodePgDatabase;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const summaryColumns = {
  id: t.spaces.id,
  name: t.spaces.name,
  type: t.spaces.type,
  description: t.spaces.description,
  color: t.spaces.color,
  closed: sql<boolean>`${t.spaces.closedAt} IS NOT NULL`,
};

function toSummary(row: {
  id: string;
  name: string;
  type: SpaceType;
  description: string | null;
  color: string;
  closed: boolean;
}): SpaceSummary {
  return { ...row, description: row.description ?? '', color: row.color as SpaceColor };
}

/** A `space_members.user_id` PK-előtagon és a `users` PK-n: a tér aktív Színtérgazdái, név szerint. */
async function managersOf(db: Db | Tx, spaceId: string): Promise<UserRef[]> {
  return db
    .select({ id: t.users.id, displayName: t.users.displayName, avatarUrl: t.users.avatarUrl })
    .from(t.spaceMembers)
    .innerJoin(t.users, eq(t.users.id, t.spaceMembers.userId))
    .where(
      and(
        eq(t.spaceMembers.spaceId, spaceId),
        eq(t.spaceMembers.role, 'space_manager'),
        isNull(t.spaceMembers.removedAt),
      ),
    )
    .orderBy(asc(t.users.displayName), asc(t.users.id));
}

async function detailOf(db: Db | Tx, spaceId: string): Promise<SpaceDetail | undefined> {
  const [[row], managers, [count]] = await Promise.all([
    db
      .select(summaryColumns)
      .from(t.spaces)
      .where(and(eq(t.spaces.id, spaceId), isNull(t.spaces.deletedAt)))
      .limit(1),
    managersOf(db, spaceId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.spaceMembers)
      .where(and(eq(t.spaceMembers.spaceId, spaceId), isNull(t.spaceMembers.removedAt))),
  ]);
  return row && { ...toSummary(row), managers, memberCount: count?.n ?? 0 };
}

/** A tér sorának zárolása (B4 S8): a térszabályok (utolsó gazda, lezártság, tagság) ezen sorosodnak. */
async function lockSpace(
  tx: Tx,
  spaceId: string,
): Promise<{ type: SpaceType; closed: boolean } | undefined> {
  const result = await tx.execute<{ type: SpaceType; closed: boolean }>(sql`
    SELECT type, closed_at IS NOT NULL AS closed
      FROM spaces WHERE id = ${spaceId} AND deleted_at IS NULL FOR UPDATE`);
  return result.rows[0];
}

/** Aktív allowlist-bejegyzéssel rendelkező (belépni képes) felhasználó. */
async function activeUserExists(tx: Tx, userId: string): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT 1 FROM users u JOIN allowlist a ON a.email = lower(u.email) AND a.deleted_at IS NULL
     WHERE u.id = ${userId}`);
  return result.rows.length > 0;
}

async function activeMemberRole(tx: Tx, spaceId: string, userId: string) {
  const [row] = await tx
    .select({ role: t.spaceMembers.role })
    .from(t.spaceMembers)
    .where(
      and(
        eq(t.spaceMembers.spaceId, spaceId),
        eq(t.spaceMembers.userId, userId),
        isNull(t.spaceMembers.removedAt),
      ),
    );
  return row?.role;
}

async function memberOf(tx: Tx, spaceId: string, userId: string): Promise<SpaceMember> {
  const [row] = await tx
    .select({
      id: t.users.id,
      displayName: t.users.displayName,
      avatarUrl: t.users.avatarUrl,
      role: t.spaceMembers.role,
    })
    .from(t.spaceMembers)
    .innerJoin(t.users, eq(t.users.id, t.spaceMembers.userId))
    .where(and(eq(t.spaceMembers.spaceId, spaceId), eq(t.spaceMembers.userId, userId)));
  if (!row) throw new Error('A tag a felvétel után nem található.');
  return {
    user: { id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl },
    role: row.role,
  };
}

const isUniqueViolation = (error: unknown, constraint: string): boolean => {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const e = cause as { code?: string; constraint?: string };
  return e.code === '23505' && e.constraint === constraint;
};

const NAME_TAKEN = 'Ilyen nevű színtér már van.';

/** `LIKE` jokerek (`%`, `_`) és a védőkarakter semlegesítése: a keresett szöveg szó szerint értendő. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A színterek, a tagság és a rendszerszerepek PostgreSQL-megvalósítása (`taltos_app` szerepkör: SELECT/INSERT/UPDATE). */
export function createPgSpaceStore(db: Db): SpaceStore {
  return {
    async listSpaces(actor) {
      const base = db.select(summaryColumns).from(t.spaces);
      const rows = await (
        isSystemAdmin(actor)
          ? base.where(isNull(t.spaces.deletedAt))
          : base.where(visibleSpacesWhere(actor.userId))
      ).orderBy(sql`lower(${t.spaces.name})`, asc(t.spaces.id));
      return rows.map(toSummary);
    },

    getSpace: (spaceId) => detailOf(db, spaceId),

    async listMembers(spaceId) {
      const rows = await db
        .select({
          id: t.users.id,
          displayName: t.users.displayName,
          avatarUrl: t.users.avatarUrl,
          role: t.spaceMembers.role,
        })
        .from(t.spaceMembers)
        .innerJoin(t.users, eq(t.users.id, t.spaceMembers.userId))
        .where(and(eq(t.spaceMembers.spaceId, spaceId), isNull(t.spaceMembers.removedAt)))
        .orderBy(asc(t.users.displayName), asc(t.users.id));
      return rows.map((row) => ({
        user: { id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl },
        role: row.role,
      }));
    },

    async createSpace(actor, input, now) {
      try {
        return await db.transaction(async (tx): Promise<StoreResult<SpaceDetail>> => {
          if (!(await activeUserExists(tx, input.initialManagerId))) {
            return fail('validation_error', 'A kezdeti Színtérgazda nem található.');
          }
          const spaceId = randomUUID();
          await tx.insert(t.spaces).values({
            id: spaceId,
            name: input.name,
            type: input.type,
            description: input.description,
            color: input.color,
            createdBy: actor.userId,
            createdAt: now,
          });
          await tx.insert(t.spaceMembers).values({
            spaceId,
            userId: input.initialManagerId,
            role: 'space_manager',
            addedBy: actor.userId,
            createdAt: now,
          });
          await recordEvents(
            tx,
            [
              {
                type: 'space_created',
                spaceId,
                actorId: actor.userId,
                details: { type: input.type, initialManagerId: input.initialManagerId },
              },
              {
                type: 'space_manager_assigned',
                spaceId,
                actorId: actor.userId,
                details: { userId: input.initialManagerId },
              },
            ],
            now,
          );
          const detail = await detailOf(tx, spaceId);
          if (!detail) throw new Error('A létrehozott színtér nem olvasható vissza.');
          return ok(detail);
        });
      } catch (error) {
        if (isUniqueViolation(error, 'spaces_name_lower_uq'))
          return fail('validation_error', NAME_TAKEN);
        throw error;
      }
    },

    async updateSpace(actor, spaceId, patch, now) {
      try {
        return await db.transaction(async (tx): Promise<StoreResult<SpaceDetail>> => {
          const space = await lockSpace(tx, spaceId);
          if (!space) return fail('not_found');
          if (space.closed) return fail('space_closed');
          await tx
            .update(t.spaces)
            .set({
              ...(patch.name === undefined ? {} : { name: patch.name }),
              ...(patch.description === undefined ? {} : { description: patch.description }),
              ...(patch.color === undefined ? {} : { color: patch.color }),
            })
            .where(eq(t.spaces.id, spaceId));
          const fields = (['name', 'description', 'color'] as const).filter(
            (key) => patch[key] !== undefined,
          );
          await recordEvent(
            tx,
            { type: 'space_updated', spaceId, actorId: actor.userId, details: { fields } },
            now,
          );
          const detail = await detailOf(tx, spaceId);
          if (!detail) throw new Error('A módosított színtér nem olvasható vissza.');
          return ok(detail);
        });
      } catch (error) {
        if (isUniqueViolation(error, 'spaces_name_lower_uq'))
          return fail('validation_error', NAME_TAKEN);
        throw error;
      }
    },

    closeSpace: (actor, spaceId, now) =>
      db.transaction(async (tx) => {
        const space = await lockSpace(tx, spaceId);
        if (!space) return fail('not_found');
        if (space.type !== 'project') return fail('forbidden');
        if (space.closed) return ok({ alreadyClosed: true, withdrawnRequests: 0 });
        await tx.update(t.spaces).set({ closedAt: now }).where(eq(t.spaces.id, spaceId));
        const withdrawnRequests = await withdrawAllInSpace(tx, spaceId, now);
        await recordEvent(
          tx,
          { type: 'space_closed', spaceId, actorId: actor.userId, details: { withdrawnRequests } },
          now,
        );
        return ok({ alreadyClosed: false, withdrawnRequests });
      }),

    addMember: (actor, spaceId, input, now) =>
      db.transaction(async (tx): Promise<StoreResult<SpaceMember>> => {
        const space = await lockSpace(tx, spaceId);
        if (!space) return fail('not_found');
        if (space.closed && !isSystemAdmin(actor)) return fail('space_closed');
        if (!(await activeUserExists(tx, input.userId))) {
          return fail('validation_error', 'A felhasználó nem található.');
        }
        const current = await activeMemberRole(tx, spaceId, input.userId);
        if (current !== undefined) {
          // Újrapróbálható: ugyanaz a szerep nem ír és nem naplóz; másik szerep a szerepváltás útja.
          return current === input.role
            ? ok(await memberOf(tx, spaceId, input.userId))
            : fail(
                'validation_error',
                'A felhasználó már tag; a szerepet a szerepváltással kell módosítani.',
              );
        }
        await tx
          .insert(t.spaceMembers)
          .values({
            spaceId,
            userId: input.userId,
            role: input.role,
            addedBy: actor.userId,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [t.spaceMembers.spaceId, t.spaceMembers.userId],
            set: { role: input.role, addedBy: actor.userId, removedAt: null },
          });
        await recordEvent(
          tx,
          {
            type: 'member_added',
            spaceId,
            actorId: actor.userId,
            details: {
              userId: input.userId,
              role: input.role,
              ...(isSystemAdmin(actor) && input.userId === actor.userId
                ? { self_assigned: true as const }
                : {}),
            },
          },
          now,
        );
        return ok(await memberOf(tx, spaceId, input.userId));
      }),

    changeRole: (actor, spaceId, userId, role, now) =>
      db.transaction(async (tx): Promise<StoreResult<SpaceMember>> => {
        const space = await lockSpace(tx, spaceId);
        if (!space) return fail('not_found');
        if (space.closed && !isSystemAdmin(actor)) return fail('space_closed');
        const current = await activeMemberRole(tx, spaceId, userId);
        if (current === undefined) return fail('not_found');
        if (current === role) return ok(await memberOf(tx, spaceId, userId));
        if (current === 'space_manager') {
          const other = await tx.execute<{ other: boolean }>(
            sql`SELECT ${otherActiveManagerExists(sql`${spaceId}`, sql`${userId}`)} AS other`,
          );
          if (!other.rows[0]?.other) return fail('last_space_manager');
        }
        await tx
          .update(t.spaceMembers)
          .set({ role })
          .where(and(eq(t.spaceMembers.spaceId, spaceId), eq(t.spaceMembers.userId, userId)));
        await recordEvent(
          tx,
          {
            type: 'role_changed',
            spaceId,
            actorId: actor.userId,
            details: { userId, from: current, to: role },
          },
          now,
        );
        return ok(await memberOf(tx, spaceId, userId));
      }),

    removeMember: (actor, spaceId, userId, now) =>
      db.transaction(async (tx): Promise<StoreResult<null>> => {
        const space = await lockSpace(tx, spaceId);
        if (!space) return fail('not_found');
        if (space.type === 'general') return fail('forbidden');
        if (space.closed && !isSystemAdmin(actor)) return fail('space_closed');
        const current = await activeMemberRole(tx, spaceId, userId);
        if (current === undefined) return fail('not_found');
        if (current === 'space_manager') {
          const other = await tx.execute<{ other: boolean }>(
            sql`SELECT ${otherActiveManagerExists(sql`${spaceId}`, sql`${userId}`)} AS other`,
          );
          if (!other.rows[0]?.other) return fail('last_space_manager');
        }
        // Tulajdonos-védelem: csak az archiválatlan dokumentumokat számoljuk (documents_owner_idx, D56).
        const owns = await tx.execute(sql`
          SELECT 1 FROM documents
           WHERE owner_id = ${userId} AND space_id = ${spaceId} AND deleted_at IS NULL LIMIT 1`);
        if (owns.rows.length > 0) return fail('owner_handover_required');

        await withdrawForInitiator(tx, spaceId, userId, actor.userId, now);
        await vacateReviewer(
          tx,
          { userId, spaceId, actorId: actor.userId, reason: 'member_removed' },
          now,
        );
        await tx
          .update(t.spaceMembers)
          .set({ removedAt: now })
          .where(and(eq(t.spaceMembers.spaceId, spaceId), eq(t.spaceMembers.userId, userId)));
        await recordEvent(
          tx,
          { type: 'member_removed', spaceId, actorId: actor.userId, details: { userId } },
          now,
        );
        return ok(null);
      }),

    transferOwnership: (actor, input, now) =>
      db.transaction(async (tx): Promise<StoreResult<null>> => {
        // Az eldobott piszkozat nem létezik; az archivált átadható (D54).
        const located = await tx.execute<{ space_id: string }>(sql`
          SELECT space_id FROM documents
           WHERE id = ${input.documentId} AND (deleted_at IS NULL OR approved_revision_id IS NOT NULL)`);
        const spaceId = located.rows[0]?.space_id;
        if (spaceId === undefined) return fail('not_found');
        const space = await lockSpace(tx, spaceId);
        if (!space) return fail('not_found');
        if (space.closed) return fail('space_closed');
        const doc = await tx.execute<{ owner_id: string }>(
          sql`SELECT owner_id FROM documents WHERE id = ${input.documentId} FOR UPDATE`,
        );
        const ownerId = doc.rows[0]?.owner_id;
        if (ownerId === undefined) return fail('not_found');
        // A döntés óta változhatott a tulajdonos: a jogosultságot a zár alatt újra ellenőrizzük.
        if (ownerId !== actor.userId && !input.actorIsManager) return fail('forbidden');
        if (input.newOwnerId === ownerId) {
          return fail('invalid_new_owner', 'Az új tulajdonos már most is a tulajdonos.');
        }
        if ((await activeMemberRole(tx, spaceId, input.newOwnerId)) === undefined) {
          return fail('invalid_new_owner', 'Az új tulajdonos nem a színtér aktív tagja.');
        }
        await tx
          .update(t.documents)
          .set({ ownerId: input.newOwnerId })
          .where(eq(t.documents.id, input.documentId));
        await recordEvent(
          tx,
          {
            type: 'owner_changed',
            spaceId,
            documentId: input.documentId,
            actorId: actor.userId,
            details: { from: ownerId, to: input.newOwnerId, reason: 'handover' },
          },
          now,
        );
        return ok(null);
      }),

    adminHandover: (actor, input, now) =>
      db.transaction(async (tx): Promise<StoreResult<{ movedDocuments: number }>> => {
        const space = await lockSpace(tx, input.spaceId);
        if (!space) return fail('not_found');
        const [source] = await tx
          .select({ id: t.users.id })
          .from(t.users)
          .where(eq(t.users.id, input.userId));
        if (!source) return fail('not_found');
        if (input.newOwnerId === input.userId) {
          return fail('invalid_new_owner', 'Az új tulajdonos azonos a mostanival.');
        }
        if ((await activeMemberRole(tx, input.spaceId, input.newOwnerId)) === undefined) {
          return fail('invalid_new_owner', 'Az új tulajdonos nem a színtér aktív tagja.');
        }
        // Egy set-alapú UPDATE az összes (archivált is) dokumentumra; lezárt térben is megy (D56).
        const moved = await tx
          .update(t.documents)
          .set({ ownerId: input.newOwnerId })
          .where(and(eq(t.documents.spaceId, input.spaceId), eq(t.documents.ownerId, input.userId)))
          .returning({ id: t.documents.id });
        await recordEvents(
          tx,
          moved.map((row) => ({
            type: 'owner_changed' as const,
            spaceId: input.spaceId,
            documentId: row.id,
            actorId: actor.userId,
            details: {
              from: input.userId,
              to: input.newOwnerId,
              reason: 'admin_handover' as const,
            },
          })),
          now,
        );
        return ok({ movedDocuments: moved.length });
      }),

    async searchUsers(query, limit) {
      const rows = await db.execute<{
        id: string;
        display_name: string;
        avatar_url: string | null;
      }>(sql`
        SELECT u.id, u.display_name, u.avatar_url
          FROM users u
          JOIN allowlist a ON a.email = lower(u.email) AND a.deleted_at IS NULL
         WHERE u.display_name ILIKE '%' || ${escapeLike(query)} || '%' ESCAPE '\\'
         ORDER BY u.display_name, u.id
         LIMIT ${limit}`);
      return rows.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      }));
    },

    async listAdminUsers() {
      const rows = await db
        .select({
          id: t.users.id,
          displayName: t.users.displayName,
          avatarUrl: t.users.avatarUrl,
          email: t.users.email,
          systemRole: t.users.systemRole,
          lastLoginAt: t.users.lastLoginAt,
        })
        .from(t.users)
        .orderBy(asc(t.users.displayName), asc(t.users.id));
      return rows.map(toAdminUser);
    },

    changeSystemRole: (actor, userId, systemRole, now) =>
      db.transaction(async (tx): Promise<StoreResult<AdminUser>> => {
        // Az összes admin-sor zárolása id szerint (B4 S8), majd a célsor: így két egyidejű lefokozás sorosodik.
        await tx.execute(
          sql`SELECT id FROM users WHERE system_role = 'system_admin' ORDER BY id FOR UPDATE`,
        );
        const [target] = await tx
          .select({
            id: t.users.id,
            displayName: t.users.displayName,
            avatarUrl: t.users.avatarUrl,
            email: t.users.email,
            systemRole: t.users.systemRole,
            lastLoginAt: t.users.lastLoginAt,
          })
          .from(t.users)
          .where(eq(t.users.id, userId))
          .for('update');
        if (!target) return fail('not_found');
        if (target.systemRole === systemRole) return ok(toAdminUser(target));
        if (systemRole === 'user') {
          const other = await tx.execute<{ other: boolean }>(
            sql`SELECT ${otherActiveAdminExists(sql`${userId}`)} AS other`,
          );
          if (!other.rows[0]?.other) return fail('last_admin');
        }
        await tx.update(t.users).set({ systemRole }).where(eq(t.users.id, userId));
        await recordEvent(
          tx,
          {
            type: systemRole === 'system_admin' ? 'system_admin_granted' : 'system_admin_revoked',
            actorId: actor.userId,
            details: { userId },
          },
          now,
        );
        return ok(toAdminUser({ ...target, systemRole }));
      }),
  };
}

function toAdminUser(row: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  systemRole: AdminUser['systemRole'];
  lastLoginAt: Date | null;
}): AdminUser {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    email: row.email ?? '',
    systemRole: row.systemRole,
    lastLoginAt: row.lastLoginAt === null ? null : row.lastLoginAt.toISOString(),
  };
}
