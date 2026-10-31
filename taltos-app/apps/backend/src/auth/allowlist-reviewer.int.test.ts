import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/test-db.js';
import { pgHarness, withReplica } from '../testing/pg-space-harness.js';
import { syncAllowlist } from './allowlist.js';

/**
 * C11 (WP4a): az allowlist-szinkron a ténylegesen eltávolított felhasználó függő review-er helyeit megszünteti
 * (D51 b), aktor nélküli `reviewer_removed` eseménnyel (ok: `allowlist_removed`); a védelem miatt megtartott
 * felhasználónál semmi nem változik. Eldobható adatbázison, csak TEST_DATABASE_URL-lel (CI `db` job); az ügynök nem futtatja.
 */
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-31T08:00:00Z');

describe.skipIf(!url)('allowlist-szinkron és a review-er helyek (PostgreSQL, C11)', () => {
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
        'TRUNCATE change_request_reviewers, change_requests, space_members, events, documents, spaces, allowlist, users CASCADE',
      ),
    );
  });

  const emailOf = async (userId: string): Promise<string> => {
    const { rows } = await db.admin.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [userId],
    );
    return rows[0]?.email as string;
  };

  it('a kiesett felhasználó függő helye megszűnik, a döntött és a megtartott felhasználó helye nem', async () => {
    const h = pgHarness(db);
    const [keeper, removed, protectedUser, other, init] = [
      await h.user('keeper'),
      await h.user('removed'),
      await h.user('protected'),
      await h.user('other'),
      await h.user('init'),
    ];
    const space = await h.space();
    for (const u of [removed, protectedUser, other, init]) await h.member(space, u);
    await h.member(space, keeper, 'space_manager');
    // 1: a kiesőnek függő helye van; 2: a kiesőnek már döntése van; 3: a védett felhasználónak függő helye van
    const d1 = await h.document(space, keeper, {
      pending: { initiatorId: init, reviewers: [removed, other] },
    });
    const d2 = await h.document(space, keeper, {
      pending: { initiatorId: init, reviewers: [removed, other], decided: [removed] },
    });
    const d3 = await h.document(space, protectedUser, {
      pending: { initiatorId: init, reviewers: [protectedUser, other] },
    });

    // A konfigban csak a keeper, az other és az init marad: a `removed` és a `protectedUser` kikerül a listáról.
    const wanted = [await emailOf(keeper), await emailOf(other), await emailOf(init)];
    const result = await syncAllowlist(drizzle(db.app), wanted, NOW);

    expect(result.removed).toBe(1);
    expect(result.kept.map((k) => [k.userId, k.reason])).toContainEqual([
      protectedUser,
      'owner_handover_required',
    ]);
    expect((await h.activeReviewers(d1)).sort()).toEqual([other]);
    expect((await h.activeReviewers(d2)).sort()).toEqual([other, removed].sort()); // a döntött hely megmarad
    expect((await h.activeReviewers(d3)).sort()).toEqual([other, protectedUser].sort());

    const log = (await h.events(space)).filter((e) => e.type === 'reviewer_removed');
    expect(log).toEqual([
      expect.objectContaining({ actorId: null, documentId: d1, reason: 'allowlist_removed' }),
    ]);
  });

  it('a második futás nem ír újra (idempotens): nincs újabb reviewer_removed', async () => {
    const h = pgHarness(db);
    const [keeper, removed, other, init] = [
      await h.user('keeper'),
      await h.user('removed'),
      await h.user('other'),
      await h.user('init'),
    ];
    const space = await h.space();
    for (const u of [removed, other, init]) await h.member(space, u);
    await h.member(space, keeper, 'space_manager');
    await h.document(space, keeper, {
      pending: { initiatorId: init, reviewers: [removed, other] },
    });
    const wanted = [await emailOf(keeper), await emailOf(other), await emailOf(init)];
    await syncAllowlist(drizzle(db.app), wanted, NOW);
    await syncAllowlist(drizzle(db.app), wanted, NOW);
    expect((await h.events(space)).filter((e) => e.type === 'reviewer_removed')).toHaveLength(1);
  });

  // S8 kiegészítés: a megtartott felhasználó helye a másik két védelmi ok mellett is érintetlen marad.
  it.each([{ reason: 'last_space_manager' as const }, { reason: 'last_admin' as const }])(
    'a védelem miatt megtartott felhasználó ($reason) függő helye nem szűnik meg, nincs esemény',
    async ({ reason }) => {
      const h = pgHarness(db);
      const [protectedUser, keeper, other, init] = [
        await h.user('protected', { admin: reason === 'last_admin' }),
        await h.user('keeper'),
        await h.user('other'),
        await h.user('init'),
      ];
      const space = await h.space();
      for (const u of [protectedUser, other, init]) await h.member(space, u);
      await h.member(space, keeper, 'space_manager');
      const doc = await h.document(space, keeper, {
        pending: { initiatorId: init, reviewers: [protectedUser, other] },
      });
      if (reason === 'last_space_manager') {
        // A védett felhasználó egy másik tér egyetlen gazdája (a review-er helye egy harmadik térben van).
        await h.member(await h.space(), protectedUser, 'space_manager');
      }

      const wanted = [await emailOf(keeper), await emailOf(other), await emailOf(init)];
      const result = await syncAllowlist(drizzle(db.app), wanted, NOW);

      expect(result.removed).toBe(0);
      expect(result.kept).toEqual([{ userId: protectedUser, reason }]);
      expect((await h.activeReviewers(doc)).sort()).toEqual([other, protectedUser].sort());
      expect((await h.events(space)).filter((e) => e.type === 'reviewer_removed')).toEqual([]);
    },
  );

  it('a kiesett felhasználó függő helyei minden térben megszűnnek, térenként egy aktor nélküli esemény', async () => {
    const h = pgHarness(db);
    const [keeper, removed, other, init] = [
      await h.user('keeper'),
      await h.user('removed'),
      await h.user('other'),
      await h.user('init'),
    ];
    const [s1, s2] = [await h.space(), await h.space()];
    for (const space of [s1, s2]) {
      for (const u of [removed, other, init]) await h.member(space, u);
      await h.member(space, keeper, 'space_manager');
    }
    const d1 = await h.document(s1, keeper, {
      pending: { initiatorId: init, reviewers: [removed, other] },
    });
    const d2 = await h.document(s2, keeper, {
      pending: { initiatorId: init, reviewers: [removed, other] },
    });

    const wanted = [await emailOf(keeper), await emailOf(other), await emailOf(init)];
    const result = await syncAllowlist(drizzle(db.app), wanted, NOW);

    expect(result.removed).toBe(1);
    expect(await h.activeReviewers(d1)).toEqual([other]);
    expect(await h.activeReviewers(d2)).toEqual([other]);
    for (const [space, doc] of [
      [s1, d1],
      [s2, d2],
    ] as const) {
      expect((await h.events(space)).filter((e) => e.type === 'reviewer_removed')).toEqual([
        expect.objectContaining({ actorId: null, documentId: doc, reason: 'allowlist_removed' }),
      ]);
    }
  });
});
