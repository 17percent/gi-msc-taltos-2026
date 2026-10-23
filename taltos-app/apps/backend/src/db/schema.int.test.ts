import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrator.js';
import { runSeed } from './seed-run.js';
import { createTestDb, withTx, type TestDb } from './test-db.js';

/**
 * Integrációs tesztek: a migrációk, a seed és a DB-invariánsok egy FRISS, eldobható adatbázison (H5 WP1 „kész”).
 * Csak a TEST_DATABASE_URL megadásakor futnak (superuser URL, amely adatbázist hozhat létre); egyébként kimaradnak,
 * így a `pnpm test` adatbázis nélkül is zöld. A CI a `db` jobban egy postgres:18-alpine service containerrel futtatja.
 */
const url = process.env.TEST_DATABASE_URL;

type Queryable = Pick<pg.Pool, 'query'>;
const WRITE_ONCE_TABLES = ['favorites', 'subscriptions', 'user_space_colors', 'document_tags'];

async function rejectsWith(
  promise: Promise<unknown>,
  expected: { code?: string; message?: RegExp },
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'a műveletnek hibával kellett volna záródnia').toBeDefined();
  const pgError = error as { code?: string; message: string };
  if (expected.code) expect(pgError.code, pgError.message).toBe(expected.code);
  if (expected.message) expect(pgError.message).toMatch(expected.message);
}

