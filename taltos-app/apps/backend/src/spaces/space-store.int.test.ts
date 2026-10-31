import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/test-db.js';
import { pgHarness, withReplica } from '../testing/pg-space-harness.js';
import { describeSpaceStoreContract } from './space-store-contract.js';

/**
 * WP4a adatbázis-tesztek (PostgreSQL ellen, eldobható adatbázison; csak TEST_DATABASE_URL-lel futnak, CI `db` job).
 * A fixture-t a superuser írja `replica` módban (triggerek és FK-k nélkül, csak a CHECK-ek érvényesek), a tárat az
 * app-szerepkörű kapcsolat hívja valódi triggerekkel: a halasztott triggerek (`crr_at_most_two`) a COMMIT-kor futnak,
 * így a tárműveletek tranzakció-lezárása is bizonyítva van. Az ügynök ezt nem futtatja: a tulajdonos futtatja.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('SpaceStore és ReviewService (PostgreSQL, WP4a)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb(url as string);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  }, 60_000);

  // Minden teszt üres adatbázisról indul (az admin-védelem tesztjei az „összes admin” halmazra épülnek).
  beforeEach(async () => {
    await withReplica(db.admin, (c) =>
      c.query(
        'TRUNCATE change_request_reviewers, change_requests, space_members, events, documents, spaces, allowlist, users CASCADE',
      ),
    );
  });

  describeSpaceStoreContract('PostgreSQL', () => Promise.resolve(pgHarness(db)));

  describe('lezárás atomicitása', () => {
    it('hiba esetén az egész lezárás visszagördül (a tér nyitott marad, a kérés függő)', async () => {
      const h = pgHarness(db);
      const [m, init, r1, r2, root] = [
        await h.user('m'),
        await h.user('init'),
        await h.user('r1'),
        await h.user('r2'),
        await h.user('root', { admin: true }),
      ];
      const space = await h.space({ type: 'project' });
      for (const u of [init, r1, r2]) await h.member(space, u);
      await h.member(space, m, 'space_manager');
      const doc = await h.document(space, m, {
        pending: { initiatorId: init, reviewers: [r1, r2] },
      });
      // Egy ideiglenes CHECK a `space_closed` eseményre: a lezárás utolsó lépése elbukik, a tranzakció visszagördül.
      await db.admin.query(
        "ALTER TABLE events ADD CONSTRAINT zz_fail CHECK (type <> 'space_closed')",
      );
      try {
        await expect(
          h.store.closeSpace({ userId: root, systemRole: 'system_admin' }, space, new Date()),
        ).rejects.toThrow();
      } finally {
        await db.admin.query('ALTER TABLE events DROP CONSTRAINT zz_fail');
      }
      expect(await h.reviewState(doc)).toBe('pending');
      expect(await h.activeReviewers(doc)).toHaveLength(2);
      const { rows } = await db.admin.query<{ closed_at: Date | null }>(
        'SELECT closed_at FROM spaces WHERE id = $1',
        [space],
      );
      expect(rows[0]?.closed_at).toBeNull();
    });
  });
});
