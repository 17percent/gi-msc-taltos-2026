import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/test-db.js';
import type { Actor } from '../policy/targets.js';
import {
  createControlPool,
  releaseReplicaClient,
  replicaClient,
  runGated,
  waitForLockWaiters,
} from '../testing/pg-race.js';
import { pgHarness, withReplica } from '../testing/pg-space-harness.js';
import type { StoreResult } from './store.js';

/**
 * WP4a S8: a projekt-tér lezárása (D55) PostgreSQL ellen. Két téma:
 *  1. verseny: lezárás közben beküldés (új függő kérés) vagy review-er csere; lezárás után a térben 0 függő kérés
 *     marad, és nincs árva review-er hely;
 *  2. atomicitás: ha a lezárás bármely lépése elbukik, semmi nem változik (a tér nyitott, a kérés függő, nincs esemény),
 *     és az újrapróbálás hibátlanul lefut.
 * Csak TEST_DATABASE_URL-lel futnak (eldobható superuser-adatbázis); az ügynök ezt nem futtatta, a tulajdonos futtatja.
 *
 * A beküldő (WP5) és a review-er cserélő (WP8) kód még nincs a repóban, ezért azok szerepét nyers SQL-lel játssza a teszt
 * a B4 dokumentált zárprotokollja szerint (beküldés: a `spaces` sor `FOR UPDATE`, B4 S8; csere: a `change_requests` sor
 * `FOR UPDATE`, B4 „crr_at_most_two write-skew”). Ha a WP5/WP8 ReviewService-metódusai elkészülnek, a nyers SQL-t azokra
 * kell cserélni (lásd NEXT ACTION a jelentésben); addig ez a tesztek korlátja: a lezárás oldalát bizonyítják.
 */
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-31T08:00:00Z');
const admin = (userId: string): Actor => ({ userId, systemRole: 'system_admin' });

type CloseValue = { alreadyClosed: boolean; withdrawnRequests: number };

