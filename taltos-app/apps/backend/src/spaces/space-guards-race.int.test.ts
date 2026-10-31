import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/test-db.js';
import type { Actor } from '../policy/targets.js';
import { createControlPool, runGated } from '../testing/pg-race.js';
import { pgHarness, withReplica } from '../testing/pg-space-harness.js';
import type { StoreResult } from './store.js';

/**
 * WP4a S8 versenyhelyzet-tesztek (PostgreSQL): az „utolsó Színtérgazda” és az „utolsó Rendszeradmin” védelem az
 * alkalmazás-szintű szülő-sor zárakon áll (B4 S8: a `spaces` sor `FOR UPDATE`; az összes `system_admin` sor
 * `ORDER BY id FOR UPDATE`), amit csak valódi Postgres bizonyít. Csak TEST_DATABASE_URL-lel futnak (eldobható superuser-
 * adatbázis); az ügynök ezt nem futtatta, a tulajdonos futtatja.
 *
 * Módszer (`testing/pg-race.ts`): a teszt a szülő sort egy külön kapcsolaton zárolja (kapu), mindkét műveletet a zárra
 * állítja, megvárja, hogy valóban zárra várnak, majd elengedi a kaput. Így az átfedés determinisztikus; ha a tár nem
 * zárolna, a várakozók száma nem érné el a kettőt, és a teszt érthető üzenettel bukik. A „kontroll” tesztek (három
 * gazda/admin, két egyidejű lefokozás mind sikeres) azt bizonyítják, hogy a védelem nem pusztán „mindig az egyiket
 * utasítja el”.
 */
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-31T08:00:00Z');
const user = (userId: string): Actor => ({ userId, systemRole: 'user' });
const admin = (userId: string): Actor => ({ userId, systemRole: 'system_admin' });
const outcome = (result: StoreResult<unknown>): string => (result.ok ? 'ok' : result.code);

