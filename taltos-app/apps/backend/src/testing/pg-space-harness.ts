import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { TestDb } from '../db/test-db.js';
import { createPgSpaceStore } from '../spaces/pg-space-store.js';
import type { StoreHarness } from '../spaces/space-store-contract.js';

/** Replica módú (triggerek nélküli) munkamenet a fixture-íráshoz és a takarításhoz. */
export async function withReplica<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SET session_replication_role = replica');
    return await fn(client);
  } finally {
    await client.query('SET session_replication_role = DEFAULT');
    client.release();
  }
}

/**
 * A `StoreHarness` PostgreSQL-megvalósítása (integrációs tesztekhez): a fixture-t a superuser írja replica módban
 * (FK és trigger nélkül, a CHECK-ek érvényesek), a tárat az app-szerepkörű kapcsolat hívja.
 */
export function pgHarness(db: TestDb): StoreHarness {
  const admin = <T extends object = object>(sql: string, params: unknown[] = []) =>
    db.admin.query<T>(sql, params);
  const placeholder = randomUUID(); // `created_by` a fixture-ben (az FK replica módban nem ellenőrzött)
  return {
    store: createPgSpaceStore(drizzle(db.app)),
    async user(name, options = {}) {
      const id = randomUUID();
      const email = `${randomUUID()}@example.test`;
      await admin(
        'INSERT INTO users (id, display_name, email, system_role) VALUES ($1, $2, $3, $4)',
        [id, name, email, options.admin ? 'system_admin' : 'user'],
      );
      if (options.allowlisted ?? true)
        await admin('INSERT INTO allowlist (email) VALUES ($1)', [email]);
      return id;
    },
    async space(options = {}) {
      const id = randomUUID();
      const type = options.type ?? (options.closed ? 'project' : 'team');
      await admin(
        `INSERT INTO spaces (id, name, type, color, created_by, closed_at)
         VALUES ($1, $2, $3, '#3B6FB6', $4, ${options.closed ? 'now()' : 'NULL'})`,
        [id, `tér-${id}`, type, placeholder],
      );
      return id;
    },
    async member(spaceId, userId, role = 'author') {
      await admin(
        'INSERT INTO space_members (space_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)',
        [spaceId, userId, role, userId],
      );
    },
    async document(spaceId, ownerId, options = {}) {
      const id = randomUUID();
      await withReplica(db.admin, async (c) => {
        await c.query(
          `INSERT INTO documents (id, space_id, slug, title, kind, owner_id, created_by, review_state,
                                  approved_revision_id, deleted_at)
           VALUES ($1, $2, $3, 'Cím', 'prompt', $4, $4, $5, $6, ${options.archived ? 'now()' : 'NULL'})`,
          [
            id,
            spaceId,
            `d-${id}`,
            ownerId,
            options.pending ? 'pending' : 'draft',
            options.archived ? randomUUID() : null,
          ],
        );
        if (options.pending) {
          const crId = randomUUID();
          await c.query(
            `INSERT INTO change_requests (id, document_id, kind, proposed_revision_id, proposed_review_due_at, initiator_id)
             VALUES ($1, $2, 'update', $3, now() + interval '1 year', $4)`,
            [crId, id, randomUUID(), options.pending.initiatorId],
          );
          for (const reviewer of options.pending.reviewers) {
            const decided = options.pending.decided?.includes(reviewer) ?? false;
            await c.query(
              `INSERT INTO change_request_reviewers (change_request_id, reviewer_id, decision, decided_at)
               VALUES ($1, $2, ${decided ? "'approved', now()" : 'NULL, NULL'})`,
              [crId, reviewer],
            );
          }
        }
      });
      return id;
    },
    async events(spaceId) {
      const { rows } = await admin<{
        type: string;
        actor_id: string | null;
        document_id: string | null;
        reason: string | null;
      }>(
        `SELECT type, actor_id, document_id, details->>'reason' AS reason
           FROM events WHERE space_id = $1 ORDER BY id`,
        [spaceId],
      );
      return rows.map((r) => ({
        type: r.type,
        actorId: r.actor_id,
        ...(r.document_id === null ? {} : { documentId: r.document_id }),
        ...(r.reason === null ? {} : { reason: r.reason }),
      }));
    },
    async owner(id) {
      const { rows } = await admin<{ owner_id: string }>(
        'SELECT owner_id FROM documents WHERE id = $1',
        [id],
      );
      return rows[0]?.owner_id as string;
    },
    async reviewState(id) {
      const { rows } = await admin<{ review_state: string }>(
        'SELECT review_state FROM documents WHERE id = $1',
        [id],
      );
      return rows[0]?.review_state as string;
    },
    async activeReviewers(id) {
      const { rows } = await admin<{ reviewer_id: string }>(
        `SELECT r.reviewer_id FROM change_request_reviewers r
           JOIN change_requests c ON c.id = r.change_request_id
          WHERE c.document_id = $1 AND c.state = 'pending' AND r.ended_at IS NULL`,
        [id],
      );
      return rows.map((r) => r.reviewer_id);
    },
    async isMember(spaceId, userId) {
      const { rows } = await admin(
        'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2 AND removed_at IS NULL',
        [spaceId, userId],
      );
      return rows.length > 0;
    },
  };
}
