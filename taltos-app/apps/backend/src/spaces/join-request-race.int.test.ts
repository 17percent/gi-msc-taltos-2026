import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/test-db.js';
import { createControlPool, waitForLockWaiters } from '../testing/pg-race.js';
import { pgHarness, withReplica } from '../testing/pg-space-harness.js';

/**
 * WP4a S8, 9. eset: egyidejű felvételi kérések ugyanarra a (tér, felhasználó) párra: pontosan egy függő sor marad.
 * Két réteg:
 *  - adatbázis-szint (MOST fut, nyers SQL-lel): a `membership_requests_one_pending_uq` részleges egyedi index
 *    (0004) a versenyben atomi védelem;
 *  - alkalmazás-szint (S5 UTÁN): az S5 felvételi-kérés tár-metódusának versenye (409 `request_pending`, nem 500) — lásd a
 *    kihagyott helyőrzőt alul.
 * Csak TEST_DATABASE_URL-lel futnak (eldobható superuser-adatbázis); az ügynök ezt nem futtatta, a tulajdonos futtatja.
 */
const url = process.env.TEST_DATABASE_URL;
const INDEX = 'membership_requests_one_pending_uq';

describe.skipIf(!url)('egyidejű felvételi kérések (PostgreSQL, WP4a S8)', () => {
  let db: TestDb;
  let ctl: pg.Pool;

  beforeAll(async () => {
    db = await createTestDb(url as string);
    ctl = createControlPool(url as string, db);
  }, 120_000);

  afterAll(async () => {
    await ctl?.end();
    await db?.stop();
  }, 60_000);

  beforeEach(async () => {
    await withReplica(db.admin, (c) =>
      c.query(
        'TRUNCATE change_request_reviewers, change_requests, space_members, membership_requests, events, documents, spaces, allowlist, users CASCADE',
      ),
    );
  });

  const insertPending = (client: pg.PoolClient, spaceId: string, userId: string) =>
    client.query('INSERT INTO membership_requests (space_id, user_id) VALUES ($1, $2)', [
      spaceId,
      userId,
    ]);
  const countRows = async (spaceId: string, userId: string, state?: string): Promise<number> => {
    const { rows } = await ctl.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM membership_requests
        WHERE space_id = $1 AND user_id = $2 AND ($3::text IS NULL OR state::text = $3)`,
      [spaceId, userId, state ?? null],
    );
    return rows[0]?.n ?? 0;
  };

  async function twoSessions<T>(
    fn: (a: pg.PoolClient, b: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const a = await db.app.connect();
    const b = await db.app.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      return await fn(a, b);
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
  }

  it('két egyidejű függő kérés ugyanarra a párra: az első commitol, a második 23505 az egyedi indexen, egy sor marad', async () => {
    const h = pgHarness(db);
    const [applicant, space] = [await h.user('applicant'), await h.space()];

    await twoSessions(async (a, b) => {
      await insertPending(a, space, applicant);
      const second = insertPending(b, space, applicant); // az első commitjára vár (egyedi index)
      second.catch(() => undefined);
      await waitForLockWaiters(ctl, db, 1, 'a második beszúrás az első tranzakcióra vár');
      await a.query('COMMIT');
      await expect(second).rejects.toMatchObject({ code: '23505', constraint: INDEX });
    });

    expect(await countRows(space, applicant)).toBe(1);
  });

  it('ha az első tranzakció visszagördül, a második beszúrás sikerül (nem marad maradványzár), egy sor lesz', async () => {
    const h = pgHarness(db);
    const [applicant, space] = [await h.user('applicant'), await h.space()];

    await twoSessions(async (a, b) => {
      await insertPending(a, space, applicant);
      const second = insertPending(b, space, applicant);
      second.catch(() => undefined);
      await waitForLockWaiters(ctl, db, 1, 'a második beszúrás az első tranzakcióra vár');
      await a.query('ROLLBACK');
      await second;
      await b.query('COMMIT');
    });

    expect(await countRows(space, applicant)).toBe(1);
  });

  it('a döntött kérés nem foglalja a helyet: új függő kérés felvehető, a függő mindig egyetlen', async () => {
    const h = pgHarness(db);
    const [applicant, manager, space] = [
      await h.user('applicant'),
      await h.user('manager'),
      await h.space(),
    ];
    const first = await db.app.connect();
    try {
      await insertPending(first, space, applicant);
    } finally {
      first.release();
    }
    await db.app.query(
      `UPDATE membership_requests SET state = 'rejected', decided_by = $3, decided_at = now()
        WHERE space_id = $1 AND user_id = $2`,
      [space, applicant, manager],
    );
    const again = await db.app.connect();
    try {
      await insertPending(again, space, applicant);
      await expect(insertPending(again, space, applicant)).rejects.toMatchObject({
        code: '23505',
        constraint: INDEX,
      });
    } finally {
      again.release();
    }

    expect(await countRows(space, applicant, 'pending')).toBe(1);
    expect(await countRows(space, applicant, 'rejected')).toBe(1);
  });

  // S5 UTÁN: az S5 (felvételi kérések) kódja nincs ebben az ágban, a tár-metódus neve itt nem ismert, ezért nem
  // találjuk ki. A helyőrző az S5 `SpaceStore`-metódusát hívja majd, amely a `POST /api/v1/spaces/:id/membership-requests`
  // (B5) mögött áll. Teendő az S5 beolvasztása után: a metódus nevét és aláírását beírni, majd a törzset kitölteni.
  it.skip('TODO(S5): két egyidejű felvételi kérés (az S5 membership-request tár-metódusa) → egy függő sor, a másik `request_pending` (409), nem 500', async () => {
    // 1. fixture: nem tag felhasználó + nyitott tér (pgHarness), mint fent.
    // 2. runGated (testing/pg-race.ts): a kapu a tér sorának FOR UPDATE zára, ha az S5 a `spaces` sort zárolja; ha az S5
    //    csak az egyedi indexre támaszkodik, a fenti `twoSessions` minta (az első commitjára vár a második) a kapu.
    // 3. elvárás: pontosan egy `ok`, a másik `request_pending` StoreFailure (nem kivétel); `countRows(space, user, 'pending') === 1`.
    // 4. negatív: Rendszeradminnak `forbidden`, lezárt térbe `space_closed`, tagnak validációs hiba — az S5 szerződése szerint.
  });
});