describe.skipIf(!url)('adatbázis-séma, migrációk, seed és invariánsok (WP1)', () => {
  let db: TestDb;
  let fx: { spaceId: string; users: string[] };

  beforeAll(async () => {
    db = await createTestDb(url as string);
    await runSeed(db.app);
    const r = await db.app.query<{ space_id: string; users: string[] }>(
      `SELECT s.id AS space_id, array_agg(m.user_id::text ORDER BY m.user_id::text) AS users
         FROM spaces s JOIN space_members m ON m.space_id = s.id AND m.removed_at IS NULL
        WHERE s.type = 'team'
        GROUP BY s.id HAVING count(*) >= 4
        ORDER BY s.name LIMIT 1`,
    );
    const row = r.rows[0];
    if (!row) throw new Error('A seedben nincs legalább 4 tagú csapat-tér.');
    fx = { spaceId: row.space_id, users: row.users };
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  }, 60_000);

  // ── segédek: friss dokumentum és kérés a tesztekhez ──────────────────────────
  async function newDoc(): Promise<{ docId: string; revId: string }> {
    const docId = randomUUID();
    const revId = randomUUID();
    await db.app.query(
      `INSERT INTO documents (id, space_id, slug, title, kind, owner_id, content, created_by)
       VALUES ($1, $2, $3, 'Teszt', 'prompt', $4, 'tartalom', $4)`,
      [docId, fx.spaceId, `teszt-${docId}`, fx.users[0]],
    );
    await db.app.query(
      `INSERT INTO document_revisions (id, document_id, title, content, metadata, author_id)
       VALUES ($1, $2, 'Teszt', 'tartalom', '{}'::jsonb, $3)`,
      [revId, docId, fx.users[0]],
    );
    return { docId, revId };
  }
  async function insertRequest(
    c: Queryable,
    p: { docId: string; revId: string; initiator: string; reviewers: string[] },
  ): Promise<string> {
    const crId = randomUUID();
    await c.query(
      `INSERT INTO change_requests (id, document_id, kind, proposed_revision_id, proposed_review_due_at, initiator_id)
       VALUES ($1, $2, 'create', $3, now() + interval '1 year', $4)`,
      [crId, p.docId, p.revId, p.initiator],
    );
    for (const reviewer of p.reviewers) {
      await c.query(
        'INSERT INTO change_request_reviewers (change_request_id, reviewer_id) VALUES ($1, $2)',
        [crId, reviewer],
      );
    }
    return crId;
  }
  const ids = () => ({
    initiator: fx.users[0] as string,
    r1: fx.users[1] as string,
    r2: fx.users[2] as string,
    r3: fx.users[3] as string,
  });
  const activeReviewers = async (crId: string): Promise<number> =>
    Number(
      (
        await db.app.query<{ n: string }>(
          'SELECT count(*) AS n FROM change_request_reviewers WHERE change_request_id = $1 AND ended_at IS NULL',
          [crId],
        )
      ).rows[0]?.n,
    );
  const none = async (sql: string): Promise<void> => {
    const r = await db.app.query(sql);
    expect(r.rows, sql).toEqual([]);
  };

  // ── 1. Migráció üres adatbázisra ─────────────────────────────────────────────
  describe('migráció üres adatbázisról', () => {
    it('mind a hat migráció lefutott, és újrafuttatva nem tesz semmit', async () => {
      const count = () =>
        db.migrator.query<{ n: string }>('SELECT count(*) AS n FROM drizzle.__drizzle_migrations');
      expect(Number((await count()).rows[0]?.n)).toBe(6);
      await runMigrations(db.migrator);
      expect(Number((await count()).rows[0]?.n)).toBe(6);
    });

    it('megvan a B4 mind a 22 táblája, a generált search_vector és a pg_trgm', async () => {
      const tables = await db.admin.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
      );
      expect(tables.rows.map((r) => r.tablename).sort()).toEqual(
        [
          'allowlist',
          'change_request_reviewers',
          'change_requests',
          'comments',
          'document_collab_state',
          'document_kinds',
          'document_links',
          'document_revisions',
          'document_tags',
          'documents',
          'events',
          'favorites',
          'membership_requests',
          'notifications',
          'sessions',
          'space_members',
          'space_requests',
          'spaces',
          'subscriptions',
          'tags',
          'user_space_colors',
          'users',
        ].sort(),
      );
      const col = await db.admin.query<{ is_generated: string }>(
        `SELECT is_generated FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'search_vector'`,
      );
      expect(col.rows[0]?.is_generated).toBe('ALWAYS');
      const ext = await db.admin.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
      expect(ext.rowCount).toBe(1);
    });

    it('minden tábla tulajdonosa a taltos_owner; az app nem tulajdonos, nem superuser', async () => {
      const owners = await db.admin.query<{ tableowner: string }>(
        "SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'",
      );
      expect(owners.rows).toEqual([{ tableowner: 'taltos_owner' }]);
      const me = await db.app.query<{
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
      }>('SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user');
      expect(me.rows[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    });
  });

  // ── 2. A seed megfelel a B4-nek ──────────────────────────────────────────────
  describe('seed (D11) a B4 szerint', () => {
    it('üres adatbázisra fut, másodszor megtagadja a futást', async () => {
      await rejectsWith(runSeed(db.app), { message: /nem üres/ });
    });

    it('színterek, tagság, fajták', async () => {
      const general = await db.app.query<{ members: string; users: string }>(
        `SELECT (SELECT count(*) FROM space_members m WHERE m.space_id = s.id AND m.removed_at IS NULL) AS members,
                (SELECT count(*) FROM users) AS users
           FROM spaces s WHERE s.type = 'general'`,
      );
      expect(general.rows).toHaveLength(1);
      expect(general.rows[0]?.members).toBe(general.rows[0]?.users);
      const teams = await db.app.query<{ n: string }>(
        `SELECT count(*) AS n FROM spaces s WHERE s.type = 'team'
            AND (SELECT count(*) FROM space_members m WHERE m.space_id = s.id AND m.removed_at IS NULL) BETWEEN 3 AND 6`,
      );
      expect(Number(teams.rows[0]?.n)).toBeGreaterThanOrEqual(3);
      await none(`SELECT s.id FROM spaces s WHERE NOT EXISTS
                    (SELECT 1 FROM space_members m WHERE m.space_id = s.id AND m.role = 'space_manager' AND m.removed_at IS NULL)`);
      const kinds = await db.app.query<{ n: string }>('SELECT count(*) AS n FROM document_kinds');
      expect(Number(kinds.rows[0]?.n)).toBe(9);
    });

    it('dokumentumonként 1-3 címke, a tag_text a triggerrel egyezik, a keresővektor él', async () => {
      await none(`SELECT d.id FROM documents d LEFT JOIN document_tags dt ON dt.document_id = d.id
                   GROUP BY d.id HAVING count(dt.tag_id) NOT BETWEEN 1 AND 3`);
      await none('SELECT id FROM documents WHERE tag_text IS DISTINCT FROM document_tag_text(id)');
      await none('SELECT id FROM documents WHERE search_vector IS NULL');
      // Magyar tőalak-keresés a címre és simple a címkékre (D4, D49).
      const doc = await db.app.query<{ id: string; title: string; tag_text: string }>(
        'SELECT id, title, tag_text FROM documents ORDER BY id LIMIT 1',
      );
      const d = doc.rows[0]!;
      const byTitle = await db.app.query(
        "SELECT 1 FROM documents WHERE id = $1 AND search_vector @@ plainto_tsquery('hungarian', $2)",
        [d.id, d.title],
      );
      expect(byTitle.rowCount).toBe(1);
      const byTag = await db.app.query(
        "SELECT 1 FROM documents WHERE id = $1 AND search_vector @@ plainto_tsquery('simple', $2)",
        [d.id, d.tag_text],
      );
      expect(byTag.rowCount).toBe(1);
    });

    it('mind a négy review-állapot megvan; az állapot és a kérések egyeznek', async () => {
      const states = await db.app.query<{ review_state: string }>(
        'SELECT DISTINCT review_state FROM documents ORDER BY 1',
      );
      // Az enum a deklaráció sorrendjében rendez (draft, pending, …), ezért a halmazt hasonlítjuk.
      expect(states.rows.map((r) => r.review_state).sort()).toEqual([
        'approved',
        'changes_requested',
        'draft',
        'pending',
      ]);
      await none(`SELECT d.id FROM documents d
                    LEFT JOIN change_requests c ON c.document_id = d.id AND c.state = 'pending'
                   GROUP BY d.id, d.review_state HAVING (d.review_state = 'pending') <> (count(c.id) = 1)`);
      await none(`SELECT d.id FROM documents d
                   WHERE d.iteration <> (SELECT count(*) FROM change_requests c WHERE c.document_id = d.id AND c.state = 'approved')`);
      await none(`SELECT d.id FROM documents d
                   WHERE d.approved_revision_id IS NOT NULL AND NOT EXISTS
                         (SELECT 1 FROM change_requests c WHERE c.state = 'approved' AND c.proposed_revision_id = d.approved_revision_id)`);
      await none(
        `SELECT id FROM documents WHERE review_state = 'approved' AND deleted_at IS NULL AND review_due_at IS NULL`,
      );
    });

    it('a review-er sorok konzisztensek: jóváhagyotthoz két döntés, függőhöz két (egy esetben egy) aktív hely, elutasítotthoz egy indokolt elutasítás', async () => {
      await none(`SELECT c.id FROM change_requests c WHERE c.state = 'approved' AND
                   (SELECT count(*) FROM change_request_reviewers r WHERE r.change_request_id = c.id AND r.ended_at IS NULL AND r.decision = 'approved') <> 2`);
      const pending = await db.app.query<{ active: string; n: string }>(
        `SELECT (SELECT count(*) FROM change_request_reviewers r WHERE r.change_request_id = c.id AND r.ended_at IS NULL) AS active, count(*) AS n
           FROM change_requests c WHERE c.state = 'pending' GROUP BY 1`,
      );
      const byActive = new Map(pending.rows.map((r) => [Number(r.active), Number(r.n)]));
      expect([...byActive.keys()].sort()).toEqual([1, 2]);
      expect(byActive.get(1)).toBe(1); // pontosan egy kiesős review-hely (D51 b)
      await none(`SELECT c.id FROM change_requests c WHERE c.state = 'rejected' AND
                   (SELECT count(*) FROM change_request_reviewers r WHERE r.change_request_id = c.id AND r.decision = 'rejected' AND r.reason IS NOT NULL) <> 1`);
      await none(`SELECT c.id FROM change_requests c WHERE c.state <> 'pending' AND EXISTS
                   (SELECT 1 FROM change_request_reviewers r WHERE r.change_request_id = c.id AND r.ended_at IS NULL AND r.decision IS NULL)`);
    });

    it('események: minden dokumentumnak van created, minden kérésnek review_requested; rendszeresemény aktor nélkül; nincs név vagy e-mail a részletekben', async () => {
      await none(
        `SELECT id FROM documents d WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.document_id = d.id AND e.type = 'created')`,
      );
      await none(
        `SELECT id FROM change_requests c WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.change_request_id = c.id AND e.type = 'review_requested')`,
      );
      const system = await db.app.query<{ n: string }>(
        'SELECT count(*) AS n FROM events WHERE actor_id IS NULL',
      );
      expect(Number(system.rows[0]?.n)).toBeGreaterThan(0);
      await none(`SELECT id FROM events WHERE details::text ~ '@'`);
      await none(
        `SELECT e.id FROM events e JOIN users u ON e.details::text LIKE '%' || u.display_name || '%'`,
      );
      await none('SELECT id FROM events WHERE document_id IS NOT NULL AND space_id IS NULL');
      const removed = await db.app.query(
        'SELECT 1 FROM space_members WHERE removed_at IS NOT NULL',
      );
      expect(removed.rowCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 3. Negatív invariánsok (COMMIT-szemantikával) ────────────────────────────
  describe('review-invariánsok (D45, D51 b)', () => {
    it('két különböző review-errel a beküldés sikerül', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1, r2 } = ids();
      const crId = await withTx(db.app, (c) =>
        insertRequest(c, { docId, revId, initiator, reviewers: [r1, r2] }),
      );
      expect(await activeReviewers(crId)).toBe(2);
    });

    it('harmadik aktív review-er COMMIT-kor hibát dob', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1, r2, r3 } = ids();
      const crId = await withTx(db.app, (c) =>
        insertRequest(c, { docId, revId, initiator, reviewers: [r1, r2] }),
      );
      await rejectsWith(
        withTx(db.app, (c) =>
          c.query(
            'INSERT INTO change_request_reviewers (change_request_id, reviewer_id) VALUES ($1, $2)',
            [crId, r3],
          ),
        ),
        { message: /too_many_reviewers/ },
      );
      expect(await activeReviewers(crId)).toBe(2);
    });

    it('a saját magát review-ernek jelölő indítványozó hibát dob', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1 } = ids();
      await rejectsWith(
        withTx(db.app, (c) =>
          insertRequest(c, { docId, revId, initiator, reviewers: [initiator, r1] }),
        ),
        { message: /reviewer_is_initiator/ },
      );
    });

    it('ugyanazt a személyt kétszer aktívan nem lehet megjelölni', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1 } = ids();
      await rejectsWith(
        withTx(db.app, (c) => insertRequest(c, { docId, revId, initiator, reviewers: [r1, r1] })),
        { code: '23505' },
      );
    });

    it('második függő kérés ugyanarra a dokumentumra hibát dob', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1, r2 } = ids();
      await withTx(db.app, (c) =>
        insertRequest(c, { docId, revId, initiator, reviewers: [r1, r2] }),
      );
      await rejectsWith(
        withTx(db.app, (c) => insertRequest(c, { docId, revId, initiator, reviewers: [r1, r2] })),
        { code: '23505' },
      );
    });

    it('két review-er nélküli beküldés (0, 1 vagy 3 aktív) COMMIT-kor hibát dob', async () => {
      const { initiator, r1, r2, r3 } = ids();
      for (const reviewers of [[], [r1], [r1, r2, r3]]) {
        const { docId, revId } = await newDoc();
        await rejectsWith(
          withTx(db.app, (c) => insertRequest(c, { docId, revId, initiator, reviewers })),
          { message: /exactly_two_reviewers_required|too_many_reviewers/ },
        );
      }
    });

    it('a kiesett review-hely NEM hiba: a kérés marad, de nem dönthető el; pótlás és újra-megjelölés lehetséges', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1, r2, r3 } = ids();
      const crId = await withTx(db.app, (c) =>
        insertRequest(c, { docId, revId, initiator, reviewers: [r1, r2] }),
      );

      await withTx(db.app, (c) =>
        c.query(
          `UPDATE change_request_reviewers SET ended_at = now(), end_reason = 'removed'
            WHERE change_request_id = $1 AND reviewer_id = $2`,
          [crId, r1],
        ),
      );
      expect(await activeReviewers(crId)).toBe(1);

      // Egy aktív helyen a kérés nem hagyható jóvá.
      await rejectsWith(
        withTx(db.app, async (c) => {
          await c.query(
            `UPDATE change_request_reviewers SET decision = 'approved', decided_at = now()
              WHERE change_request_id = $1 AND reviewer_id = $2`,
            [crId, r2],
          );
          await c.query(
            "UPDATE change_requests SET state = 'approved', decided_at = now(), iteration = 1 WHERE id = $1",
            [crId],
          );
        }),
        { message: /two_approvals_required/ },
      );

      // Pótlás: új hely a harmadik taggal; majd a korábban kiesett személy újra megjelölhető (helyettesítő kulcs).
      await withTx(db.app, (c) =>
        c.query(
          'INSERT INTO change_request_reviewers (change_request_id, reviewer_id) VALUES ($1, $2)',
          [crId, r3],
        ),
      );
      expect(await activeReviewers(crId)).toBe(2);
      await withTx(db.app, async (c) => {
        await c.query(
          `UPDATE change_request_reviewers SET ended_at = now(), end_reason = 'replaced'
            WHERE change_request_id = $1 AND reviewer_id = $2`,
          [crId, r3],
        );
        await c.query(
          'INSERT INTO change_request_reviewers (change_request_id, reviewer_id) VALUES ($1, $2)',
          [crId, r1],
        );
      });
      expect(await activeReviewers(crId)).toBe(2);
    });

    it('két jóváhagyással a kérés véglegesedik; utána a lezárt kérés megváltoztathatatlan', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1, r2 } = ids();
      const crId = await withTx(db.app, (c) =>
        insertRequest(c, { docId, revId, initiator, reviewers: [r1, r2] }),
      );
      await withTx(db.app, async (c) => {
        await c.query(
          `UPDATE change_request_reviewers SET decision = 'approved', decided_at = now()
            WHERE change_request_id = $1 AND ended_at IS NULL`,
          [crId],
        );
        await c.query(
          "UPDATE change_requests SET state = 'approved', decided_at = now(), iteration = 1 WHERE id = $1",
          [crId],
        );
        await c.query(
          `UPDATE documents SET review_state = 'approved', approved_revision_id = $2, iteration = 1 WHERE id = $1`,
          [docId, revId],
        );
      });
      await rejectsWith(
        db.app.query("UPDATE change_requests SET message = 'utólag' WHERE id = $1", [crId]),
        {
          message: /change_request_closed/,
        },
      );
    });

    it('a retenció lecsatolhatja az elutasított kérés javasolt revízióját (D51 h)', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1, r2 } = ids();
      const crId = await withTx(db.app, (c) =>
        insertRequest(c, { docId, revId, initiator, reviewers: [r1, r2] }),
      );
      await withTx(db.app, async (c) => {
        await c.query(
          `UPDATE change_request_reviewers SET decision = 'rejected', reason = 'hiányos', decided_at = now()
            WHERE change_request_id = $1 AND reviewer_id = $2`,
          [crId, r1],
        );
        await c.query(
          `UPDATE change_request_reviewers SET ended_at = now(), end_reason = 'closed'
            WHERE change_request_id = $1 AND reviewer_id = $2`,
          [crId, r2],
        );
        await c.query(
          "UPDATE change_requests SET state = 'rejected', decided_at = now() WHERE id = $1",
          [crId],
        );
      });
      await withTx(db.retention, async (c) => {
        await c.query('SET LOCAL ROLE taltos_retention');
        const res = await c.query(
          'UPDATE change_requests SET proposed_revision_id = NULL WHERE id = $1',
          [crId],
        );
        expect(res.rowCount).toBe(1);
      });
    });

    it('Review-ra várás alatt a tartalom és a címkék befagynak (D45)', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1, r2 } = ids();
      await withTx(db.app, async (c) => {
        await insertRequest(c, { docId, revId, initiator, reviewers: [r1, r2] });
        await c.query("UPDATE documents SET review_state = 'pending' WHERE id = $1", [docId]);
      });
      await rejectsWith(
        db.app.query("UPDATE documents SET content = 'más' WHERE id = $1", [docId]),
        {
          message: /document_frozen/,
        },
      );
      await rejectsWith(
        db.app.query(
          'INSERT INTO document_tags (document_id, tag_id) SELECT $1, id FROM tags LIMIT 1',
          [docId],
        ),
        { message: /document_frozen/ },
      );
    });

    it('a címke-hozzárendelés a triggerrel frissíti a tag_text-et (beszúrás és törlés)', async () => {
      const { docId } = await newDoc();
      const tags = await db.app.query<{ id: string; name: string }>(
        'SELECT id, name FROM tags ORDER BY name LIMIT 2',
      );
      const [a, b] = tags.rows as [{ id: string; name: string }, { id: string; name: string }];
      await db.app.query(
        'INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2), ($1, $3)',
        [docId, a.id, b.id],
      );
      const after = () =>
        db.app.query<{ tag_text: string }>('SELECT tag_text FROM documents WHERE id = $1', [docId]);
      expect((await after()).rows[0]?.tag_text).toBe(`${a.name} ${b.name}`);
      await db.app.query('DELETE FROM document_tags WHERE document_id = $1 AND tag_id = $2', [
        docId,
        a.id,
      ]);
      expect((await after()).rows[0]?.tag_text).toBe(b.name);
    });
  });

  describe('kényszerek és hivatkozások (B4 S22)', () => {
    it('az approved/base/proposed revízió csak a saját dokumentumé lehet (kompozit FK)', async () => {
      const a = await newDoc();
      const b = await newDoc();
      await rejectsWith(
        db.app.query('UPDATE documents SET approved_revision_id = $2 WHERE id = $1', [
          a.docId,
          b.revId,
        ]),
        { code: '23503' },
      );
      const { initiator, r1, r2 } = ids();
      await rejectsWith(
        withTx(db.app, (c) =>
          insertRequest(c, { docId: a.docId, revId: b.revId, initiator, reviewers: [r1, r2] }),
        ),
        { code: '23503' },
      );
    });

    it('CHECK-ek: Jóváhagyott állapot revízió nélkül, rendszer-aktor nélküli nem-rendszer esemény, dokumentum-esemény színtér nélkül', async () => {
      const { docId } = await newDoc();
      await rejectsWith(
        db.app.query("UPDATE documents SET review_state = 'approved' WHERE id = $1", [docId]),
        { code: '23514' },
      );
      await rejectsWith(
        db.app.query("INSERT INTO events (type, actor_id) VALUES ('created', NULL)"),
        { code: '23514' },
      );
      await rejectsWith(
        db.app.query(
          "INSERT INTO events (type, actor_id, document_id) VALUES ('created', $1, $2)",
          [fx.users[0], docId],
        ),
        { code: '23514' },
      );
      await rejectsWith(
        db.app.query("INSERT INTO allowlist (email) VALUES ('Nagy.Betu@vallalat.hu')"),
        { code: '23514' },
      );
      await rejectsWith(
        db.app.query('UPDATE spaces SET closed_at = now() WHERE id = $1', [fx.spaceId]),
        { code: '23514' },
      );
    });

    it('CHECK-ek a kérésen és a review-er soron (fajta-szabályok, indoklás, esedékesség)', async () => {
      const { docId, revId } = await newDoc();
      const { initiator, r1, r2 } = ids();
      const bad = (sql: string, params: unknown[]) =>
        rejectsWith(db.app.query(sql, params), { code: '23514' });
      await bad(
        `INSERT INTO change_requests (document_id, kind, proposed_revision_id, initiator_id) VALUES ($1, 'delete', $2, $3)`,
        [docId, revId, initiator],
      );
      await bad(
        `INSERT INTO change_requests (document_id, kind, proposed_revision_id, initiator_id) VALUES ($1, 'update', $2, $3)`,
        [docId, revId, initiator],
      ); // esedékesség nélkül
      const crId = await withTx(db.app, (c) =>
        insertRequest(c, { docId, revId, initiator, reviewers: [r1, r2] }),
      );
      await rejectsWith(
        db.app.query(
          `UPDATE change_request_reviewers SET decision = 'rejected', decided_at = now()
            WHERE change_request_id = $1 AND reviewer_id = $2`,
          [crId, r1],
        ),
        { code: '23514' },
      ); // indoklás nélkül
    });
  });

  // ── 4. Append-only, TRUNCATE, jogosultságok (S6, S23, D51 j) ─────────────────
  describe('append-only védelem és jogosultságok', () => {
    const firstEvent = '(SELECT min(id) FROM events)';

    it('a tulajdonosi jogú szerepkör sem módosíthat vagy törölhet eseményt/revíziót, és nem TRUNCATE-elhet', async () => {
      await rejectsWith(
        db.migrator.query(`UPDATE events SET type = 'x' WHERE id = ${firstEvent}`),
        { message: /append-only/ },
      );
      await rejectsWith(db.migrator.query(`DELETE FROM events WHERE id = ${firstEvent}`), {
        message: /append-only/,
      });
      await rejectsWith(
        db.migrator.query(
          'DELETE FROM document_revisions WHERE id = (SELECT id FROM document_revisions LIMIT 1)',
        ),
        { message: /append-only/ },
      );
      await rejectsWith(db.migrator.query('UPDATE document_revisions SET title = title'), {
        message: /append-only/,
      });
      // A Postgres az FK-hivatkozásokat a BEFORE TRUNCATE trigger ELŐTT ellenőrzi (0A000), ezért a védelem
      // a valósághű, CASCADE-es formán bizonyítható: a trigger a lépcsőzetesen érintett táblák előtt is dob.
      await rejectsWith(db.migrator.query('TRUNCATE events CASCADE'), {
        message: /TRUNCATE nem megengedett/,
      });
      await rejectsWith(db.migrator.query('TRUNCATE document_revisions CASCADE'), {
        message: /TRUNCATE nem megengedett/,
      });
      // CASCADE nélkül sem megy át: vagy a guard, vagy az FK-ellenőrzés (0A000) állítja meg.
      await rejectsWith(db.migrator.query('TRUNCATE events'), {
        message: /TRUNCATE nem megengedett|cannot truncate a table referenced/,
      });
    });

    it('az app az események és revíziók módosításához/törléséhez jogot sem kap', async () => {
      await rejectsWith(db.app.query(`UPDATE events SET type = 'x' WHERE id = ${firstEvent}`), {
        code: '42501',
      });
      await rejectsWith(db.app.query('UPDATE document_revisions SET title = title'), {
        code: '42501',
      });
      await rejectsWith(db.app.query(`DELETE FROM events WHERE id = ${firstEvent}`), {
        code: '42501',
      });
      // A jogosultság-ellenőrzés megelőzi az FK-ellenőrzést, ezért az app a CASCADE-es formán is 42501-et kap.
      await rejectsWith(db.app.query('TRUNCATE events'), { code: '42501' });
      await rejectsWith(db.app.query('TRUNCATE events CASCADE'), { code: '42501' });
      await rejectsWith(db.app.query('TRUNCATE document_revisions CASCADE'), { code: '42501' });
    });

    it('a retenciós szerepkör csak SET LOCAL ROLE taltos_retention után törölhet (a login-szerepkörként nem)', async () => {
      await rejectsWith(db.retention.query(`DELETE FROM events WHERE id = ${firstEvent}`), {
        message: /append-only/,
      });
      const target =
        'SELECT id FROM events e WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.event_id = e.id) ORDER BY id LIMIT 1';
      const client = await db.retention.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE taltos_retention');
        const res = await client.query(`DELETE FROM events WHERE id = (${target})`);
        expect(res.rowCount).toBe(1);
        await client.query('ROLLBACK'); // csak a jog igazolása, az adat marad
      } finally {
        client.release();
      }
    });

    it('az app csak a D51 (j) táblákon törölhet, sehol sem TRUNCATE-elhet, nem DDL-ezhet és nem kapcsolhatja ki a triggereket', async () => {
      const tables = await db.admin.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
      );
      expect(tables.rows.length).toBe(22);
      for (const { tablename } of tables.rows) {
        if (WRITE_ONCE_TABLES.includes(tablename)) {
          await expect(db.app.query(`DELETE FROM ${tablename} WHERE false`)).resolves.toBeDefined();
        } else {
          await rejectsWith(db.app.query(`DELETE FROM ${tablename} WHERE false`), {
            code: '42501',
          });
        }
        await rejectsWith(db.app.query(`TRUNCATE ${tablename}`), { code: '42501' });
      }
      await rejectsWith(db.app.query('CREATE TABLE app_ddl_teszt (a int)'), { code: '42501' });
      await rejectsWith(db.app.query('ALTER TABLE documents DISABLE TRIGGER ALL'), {
        code: '42501',
      });
      await rejectsWith(db.app.query('DROP TRIGGER events_append_only ON events'), {
        code: '42501',
      });
      await rejectsWith(db.app.query('DROP TABLE events'), { code: '42501' });
    });

    it('az app a D51 (j) táblákból ténylegesen töröl, a munkamenet-táblába ír', async () => {
      const fav = await db.app.query<{ user_id: string; document_id: string }>(
        'SELECT user_id, document_id FROM favorites LIMIT 1',
      );
      const f = fav.rows[0]!;
      const client = await db.app.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(
          'DELETE FROM favorites WHERE user_id = $1 AND document_id = $2',
          [f.user_id, f.document_id],
        );
        expect(res.rowCount).toBe(1);
      } finally {
        await client.query('ROLLBACK'); // csak a jog igazolása, az adat marad
        client.release();
      }
      await db.app.query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES (decode($1, 'hex'), $2, now() + interval '8 hours')",
        [randomUUID().replaceAll('-', ''), fx.users[0]],
      );
    });
  });
});
