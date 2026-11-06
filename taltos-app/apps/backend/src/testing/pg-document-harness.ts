import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { displayTagName, normalizeTagName, type SystemRole } from '@taltos/shared';
import type { TestDb } from '../db/test-db.js';
import type { DocumentHarness } from '../documents/document-store-contract.js';
import { createPgDocumentStore } from '../documents/pg-document-store.js';
import { createPgTagStore } from '../tags/pg-tag-store.js';
import { withReplica } from './pg-space-harness.js';

/**
 * A `DocumentHarness` PostgreSQL-megvalósítása (integrációs tesztekhez): a fixture-t a superuser írja replica módban
 * (FK és trigger nélkül, a CHECK-ek érvényesek), a tárat az app-szerepkörű kapcsolat hívja valódi triggerekkel
 * (a `tag_text`-et a `document_tags` triggere állítja).
 */
export function pgDocumentHarness(db: TestDb): DocumentHarness {
  const admin = <T extends object = object>(sql: string, params: unknown[] = []) =>
    db.admin.query<T>(sql, params);
  const placeholder = randomUUID(); // `created_by` a replica módú fixture-ben
  const roles = new Map<string, SystemRole>();
  const addMember = (spaceId: string, userId: string, role: string) =>
    admin('INSERT INTO space_members (space_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)', [
      spaceId,
      userId,
      role,
      userId,
    ]).then(() => undefined);

  return {
    documents: createPgDocumentStore(drizzle(db.app)),
    tags: createPgTagStore(drizzle(db.app)),
    async user(name, options = {}) {
      const id = randomUUID();
      const email = `${randomUUID()}@example.test`;
      roles.set(id, options.admin ? 'system_admin' : 'user');
      await admin(
        'INSERT INTO users (id, display_name, email, system_role) VALUES ($1, $2, $3, $4)',
        [id, name, email, roles.get(id)],
      );
      await admin('INSERT INTO allowlist (email) VALUES ($1)', [email]);
      return id;
    },
    actor: (userId) => ({ userId, systemRole: roles.get(userId) ?? 'user' }),
    async space(options = {}) {
      const id = randomUUID();
      const type = options.type ?? (options.closed ? 'project' : 'team');
      await withReplica(db.admin, (c) =>
        c.query(
          `INSERT INTO spaces (id, name, type, color, created_by, closed_at)
           VALUES ($1, $2, $3, '#3B6FB6', $4, ${options.closed ? 'now()' : 'NULL'})`,
          [id, `tér-${id}`, type, placeholder],
        ),
      );
      return id;
    },
    member: (spaceId, userId) => addMember(spaceId, userId, 'author'),
    manager: (spaceId, userId) => addMember(spaceId, userId, 'space_manager'),
    async kind(key, options = {}) {
      await admin(
        `INSERT INTO document_kinds (key, label, deleted_at) VALUES ($1, $1, ${options.deleted ? 'now()' : 'NULL'})
         ON CONFLICT (key) DO UPDATE SET deleted_at = excluded.deleted_at`,
        [key],
      );
    },
    async tag(name) {
      const id = randomUUID();
      await withReplica(db.admin, (c) =>
        c.query(
          'INSERT INTO tags (id, name, normalized_name, created_by) VALUES ($1, $2, $3, $4)',
          [id, displayTagName(name), normalizeTagName(name), placeholder],
        ),
      );
      return id;
    },
    async document(spaceId, ownerId, options = {}) {
      const id = randomUUID();
      const approved = options.approved ?? (options.archived ? { content: '' } : undefined);
      const revisionId = approved ? randomUUID() : null;
      const deleted = options.archived || options.discarded;
      const state = options.pending
        ? 'pending'
        : options.rejectedRequest
          ? 'changes_requested'
          : approved
            ? 'approved'
            : 'draft';
      await withReplica(db.admin, async (c) => {
        await c.query(
          `INSERT INTO documents (id, space_id, slug, title, kind, owner_id, created_by, content, review_state,
                                  approved_revision_id, iteration, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, ${deleted ? 'now()' : 'NULL'})`,
          [
            id,
            spaceId,
            `d-${id}`,
            options.title ?? 'Cím',
            options.kind ?? 'prompt',
            ownerId,
            options.content ?? '',
            state,
            revisionId,
            approved ? 1 : 0,
          ],
        );
        if (approved && revisionId) {
          await c.query(
            `INSERT INTO document_revisions (id, document_id, title, content, metadata, author_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              revisionId,
              id,
              approved.title ?? options.title ?? 'Cím',
              approved.content,
              JSON.stringify({
                kind: approved.kind ?? options.kind ?? 'prompt',
                tagIds: [...(approved.tagIds ?? [])].sort(),
                links: (approved.linkTo ?? []).map((toId) => ({
                  toId,
                  type: 'szarmazik',
                  anchor: null,
                })),
              }),
              ownerId,
            ],
          );
        }
        for (const tagId of options.tagIds ?? []) {
          await c.query('INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2)', [
            id,
            tagId,
          ]);
        }
        if (options.pending || options.rejectedRequest) {
          await c.query(
            `INSERT INTO change_requests (id, document_id, kind, proposed_revision_id, proposed_review_due_at,
                                          initiator_id, state, decided_at)
             VALUES ($1, $2, 'update', $3, now() + interval '1 year', $4, $5, ${options.pending ? 'NULL' : 'now()'})`,
            [randomUUID(), id, randomUUID(), ownerId, options.pending ? 'pending' : 'rejected'],
          );
        }
      });
      return id;
    },
    inspect: {
      async document(id) {
        const { rows } = await admin<{
          slug: string;
          title: string;
          kind: string;
          owner_id: string;
          space_id: string;
          content: string;
          tag_text: string;
          review_state: string;
          deleted: boolean;
          approved_revision_id: string | null;
          iteration: number;
        }>(
          `SELECT slug, title, kind, owner_id, space_id, content, tag_text, review_state,
                  deleted_at IS NOT NULL AS deleted, approved_revision_id, iteration
             FROM documents WHERE id = $1`,
          [id],
        );
        const r = rows[0];
        return (
          r && {
            slug: r.slug,
            title: r.title,
            kind: r.kind,
            ownerId: r.owner_id,
            spaceId: r.space_id,
            content: r.content,
            tagText: r.tag_text,
            reviewState: r.review_state,
            deleted: r.deleted,
            approvedRevisionId: r.approved_revision_id,
            iteration: r.iteration,
          }
        );
      },
      async revisions(id) {
        const { rows } = await admin<{
          id: string;
          title: string;
          content: string;
          metadata: never;
          author_id: string;
        }>(
          'SELECT id, title, content, metadata, author_id FROM document_revisions WHERE document_id = $1 ORDER BY created_at, id',
          [id],
        );
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          metadata: r.metadata,
          authorId: r.author_id,
        }));
      },
      async tagIds(documentId) {
        const { rows } = await admin<{ tag_id: string }>(
          'SELECT tag_id FROM document_tags WHERE document_id = $1',
          [documentId],
        );
        return rows.map((r) => r.tag_id);
      },
      async links(documentId) {
        const { rows } = await admin<{ to_id: string; type: string }>(
          'SELECT to_id, type FROM document_links WHERE from_id = $1',
          [documentId],
        );
        return rows.map((r) => ({ toId: r.to_id, type: r.type }));
      },
      async events() {
        const { rows } = await admin<{
          type: string;
          space_id: string | null;
          document_id: string | null;
          actor_id: string | null;
          details: Record<string, unknown>;
        }>('SELECT type, space_id, document_id, actor_id, details FROM events ORDER BY id');
        return rows.map((r) => ({
          type: r.type,
          spaceId: r.space_id,
          documentId: r.document_id,
          actorId: r.actor_id,
          details: r.details,
        }));
      },
      async collabStates(documentId) {
        const { rows } = await admin<{ n: number }>(
          'SELECT count(*)::int AS n FROM document_collab_state WHERE document_id = $1',
          [documentId],
        );
        return rows[0]?.n ?? 0;
      },
      async documentCount() {
        const { rows } = await admin<{ n: number }>('SELECT count(*)::int AS n FROM documents');
        return rows[0]?.n ?? 0;
      },
    },
  };
}
