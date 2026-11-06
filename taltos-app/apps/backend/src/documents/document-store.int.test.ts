import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/test-db.js';
import { pgDocumentHarness } from '../testing/pg-document-harness.js';
import { withReplica } from '../testing/pg-space-harness.js';
import { createControlPool, runGated, waitForLockWaiters } from '../testing/pg-race.js';
import { describeTagStoreContract } from '../tags/tag-store-contract.js';
import { describeDocumentStoreContract } from './document-store-contract.js';

/**
 * WP5a adatbázis-tesztek (PostgreSQL ellen, eldobható adatbázison; csak TEST_DATABASE_URL-lel futnak, CI `db` job).
 * A fixture-t a superuser írja `replica` módban, a tárat az app-szerepkörű kapcsolat hívja valódi triggerekkel és
 * jogokkal (a `taltos_app` nem UPDATE-elheti a `document_revisions`-t és az `events`-et). Az ügynök ezt a gépén nem
 * futtatta (nincs elérhető Docker): a tulajdonos futtatja.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('DocumentStore és TagStore (PostgreSQL, WP5a)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb(url as string);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  }, 60_000);

  beforeEach(async () => {
    await withReplica(db.admin, (c) =>
      c.query(
        `TRUNCATE document_links, document_tags, document_revisions, change_request_reviewers, change_requests,
                  document_collab_state, events, documents, tags, document_kinds, space_members, spaces, allowlist, users CASCADE`,
      ),
    );
  });

  describeDocumentStoreContract('PostgreSQL', () => Promise.resolve(pgDocumentHarness(db)));
  describeTagStoreContract('PostgreSQL', () => Promise.resolve(pgDocumentHarness(db)));

  const NOW = new Date('2026-11-06T09:00:00Z');

  async function world() {
    const h = pgDocumentHarness(db);
    const owner = await h.user('owner');
    const space = await h.space();
    await h.member(space, owner);
    await h.kind('prompt');
    return { h, owner, space };
  }

  describe('létrehozás atomicitása', () => {
    it('hiba esetén (a created esemény elbukik) semmi nem marad: se dokumentum, se revízió, se címke-hozzárendelés', async () => {
      const { h, owner, space } = await world();
      const tag = await h.tag('címke');
      await db.admin.query("ALTER TABLE events ADD CONSTRAINT zz_fail CHECK (type <> 'created')");
      try {
        await expect(
          h.documents.createDocument(
            h.actor(owner),
            { spaceId: space, title: 'Bukó', kind: 'prompt', tagIds: [tag] },
            NOW,
          ),
        ).rejects.toThrow();
      } finally {
        await db.admin.query('ALTER TABLE events DROP CONSTRAINT zz_fail');
      }
      expect(await h.inspect.documentCount()).toBe(0);
      const { rows } = await db.admin.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM document_revisions)::int
              + (SELECT count(*) FROM document_tags)::int AS n`,
      );
      expect(rows[0]?.n).toBe(0);
    });

    it('a tag_text a létrehozással azonos tranzakcióban áll be (a DB-trigger, nem az alkalmazás)', async () => {
      const { h, owner, space } = await world();
      const [b, a] = [await h.tag('béta'), await h.tag('alfa')];
      const result = await h.documents.createDocument(
        h.actor(owner),
        { spaceId: space, title: 'Trigger', kind: 'prompt', tagIds: [b, a] },
        NOW,
      );
      if (!result.ok) throw new Error(result.code);
      expect((await h.inspect.document(result.value.id))?.tagText).toBe('alfa béta');
    });
  });

  describe('versenyhelyzetek', () => {
    it('az azonos címmel egyidejűleg létrehozott dokumentumok slugja egyedi, mindkettő létrejön', async () => {
      const { h, owner, space } = await world();
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          h.documents.createDocument(
            h.actor(owner),
            { spaceId: space, title: 'Verseny', kind: 'prompt', tagIds: [] },
            NOW,
          ),
        ),
      );
      const slugs = results.map((r) => (r.ok ? r.value.slug : 'HIBA'));
      expect(new Set(slugs).size).toBe(3);
      expect(slugs).not.toContain('HIBA');
    });

    it('az egyidejű eldobás közül pontosan egy sikeres, a másik not_found; egyetlen esemény', async () => {
      const { h, owner, space } = await world();
      const id = await h.document(space, owner, {});
      const ctl = createControlPool(url as string, db);
      try {
        const results = await runGated({
          ctl,
          db,
          gateSql: 'SELECT 1 FROM documents WHERE id = $1 FOR UPDATE',
          gateParams: [id],
          ops: [1, 2].map(() => () => h.documents.discardDraft(h.actor(owner), id, NOW)),
          what: 'egyidejű eldobás',
        });
        const outcomes = results.map((r) => (r.ok ? 'ok' : r.code)).sort();
        expect(outcomes).toEqual(['not_found', 'ok']);
        expect((await h.inspect.events()).filter((e) => e.type === 'draft_discarded')).toHaveLength(
          1,
        );
        expect((await h.inspect.document(id))?.deleted).toBe(true);
      } finally {
        await ctl.end();
      }
    });

    it('az eldobás a közben lezáródó térben space_closed, a dokumentum megmarad', async () => {
      const { h, owner } = await world();
      const project = await h.space({ type: 'project' });
      await h.member(project, owner);
      const id = await h.document(project, owner, {});
      const ctl = createControlPool(url as string, db);
      try {
        const [result] = await runGated({
          ctl,
          db,
          // a lezárás sorzára (B4 S8): az eldobás a tér osztott zárán áll sorba, majd újraellenőrzi a lezártságot
          gateSql: 'UPDATE spaces SET closed_at = now() WHERE id = $1',
          gateParams: [project],
          ops: [() => h.documents.discardDraft(h.actor(owner), id, NOW)],
          what: 'eldobás lezáródó térben',
        });
        expect(result).toMatchObject({ ok: false, code: 'space_closed' });
        expect((await h.inspect.document(id))?.deleted).toBe(false);
      } finally {
        await ctl.end();
      }
    });

    /**
     * Az eldobás és egy egyidejű beküldés (a WP8 mintája): a beküldés a `change_requests` INSERT-jével kezd (az FK csak
     * `FOR KEY SHARE`-t vesz a `documents` soron), és csak utána frissíti a `documents.review_state`-et. Az eldobásnak a
     * sor `FOR UPDATE` zárán KÜLÖN utasításként meg kell várnia a beküldést, hogy a feltételes UPDATE friss pillanatképpel
     * lássa a kérést; különben `deleted_at` + függő kérés együtt maradna.
     */
    async function submissionRace(order: 'insert_first' | 'update_first') {
      const { h, owner, space } = await world();
      const id = await h.document(space, owner, {});
      const ctl = createControlPool(url as string, db);
      const c = await ctl.connect();
      // Valódi FK-k és triggerek (NEM replica mód): az FK-ellenőrzés a `documents` soron `FOR KEY SHARE`-t vesz, ami a
      // `FOR UPDATE`-tel ütközik; a beküldés itt a WP8 mintája: revízió + kérés + két review-er.
      const [r1, r2] = [await h.user('r1'), await h.user('r2')];
      const insert = async () => {
        const revisionId = randomUUID();
        const requestId = randomUUID();
        await c.query(
          `INSERT INTO document_revisions (id, document_id, title, content, metadata, author_id)
           VALUES ($1, $2, 'Cím', 'javaslat', '{}', $3)`,
          [revisionId, id, owner],
        );
        await c.query(
          `INSERT INTO change_requests (id, document_id, kind, proposed_revision_id, proposed_review_due_at, initiator_id, state)
           VALUES ($1, $2, 'update', $3, now() + interval '1 year', $4, 'pending')`,
          [requestId, id, revisionId, owner],
        );
        for (const reviewer of [r1, r2]) {
          await c.query(
            'INSERT INTO change_request_reviewers (change_request_id, reviewer_id) VALUES ($1, $2)',
            [requestId, reviewer],
          );
        }
      };
      const update = () =>
        c.query("UPDATE documents SET review_state = 'pending' WHERE id = $1", [id]);
      try {
        await c.query('BEGIN');
        if (order === 'insert_first') await insert();
        else await update();
        const discard = h.documents.discardDraft(h.actor(owner), id, NOW);
        discard.catch(() => undefined);
        await waitForLockWaiters(ctl, db, 1, 'az eldobás a beküldésre vár', 5_000);
        if (order === 'insert_first') await update();
        else await insert();
        await c.query('COMMIT');
        return { result: await discard, state: await h.inspect.document(id) };
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
        c.release();
        await ctl.end();
      }
    }

    it.each(['insert_first', 'update_first'] as const)(
      'beküldés egyidejű eldobással (%s): request_pending, a dokumentum nem törlődik',
      async (order) => {
        const { result, state } = await submissionRace(order);
        expect(result).toMatchObject({ ok: false, code: 'request_pending' });
        expect(state).toMatchObject({ deleted: false, reviewState: 'pending' });
      },
      30_000,
    );

    it('az egyidejű tulajdonjog-átadás után a volt tulajdonos nem dobhatja el (forbidden)', async () => {
      const { h, owner, space } = await world();
      const heir = await h.user('heir');
      await h.member(space, heir);
      const id = await h.document(space, owner, {});
      const ctl = createControlPool(url as string, db);
      const c = await ctl.connect();
      try {
        await c.query('BEGIN');
        await c.query('UPDATE documents SET owner_id = $2 WHERE id = $1', [id, heir]);
        const discard = h.documents.discardDraft(h.actor(owner), id, NOW);
        discard.catch(() => undefined);
        await waitForLockWaiters(ctl, db, 1, 'az eldobás az átadásra vár', 5_000);
        await c.query('COMMIT');
        expect(await discard).toMatchObject({ ok: false, code: 'forbidden' });
        expect((await h.inspect.document(id))?.deleted).toBe(false);
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
        c.release();
        await ctl.end();
      }
    }, 30_000);

    it('az egyidejű, azonos nevű címke-létrehozás egyetlen sort és egyetlen eseményt ad', async () => {
      const { h, owner } = await world();
      const results = await Promise.all(
        ['Közös', 'közös', 'KOZOS', 'kozos ', ' közös'].map((name) =>
          h.tags.createTag(h.actor(owner), name, NOW),
        ),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect((await h.inspect.events()).filter((e) => e.type === 'tag_created')).toHaveLength(1);
    });
  });
});