describe.skipIf(!url)('projekt-tér lezárása (PostgreSQL, WP4a S8)', () => {
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
        'TRUNCATE change_request_reviewers, change_requests, space_members, events, documents, spaces, allowlist, users CASCADE',
      ),
    );
  });

  const one = async <T extends pg.QueryResultRow>(
    sqlText: string,
    params: unknown[],
  ): Promise<T | undefined> => (await ctl.query<T>(sqlText, params)).rows[0];

  /** Projekt-tér egy függő kéréssel (indítványozó + két review-er) és egy rendszeradminnal. */
  async function pendingProject() {
    const h = pgHarness(db);
    const [manager, init, r1, r2, root] = [
      await h.user('m'),
      await h.user('init'),
      await h.user('r1'),
      await h.user('r2'),
      await h.user('root', { admin: true }),
    ];
    const space = await h.space({ type: 'project' });
    for (const u of [init, r1, r2]) await h.member(space, u);
    await h.member(space, manager, 'space_manager');
    const doc = await h.document(space, manager, {
      pending: { initiatorId: init, reviewers: [r1, r2] },
    });
    const cr = (
      await one<{ id: string }>('SELECT id FROM change_requests WHERE document_id = $1', [doc])
    )?.id as string;
    return { h, manager, init, r1, r2, root, space, doc, cr };
  }

  /** A lezárás utáni invariánsok: nincs függő kérés, nincs `pending` dokumentum, nincs aktív (árva) review-er hely. */
  async function expectNothingPendingIn(spaceId: string): Promise<void> {
    const pendingRequests = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM change_requests c JOIN documents d ON d.id = c.document_id
        WHERE d.space_id = $1 AND c.state = 'pending'`,
      [spaceId],
    );
    expect(pendingRequests?.n, 'függő kérés a lezárt térben').toBe(0);
    const pendingDocs = await one<{ n: number }>(
      "SELECT count(*)::int AS n FROM documents WHERE space_id = $1 AND review_state = 'pending'",
      [spaceId],
    );
    expect(pendingDocs?.n, '`pending` dokumentum a lezárt térben').toBe(0);
    const orphanSlots = await one<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM change_request_reviewers r
         JOIN change_requests c ON c.id = r.change_request_id
         JOIN documents d ON d.id = c.document_id
        WHERE d.space_id = $1 AND r.ended_at IS NULL`,
      [spaceId],
    );
    expect(
      orphanSlots?.n,
      'aktív (ended_at IS NULL) review-er hely a lezárt térben: az el nem döntött helyek `closed` jelölést kapnak (B4 S15)',
    ).toBe(0);
  }

  describe('verseny', () => {
    /**
     * A beküldés (WP5) szerepe nyers SQL-lel: a `spaces` sor zárolása, lezártság ellenőrzése a zár alatt, majd a kérés és a
     * két review-er beszúrása, a dokumentum `pending`-re állítása. Replica módú (trigger- és FK-mentes) kapcsolaton, mert a
     * teszt a zárprotokollt vizsgálja, nem a beküldés triggereit.
     */
    async function submitLikeWp5(
      spaceId: string,
      documentId: string,
      initiatorId: string,
      reviewerIds: string[],
    ): Promise<'submitted' | 'refused_closed'> {
      const c = await replicaClient(ctl);
      try {
        await c.query('BEGIN');
        const space = await c.query<{ closed: boolean }>(
          'SELECT closed_at IS NOT NULL AS closed FROM spaces WHERE id = $1 FOR UPDATE',
          [spaceId],
        );
        if (space.rows[0]?.closed === true) {
          await c.query('ROLLBACK');
          return 'refused_closed';
        }
        const requestId = randomUUID();
        await c.query(
          `INSERT INTO change_requests (id, document_id, kind, proposed_revision_id, proposed_review_due_at, initiator_id)
           VALUES ($1, $2, 'update', $3, now() + interval '1 year', $4)`,
          [requestId, documentId, randomUUID(), initiatorId],
        );
        for (const reviewerId of reviewerIds) {
          await c.query(
            'INSERT INTO change_request_reviewers (change_request_id, reviewer_id) VALUES ($1, $2)',
            [requestId, reviewerId],
          );
        }
        await c.query("UPDATE documents SET review_state = 'pending' WHERE id = $1", [documentId]);
        await c.query('COMMIT');
        return 'submitted';
      } catch (error) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        await releaseReplicaClient(c);
      }
    }

    it.each([
      { order: 'a lezárás előbb', closeFirst: true },
      { order: 'a beküldés előbb', closeFirst: false },
    ])(
      'lezárás és egyidejű beküldés ($order): lezárás után 0 függő kérés a térben',
      async ({ closeFirst }) => {
        const { h, init, r1, r2, root, space } = await pendingProject();
        const draft = await h.document(space, init); // a beküldés célja: piszkozat, amelynek nincs függő kérése

        type Done =
          | { kind: 'close'; result: StoreResult<CloseValue> }
          | { kind: 'submit'; result: 'submitted' | 'refused_closed' };
        const close = async (): Promise<Done> => ({
          kind: 'close',
          result: await h.store.closeSpace(admin(root), space, NOW),
        });
        const submit = async (): Promise<Done> => ({
          kind: 'submit',
          result: await submitLikeWp5(space, draft, init, [r1, r2]),
        });

        const done = await runGated<Done>({
          ctl,
          db,
          gateSql: 'SELECT id FROM spaces WHERE id = $1 FOR UPDATE',
          gateParams: [space],
          what: 'closeSpace × beküldés',
          ops: closeFirst ? [close, submit] : [submit, close],
        });
        const closed = done.find((d) => d.kind === 'close')?.result as StoreResult<CloseValue>;
        const submitted = done.find((d) => d.kind === 'submit')?.result;

        expect(closed.ok).toBe(true);
        await expectNothingPendingIn(space);
        const spaceRow = await one<{ closed_at: Date | null }>(
          'SELECT closed_at FROM spaces WHERE id = $1',
          [space],
        );
        expect(spaceRow?.closed_at).not.toBeNull();

        // A sorrendet az érkezés (FIFO a sorzár-soron) adja, így mindkét ág lefut:
        if (closeFirst) {
          // A beküldő a zár alatt már lezárt teret lát, és visszalép; a lezárás csak a meglévő kérést vonta vissza.
          expect(submitted).toBe('refused_closed');
          expect(closed.ok && closed.value.withdrawnRequests).toBe(1);
        } else {
          // A beküldés előbb ért véget: a lezárás az új kérést is visszavonta (aktor nélkül, `space_closed` ok).
          expect(submitted).toBe('submitted');
          expect(closed.ok && closed.value.withdrawnRequests).toBe(2);
          const withdrawn = (await h.events(space)).filter((e) => e.type === 'review_withdrawn');
          expect(withdrawn).toHaveLength(2);
          for (const e of withdrawn) {
            expect(e).toMatchObject({ actorId: null, reason: 'space_closed' });
          }
        }
        expect((await h.events(space)).filter((e) => e.type === 'space_closed')).toHaveLength(1);
      },
    );

    it('lezárás közben egy review-er cseréje folyamatban: a lezárás után nincs árva (aktív) review-er hely a visszavont kérésen', async () => {
      const { h, r2, root, space, cr } = await pendingProject();
      const r3 = await h.user('r3');

      // A cserélő (WP8 szerepe nyers SQL-lel, valódi triggerekkel, app-szerepkörrel): a kérés sorának zárolása, a régi hely
      // lezárása és az új beszúrása; a COMMIT előtt indul a lezárás, így az annak seprő utasítása a cserélőre vár.
      const replacer = await db.app.connect();
      let closing: Promise<StoreResult<CloseValue>> | undefined;
      try {
        await replacer.query('BEGIN');
        await replacer.query(
          "SELECT id FROM change_requests WHERE id = $1 AND state = 'pending' FOR UPDATE",
          [cr],
        );
        await replacer.query(
          `UPDATE change_request_reviewers SET ended_at = now(), end_reason = 'replaced'
            WHERE change_request_id = $1 AND reviewer_id = $2 AND ended_at IS NULL`,
          [cr, r2],
        );
        await replacer.query(
          'INSERT INTO change_request_reviewers (change_request_id, reviewer_id) VALUES ($1, $2)',
          [cr, r3],
        );

        closing = h.store.closeSpace(admin(root), space, NOW);
        closing.catch(() => undefined);
        await waitForLockWaiters(ctl, db, 1, 'closeSpace a review-er cserélő tranzakcióra vár');
        await replacer.query('COMMIT');
      } catch (error) {
        await replacer.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        replacer.release();
      }

      const result = await closing;
      expect(result?.ok).toBe(true);
      const request = await one<{ state: string }>(
        'SELECT state FROM change_requests WHERE id = $1',
        [cr],
      );
      expect(request?.state).toBe('withdrawn');
      // A seprő utasítás pillanatképe a cserélő COMMIT-ja előtt készült: az új (r3) sor láthatatlan lehet neki, és aktív
      // marad egy visszavont kérésen. Ez a teszt éppen ezt a hibát keresi; ha pirosan indul, a javítás a szerzőé.
      await expectNothingPendingIn(space);
    });
  });

  describe('atomicitás', () => {
    /** A lezárás által érintett összes állapot: ha a lezárás elbukik, ennek változatlannak kell maradnia. */
    async function snapshot(spaceId: string) {
      const rows = async (sqlText: string): Promise<unknown[]> =>
        (await ctl.query<Record<string, unknown>>(sqlText, [spaceId])).rows;
      return {
        space: await rows('SELECT closed_at, deleted_at FROM spaces WHERE id = $1'),
        requests: await rows(
          `SELECT c.id, c.state, c.decided_at FROM change_requests c
             JOIN documents d ON d.id = c.document_id WHERE d.space_id = $1 ORDER BY c.id`,
        ),
        reviewers: await rows(
          `SELECT r.id, r.decision, r.ended_at, r.end_reason FROM change_request_reviewers r
             JOIN change_requests c ON c.id = r.change_request_id
             JOIN documents d ON d.id = c.document_id WHERE d.space_id = $1 ORDER BY r.id`,
        ),
        documents: await rows(
          'SELECT id, review_state FROM documents WHERE space_id = $1 ORDER BY id',
        ),
        events: await rows('SELECT id, type FROM events WHERE space_id = $1 ORDER BY id'),
      };
    }

    // A lezárás lépései: (1) `spaces.closed_at`, (2) a kérések/helyek/dokumentumok visszavonása egy CTE-utasításban,
    // (3) `review_withdrawn` események, (4) `space_closed` esemény. Mindegyik pontra ideiglenes CHECK-et teszünk
    // (az eldobható adatbázison), hogy pontosan ott bukjon el; a kényszer a `finally`-ban visszavonódik.
    it.each([
      { step: '1. closed_at beállítása', table: 'spaces', check: 'closed_at IS NULL' },
      {
        step: '2. review-er helyek lezárása (visszavonó CTE)',
        table: 'change_request_reviewers',
        check: "end_reason IS DISTINCT FROM 'closed'",
      },
      {
        step: '3. review_withdrawn események (a lezárás közepe)',
        table: 'events',
        check: "type <> 'review_withdrawn'",
      },
      {
        step: '4. space_closed esemény (utolsó lépés)',
        table: 'events',
        check: "type <> 'space_closed'",
      },
    ])(
      'hiba a lezárás $step lépésében: semmi nem változik, az újrapróbálás hibátlanul lefut',
      async ({ table, check }) => {
        const { h, root, space, doc } = await pendingProject();
        const before = await snapshot(space);
        expect(before.requests).toHaveLength(1); // a fixture tényleg tartalmaz függő kérést
        expect(await h.reviewState(doc)).toBe('pending');

        await db.admin.query(`ALTER TABLE ${table} ADD CONSTRAINT zz_fail_inject CHECK (${check})`);
        try {
          await expect(h.store.closeSpace(admin(root), space, NOW)).rejects.toThrow();
        } finally {
          await db.admin.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS zz_fail_inject`);
        }

        // Teljes állapot-összevetés: a tér nyitott, a kérés és a helyek érintetlenek, nincs új esemény.
        expect(await snapshot(space)).toEqual(before);

        // Az újrapróbálás tiszta lappal indul: nem „már lezárt”, és a függő kérést most vonja vissza.
        const retry = await h.store.closeSpace(admin(root), space, NOW);
        expect(retry).toEqual({ ok: true, value: { alreadyClosed: false, withdrawnRequests: 1 } });
        await expectNothingPendingIn(space);
      },
    );
  });
});