describe.skipIf(!url)(
  'az utolsó Színtérgazda / Rendszeradmin versenyhelyzetei (PostgreSQL, WP4a S8)',
  () => {
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

    const activeManagers = async (spaceId: string): Promise<string[]> => {
      const { rows } = await ctl.query<{ user_id: string }>(
        `SELECT user_id FROM space_members
        WHERE space_id = $1 AND role = 'space_manager' AND removed_at IS NULL`,
        [spaceId],
      );
      return rows.map((r) => r.user_id);
    };
    const countEvents = async (type: string): Promise<number> => {
      const { rows } = await ctl.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM events WHERE type = $1',
        [type],
      );
      return rows[0]?.n ?? 0;
    };
    const spaceGate = (spaceId: string) => ({
      gateSql: 'SELECT id FROM spaces WHERE id = $1 FOR UPDATE',
      gateParams: [spaceId],
    });

    describe('Színtérgazda (a `spaces` sor zárja)', () => {
      it('két egyidejű lefokozás az utolsó két gazdán: pontosan egy sikerül, egy gazda marad', async () => {
        const h = pgHarness(db);
        const [m1, m2] = [await h.user('m1'), await h.user('m2')];
        const space = await h.space();
        await h.member(space, m1, 'space_manager');
        await h.member(space, m2, 'space_manager');

        const results = await runGated<StoreResult<unknown>>({
          ctl,
          db,
          ...spaceGate(space),
          what: 'changeRole × changeRole',
          ops: [
            () => h.store.changeRole(user(m2), space, m1, 'author', NOW),
            () => h.store.changeRole(user(m1), space, m2, 'author', NOW),
          ],
        });

        expect(results.map(outcome).sort()).toEqual(['last_space_manager', 'ok']);
        expect(await activeManagers(space)).toHaveLength(1);
        expect((await h.events(space)).filter((e) => e.type === 'role_changed')).toHaveLength(1);
      });

      it('két egyidejű eltávolítás az utolsó két gazdán: pontosan egy sikerül, egy gazda marad', async () => {
        const h = pgHarness(db);
        const [m1, m2] = [await h.user('m1'), await h.user('m2')];
        const space = await h.space();
        await h.member(space, m1, 'space_manager');
        await h.member(space, m2, 'space_manager');

        const results = await runGated<StoreResult<unknown>>({
          ctl,
          db,
          ...spaceGate(space),
          what: 'removeMember × removeMember',
          ops: [
            () => h.store.removeMember(user(m2), space, m1, NOW),
            () => h.store.removeMember(user(m1), space, m2, NOW),
          ],
        });

        expect(results.map(outcome).sort()).toEqual(['last_space_manager', 'ok']);
        expect(await activeManagers(space)).toHaveLength(1);
        expect((await h.events(space)).filter((e) => e.type === 'member_removed')).toHaveLength(1);
      });

      it('lefokozás és eltávolítás vegyesen az utolsó két gazdán: pontosan egy sikerül', async () => {
        const h = pgHarness(db);
        const [m1, m2] = [await h.user('m1'), await h.user('m2')];
        const space = await h.space();
        await h.member(space, m1, 'space_manager');
        await h.member(space, m2, 'space_manager');

        const results = await runGated<StoreResult<unknown>>({
          ctl,
          db,
          ...spaceGate(space),
          what: 'changeRole × removeMember',
          ops: [
            () => h.store.changeRole(user(m2), space, m1, 'author', NOW),
            () => h.store.removeMember(user(m1), space, m2, NOW),
          ],
        });

        expect(results.map(outcome).sort()).toEqual(['last_space_manager', 'ok']);
        expect(await activeManagers(space)).toHaveLength(1);
      });

      it('kontroll: három gazdánál két egyidejű lefokozás mind sikerül (a védelem nem túl szigorú)', async () => {
        const h = pgHarness(db);
        const [m1, m2, m3] = [await h.user('m1'), await h.user('m2'), await h.user('m3')];
        const space = await h.space();
        for (const m of [m1, m2, m3]) await h.member(space, m, 'space_manager');

        const results = await runGated<StoreResult<unknown>>({
          ctl,
          db,
          ...spaceGate(space),
          what: 'changeRole × changeRole (kontroll)',
          ops: [
            () => h.store.changeRole(user(m3), space, m1, 'author', NOW),
            () => h.store.changeRole(user(m3), space, m2, 'author', NOW),
          ],
        });

        expect(results.map(outcome)).toEqual(['ok', 'ok']);
        expect(await activeManagers(space)).toEqual([m3]);
      });

      it('kontroll: három gazdánál két egyidejű eltávolítás mind sikerül', async () => {
        const h = pgHarness(db);
        const [m1, m2, m3] = [await h.user('m1'), await h.user('m2'), await h.user('m3')];
        const space = await h.space();
        for (const m of [m1, m2, m3]) await h.member(space, m, 'space_manager');

        const results = await runGated<StoreResult<unknown>>({
          ctl,
          db,
          ...spaceGate(space),
          what: 'removeMember × removeMember (kontroll)',
          ops: [
            () => h.store.removeMember(user(m3), space, m1, NOW),
            () => h.store.removeMember(user(m3), space, m2, NOW),
          ],
        });

        expect(results.map(outcome)).toEqual(['ok', 'ok']);
        expect(await activeManagers(space)).toEqual([m3]);
      });
    });

    describe('Rendszeradmin (az összes `system_admin` sor, `ORDER BY id`)', () => {
      const adminGate = {
        gateSql: "SELECT id FROM users WHERE system_role = 'system_admin' ORDER BY id FOR UPDATE",
      };
      const adminCount = async (): Promise<number> => {
        const { rows } = await ctl.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM users WHERE system_role = 'system_admin'",
        );
        return rows[0]?.n ?? 0;
      };

      it('két egyidejű visszavonás az utolsó két adminon: pontosan egy sikerül, egy admin marad', async () => {
        const h = pgHarness(db);
        const [r1, r2] = [
          await h.user('root1', { admin: true }),
          await h.user('root2', { admin: true }),
        ];

        const results = await runGated<StoreResult<unknown>>({
          ctl,
          db,
          ...adminGate,
          what: 'changeSystemRole × changeSystemRole',
          ops: [
            () => h.store.changeSystemRole(admin(r2), r1, 'user', NOW),
            () => h.store.changeSystemRole(admin(r1), r2, 'user', NOW),
          ],
        });

        expect(results.map(outcome).sort()).toEqual(['last_admin', 'ok']);
        expect(await adminCount()).toBe(1);
        expect(await countEvents('system_admin_revoked')).toBe(1);
      });

      it('két egyidejű visszavonás ugyanazon az adminon (három admin): a második már „user”-t talál, az esemény egyszer íródik', async () => {
        const h = pgHarness(db);
        const [r1, r2, r3] = [
          await h.user('root1', { admin: true }),
          await h.user('root2', { admin: true }),
          await h.user('root3', { admin: true }),
        ];

        const results = await runGated<StoreResult<unknown>>({
          ctl,
          db,
          ...adminGate,
          what: 'changeSystemRole × changeSystemRole (azonos cél)',
          ops: [
            () => h.store.changeSystemRole(admin(r2), r1, 'user', NOW),
            () => h.store.changeSystemRole(admin(r3), r1, 'user', NOW),
          ],
        });

        // Mindkét hívás sikeres (idempotens), de a visszavonás eseménye egyszer íródik, és két admin marad.
        expect(results.map(outcome)).toEqual(['ok', 'ok']);
        expect(await countEvents('system_admin_revoked')).toBe(1);
        expect(await adminCount()).toBe(2);
      });

      it('kontroll: három adminnál két egyidejű visszavonás mind sikerül, egy admin marad', async () => {
        const h = pgHarness(db);
        const [r1, r2, r3] = [
          await h.user('root1', { admin: true }),
          await h.user('root2', { admin: true }),
          await h.user('root3', { admin: true }),
        ];

        const results = await runGated<StoreResult<unknown>>({
          ctl,
          db,
          ...adminGate,
          what: 'changeSystemRole × changeSystemRole (kontroll)',
          ops: [
            () => h.store.changeSystemRole(admin(r3), r1, 'user', NOW),
            () => h.store.changeSystemRole(admin(r3), r2, 'user', NOW),
          ],
        });

        expect(results.map(outcome)).toEqual(['ok', 'ok']);
        expect(await adminCount()).toBe(1);
        expect(await countEvents('system_admin_revoked')).toBe(2);
      });
    });
  },
);
