import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { COLLAB_TEXT_FIELD } from '@taltos/shared';
import { createTestDb, type TestDb } from '../db/test-db.js';
import { runSeed } from '../db/seed-run.js';
import { createPgCollabStore } from './pg-collab-store.js';
import type { ReviewState } from './collab-store.js';

/**
 * WP3 adatbázis-tesztek (PostgreSQL ellen, eldobható adatbázison; csak TEST_DATABASE_URL-lel futnak, CI `db` job).
 * A `taltos_app` szerepkörrel futnak: ez bizonyítja, hogy az app jogai elegendők a `documents` és a
 * `document_collab_state` írásához. Az ügynök ezt nem futtatja: a tulajdonos futtatja (adatbázisba nem írunk).
 */
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-23T08:00:00Z');

describe.skipIf(!url)('/collab: tagság- és állapot-lekérdezés, perzisztencia (WP3)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb(url as string);
    await runSeed(db.app); // a dokumentumfajták (document_kinds) a seedből jönnek
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  }, 60_000);

  const store = () => createPgCollabStore(drizzle(db.app));
  const admin = <T extends object = object>(sql: string, params: unknown[] = []) =>
    db.admin.query<T>(sql, params);

  /** Friss felhasználó + színtér + (opcionálisan aktív) tagság + dokumentum; a fixture-öket a superuser írja. */
  async function fixture(
    options: {
      reviewState?: ReviewState;
      spaceType?: 'team' | 'project';
      closed?: boolean;
      spaceDeleted?: boolean;
      docDeleted?: boolean;
      member?: 'active' | 'removed' | 'none';
      content?: string;
    } = {},
  ) {
    const userId = randomUUID();
    const spaceId = randomUUID();
    const documentId = randomUUID();
    const { member = 'active', reviewState = 'draft', content = '' } = options;
    await admin(`INSERT INTO users (id, display_name) VALUES ($1, 'Teszt')`, [userId]);
    await admin(
      `INSERT INTO spaces (id, name, type, color, created_by, closed_at, deleted_at)
       VALUES ($1, $2, $3, '#3B6FB6', $4, $5, $6)`,
      [
        spaceId,
        `tér-${spaceId}`,
        options.spaceType ?? (options.closed ? 'project' : 'team'),
        userId,
        options.closed ? NOW : null,
        options.spaceDeleted ? NOW : null,
      ],
    );
    if (member !== 'none') {
      await admin(
        `INSERT INTO space_members (space_id, user_id, role, added_by, removed_at)
         VALUES ($1, $2, 'author', $2, $3)`,
        [spaceId, userId, member === 'removed' ? NOW : null],
      );
    }
    await admin(
      `INSERT INTO documents (id, space_id, slug, title, kind, owner_id, content, created_by, deleted_at)
       VALUES ($1, $2, $3, 'Cím', 'prompt', $4, $5, $4, $6)`,
      [documentId, spaceId, `d-${documentId}`, userId, content, options.docDeleted ? NOW : null],
    );
    if (reviewState !== 'draft') {
      // A review_state gyorsítótár (S5); a kényszerek (pl. pending/approved) megkerüléséhez replica-módban írjuk.
      const client = await db.admin.connect();
      try {
        await client.query('SET session_replication_role = replica');
        await client.query('UPDATE documents SET review_state = $1 WHERE id = $2', [
          reviewState,
          documentId,
        ]);
        await client.query('RESET session_replication_role');
      } finally {
        client.release();
      }
    }
    return { userId, spaceId, documentId };
  }

  const stateOf = (text: string): Uint8Array => {
    const doc = new Y.Doc();
    doc.getText(COLLAB_TEXT_FIELD).insert(0, text);
    return Y.encodeStateAsUpdate(doc);
  };
  const textOf = (state: Uint8Array): string => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return doc.getText(COLLAB_TEXT_FIELD).toJSON();
  };

  describe('findAccess', () => {
    it('aktív tagnak visszaadja az állapotot és a színtér lezártságát', async () => {
      const f = await fixture({ reviewState: 'changes_requested' });
      expect(await store().findAccess(f.userId, f.documentId)).toEqual({
        reviewState: 'changes_requested',
        spaceClosed: false,
      });
    });

    it('lezárt projekt-térnél spaceClosed=true', async () => {
      const f = await fixture({ closed: true });
      expect(await store().findAccess(f.userId, f.documentId)).toEqual({
        reviewState: 'draft',
        spaceClosed: true,
      });
    });

    it.each([
      ['nem tag', { member: 'none' as const }],
      ['megszűnt tagság', { member: 'removed' as const }],
      ['törölt dokumentum', { docDeleted: true }],
      ['törölt színtér', { spaceDeleted: true }],
    ])('%s: nincs hozzáférés', async (_label, options) => {
      const f = await fixture(options);
      expect(await store().findAccess(f.userId, f.documentId)).toBeUndefined();
    });

    it('nem létező dokumentum és idegen felhasználó: nincs hozzáférés', async () => {
      const f = await fixture();
      expect(await store().findAccess(f.userId, randomUUID())).toBeUndefined();
      expect(await store().findAccess(randomUUID(), f.documentId)).toBeUndefined();
    });
  });

  describe('loadContent és saveContent', () => {
    it('állapot nélkül a documents.content a seed, állapottal csak az állapot jön', async () => {
      const f = await fixture({ content: 'induló' });
      expect(await store().loadContent(f.documentId)).toEqual({ state: null, seed: 'induló' });
      expect(await store().saveContent(f.documentId, stateOf('mentett'), 'mentett', NOW)).toBe(
        true,
      );
      const loaded = await store().loadContent(f.documentId);
      expect(loaded?.seed).toBeNull();
      expect(textOf(loaded?.state as Uint8Array)).toBe('mentett');
    });

    it('nem létező vagy törölt dokumentumot nem tölt be', async () => {
      const f = await fixture({ docDeleted: true });
      expect(await store().loadContent(f.documentId)).toBeUndefined();
      expect(await store().loadContent(randomUUID())).toBeUndefined();
    });

    it('a mentés és az újramentés egy sort tart, és anyagosítja a documents.content-et', async () => {
      const f = await fixture();
      await store().saveContent(f.documentId, stateOf('egy'), 'egy', NOW);
      const later = new Date(NOW.getTime() + 60_000);
      await store().saveContent(f.documentId, stateOf('kettő'), 'kettő', later);

      const rows = await admin<{
        state: Uint8Array;
        pending_contributors: string[];
        last_edit_at: Date;
      }>(
        `SELECT state, pending_contributors, last_edit_at, updated_at
           FROM document_collab_state WHERE document_id = $1`,
        [f.documentId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(textOf(rows.rows[0]?.state ?? new Uint8Array())).toBe('kettő');
      expect(rows.rows[0]?.pending_contributors).toEqual([]); // a WP6 dolga: itt érintetlen
      expect(rows.rows[0]?.last_edit_at).toEqual(later);
      const doc = await admin<{ content: string; updated_at: Date }>(
        'SELECT content, updated_at FROM documents WHERE id = $1',
        [f.documentId],
      );
      expect(doc.rows[0]?.content).toBe('kettő');
      expect(doc.rows[0]?.updated_at).toEqual(later);
    });

    it.each([
      ['review-ra vár', { reviewState: 'pending' as const }],
      ['jóváhagyott', { reviewState: 'approved' as const }],
      ['lezárt színtér', { closed: true }],
      ['törölt színtér', { spaceDeleted: true }],
      ['törölt dokumentum', { docDeleted: true }],
    ])('%s: a tranzakción belüli újraellenőrzés miatt nem ír', async (_label, options) => {
      const f = await fixture({ ...options, content: 'érintetlen' });
      expect(await store().saveContent(f.documentId, stateOf('tiltott'), 'tiltott', NOW)).toBe(
        false,
      );
      const doc = await admin<{ content: string }>('SELECT content FROM documents WHERE id = $1', [
        f.documentId,
      ]);
      expect(doc.rows[0]?.content).toBe('érintetlen');
      const state = await admin('SELECT 1 FROM document_collab_state WHERE document_id = $1', [
        f.documentId,
      ]);
      expect(state.rows).toHaveLength(0);
    });

    it('draft és changes_requested állapotban ír', async () => {
      for (const reviewState of ['draft', 'changes_requested'] as const) {
        const f = await fixture({ reviewState });
        expect(await store().saveContent(f.documentId, stateOf('ok'), 'ok', NOW)).toBe(true);
      }
    });
  });
});
