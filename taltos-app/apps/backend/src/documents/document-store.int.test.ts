import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/test-db.js';
import { pgDocumentHarness } from '../testing/pg-document-harness.js';
import { withReplica } from '../testing/pg-space-harness.js';
import { createControlPool, runGated } from '../testing/pg-race.js';
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

    it('az egyidejű, azonos nevű címke-létrehozás egyetlen sort és egyetlen eseményt ad', async () => {
      const { h, owner } = await world();
      const results = await Promise.all(
        ['Közös', 'közös', 'KOZOS', 'kozos ', ' közös'].map((name) =>
          h.tags.createTag(h.actor(owner), name, NOW),
        ),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(new Set(results.map((r) => r.name)).size).toBe(1);
      expect((await h.inspect.events()).filter((e) => e.type === 'tag_created')).toHaveLength(1);
    });
  });
});
