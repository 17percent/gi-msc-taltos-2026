import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/test-db.js';
import type { Actor } from '../policy/targets.js';
import { createControlPool, holdLock, waitForLockWaiters } from '../testing/pg-race.js';
import { pgHarness, withReplica } from '../testing/pg-space-harness.js';
import { syncAllowlist } from './allowlist.js';

/**
 * WP4a S8, 7. eset: a WP2 allowlist-szinkron (`blockedBy`) és a WP4a tagkezelés (`removeMember`, `changeSystemRole`)
 * ugyanazt az „utolsó gazda / utolsó admin” fogalmat használja (`spaces/guards.ts`). Itt PostgreSQL ellen bizonyítjuk, hogy
 * a két út ugyanarra a helyzetre ugyanazt mondja, és hogy egyidejű futásban sem veszíthető el az utolsó gazda/admin.
 * Csak TEST_DATABASE_URL-lel futnak (eldobható superuser-adatbázis); az ügynök ezt nem futtatta, a tulajdonos futtatja.
 */
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-31T08:00:00Z');
const user = (userId: string): Actor => ({ userId, systemRole: 'user' });
const admin = (userId: string): Actor => ({ userId, systemRole: 'system_admin' });

describe.skipIf(!url)(
  'allowlist-szinkron és tagkezelés: az utolsó gazda/admin (PostgreSQL, WP4a S8)',
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

    const emailOf = async (userId: string): Promise<string> => {
      const { rows } = await ctl.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [
        userId,
      ]);
      return (rows[0]?.email as string).toLowerCase();
    };
    const activeEmails = async (): Promise<string[]> => {
      const { rows } = await ctl.query<{ email: string }>(
        'SELECT email FROM allowlist WHERE deleted_at IS NULL ORDER BY email',
      );
      return rows.map((r) => r.email);
    };
    /** A „konfig” a jelenlegi aktív allowlist, a megadott címek nélkül. */
    const configWithout = async (...removed: string[]): Promise<string[]> =>
      (await activeEmails()).filter((email) => !removed.includes(email));
    const sync = (wanted: string[]) => syncAllowlist(drizzle(db.app), wanted, NOW);

    describe('7. a két út ugyanazt mondja az „utolsó Színtérgazdáról”', () => {
      type Harness = ReturnType<typeof pgHarness>;
      interface Scenario {
        name: string;
        /** Felépít egy teret, amelynek `subject` gazdája; visszaadja a tér és a kérdéses gazda azonosítóját. */
        build: (h: Harness) => Promise<{ space: string; subject: string }>;
        /** Az eltávolítás védett-e (az `subject` az utolsó aktív gazda). */
        lastManager: boolean;
      }
      const scenarios: Scenario[] = [
        {
          name: 'két aktív gazda: az eltávolítás szabad',
          lastManager: false,
          build: async (h) => {
            const [subject, other] = [await h.user('subject'), await h.user('other')];
            const space = await h.space();
            await h.member(space, subject, 'space_manager');
            await h.member(space, other, 'space_manager');
            return { space, subject };
          },
        },
        {
          name: 'a másik gazdának nincs allowlist-bejegyzése: nem számít pótlónak',
          lastManager: true,
          build: async (h) => {
            const [subject, ghost] = [
              await h.user('subject'),
              await h.user('ghost', { allowlisted: false }),
            ];
            const space = await h.space();
            await h.member(space, subject, 'space_manager');
            await h.member(space, ghost, 'space_manager');
            return { space, subject };
          },
        },
        {
          name: 'a másik gazda allowlist-bejegyzése törölt (soft delete): nem számít pótlónak',
          lastManager: true,
          build: async (h) => {
            const [subject, other] = [await h.user('subject'), await h.user('other')];
            const space = await h.space();
            await h.member(space, subject, 'space_manager');
            await h.member(space, other, 'space_manager');
            await ctl.query('UPDATE allowlist SET deleted_at = now() WHERE email = $1', [
              await emailOf(other),
            ]);
            return { space, subject };
          },
        },
        {
          name: 'a másik gazda már kikerült a térből (removed_at): nem számít pótlónak',
          lastManager: true,
          build: async (h) => {
            const [subject, gone] = [await h.user('subject'), await h.user('gone')];
            const space = await h.space();
            await h.member(space, subject, 'space_manager');
            await h.member(space, gone, 'space_manager');
            await ctl.query(
              'UPDATE space_members SET removed_at = now() WHERE space_id = $1 AND user_id = $2',
              [space, gone],
            );
            return { space, subject };
          },
        },
        {
          name: 'a másik gazda mindössze Szerző: nem számít pótlónak',
          lastManager: true,
          build: async (h) => {
            const [subject, author] = [await h.user('subject'), await h.user('author')];
            const space = await h.space();
            await h.member(space, subject, 'space_manager');
            await h.member(space, author, 'author');
            return { space, subject };
          },
        },
        {
          name: 'a másik gazda e-mailje nagybetűs a `users`-ben (az allowlist kisbetűs): aktívnak számít',
          lastManager: false,
          build: async (h) => {
            const [subject, other] = [await h.user('subject'), await h.user('other')];
            const space = await h.space();
            await h.member(space, subject, 'space_manager');
            await h.member(space, other, 'space_manager');
            await ctl.query('UPDATE users SET email = upper(email) WHERE id = $1', [other]);
            return { space, subject };
          },
        },
        {
          name: 'a kérdéses gazda e-mailje nagybetűs a `users`-ben: a szinkron is megtalálja, és ugyanúgy dönt',
          lastManager: true,
          build: async (h) => {
            const subject = await h.user('subject');
            const space = await h.space();
            await h.member(space, subject, 'space_manager');
            await ctl.query('UPDATE users SET email = upper(email) WHERE id = $1', [subject]);
            return { space, subject };
          },
        },
      ];

      it.each(scenarios)('$name', async ({ build, lastManager }) => {
        const h = pgHarness(db);
        // Két azonos felépítésű világ: az egyiken a tagkezelés, a másikon a szinkron dönt (a döntés ír, ezért nem ugyanazon).
        const viaStore = await build(h);
        const viaSync = await build(h);

        const removal = await h.store.removeMember(
          user(viaStore.subject),
          viaStore.space,
          viaStore.subject,
          NOW,
        );
        const storeBlocked = !removal.ok && removal.code === 'last_space_manager';
        if (!removal.ok) expect(removal.code).toBe('last_space_manager'); // más ok nem fordulhat elő

        const result = await sync(await configWithout(await emailOf(viaSync.subject)));
        const syncKept = result.kept.find((k) => k.userId === viaSync.subject);
        const syncBlocked = syncKept?.reason === 'last_space_manager';
        if (syncKept) expect(syncKept.reason).toBe('last_space_manager');

        expect({ storeBlocked, syncBlocked }).toEqual({
          storeBlocked: lastManager,
          syncBlocked: lastManager,
        });
        expect(result.removed).toBe(lastManager ? 0 : 1);
      });

      it('egyetlen szinkronban két utolsó-pótló sem távolítható el: az egyik marad (gazda)', async () => {
        const h = pgHarness(db);
        const [m1, m2, member] = [await h.user('m1'), await h.user('m2'), await h.user('member')];
        const space = await h.space();
        await h.member(space, m1, 'space_manager');
        await h.member(space, m2, 'space_manager');
        await h.member(space, member);

        const result = await sync(await configWithout(await emailOf(m1), await emailOf(m2)));

        expect(result.removed).toBe(1);
        expect(result.kept).toHaveLength(1);
        expect(result.kept[0]?.reason).toBe('last_space_manager');
        const { rows } = await ctl.query<{ n: number }>(
          `SELECT count(*)::int AS n
           FROM space_members sm JOIN users u ON u.id = sm.user_id
           JOIN allowlist a ON a.email = lower(u.email) AND a.deleted_at IS NULL
          WHERE sm.space_id = $1 AND sm.role = 'space_manager' AND sm.removed_at IS NULL`,
          [space],
        );
        expect(rows[0]?.n).toBe(1);
      });

      it('kontroll: három gazdánál egy szinkronban kettő is eltávolítható', async () => {
        const h = pgHarness(db);
        const [m1, m2, m3] = [await h.user('m1'), await h.user('m2'), await h.user('m3')];
        const space = await h.space();
        for (const m of [m1, m2, m3]) await h.member(space, m, 'space_manager');

        const result = await sync(await configWithout(await emailOf(m1), await emailOf(m2)));

        expect(result.removed).toBe(2);
        expect(result.kept).toEqual([]);
      });
    });

    /**
     * Egyidejűség: a szinkron `blockedBy` ellenőrzése nem zárolja a `spaces` / `users(system_admin)` sorokat (a tagkezelés
     * igen, B4 S8), így a szinkron „van másik gazda/admin” döntése és a tagkezelés „van másik gazda/admin” döntése
     * ugyanarra a másikra támaszkodhat, miközben egymást érvénytelenítik (write-skew).
     * A teszt determinisztikus: a szinkront az `allowlist`-sor UPDATE-jénél egy tesztkapcsolat sorzára tartja fel; a
     * tagkezelés ekkor indul, és a szinkron által már zárolt `spaces` / admin sornál kell várnia (két zárra váró munkamenet),
     * majd a kapu feloldódik. Elvárt (helyes) viselkedés: a tagkezelés a szinkron után, annak eredményét látva dönt, és a
     * végén marad belépni képes gazda/admin. Ha a második várakozó nem jelenik meg, a szinkron nem zárol (F2 regresszió).
     */
    describe('7b. a szinkron egyidejű a tagkezeléssel: az utolsó gazda/admin nem veszhet el (write-skew)', () => {
      const allowlistGate = (email: string) =>
        holdLock(ctl, 'SELECT email FROM allowlist WHERE email = $1 FOR UPDATE', [email]);

      it('szinkron kivesz egy gazdát, miközben a másik gazdát eltávolítják: marad belépni képes gazda', async () => {
        const h = pgHarness(db);
        const [m1, m2] = [await h.user('m1'), await h.user('m2')];
        const space = await h.space();
        await h.member(space, m1, 'space_manager');
        await h.member(space, m2, 'space_manager');

        const wanted = await configWithout(await emailOf(m1));
        const gate = await allowlistGate(await emailOf(m1));
        let syncing: ReturnType<typeof sync> | undefined;
        let removing: ReturnType<typeof h.store.removeMember> | undefined;
        try {
          syncing = sync(wanted);
          syncing.catch(() => undefined);
          // A szinkron a tér sorát már a döntése előtt zárolja, és az m1 allowlist-soránál vár.
          await waitForLockWaiters(ctl, db, 1, 'syncAllowlist az allowlist-sor UPDATE-jénél vár');
          // A tagkezelés a tér sorának zárjánál a szinkron mögé sorolódik (nem dönthet ugyanarra a másik gazdára).
          removing = h.store.removeMember(user(m1), space, m2, NOW);
          removing.catch(() => undefined);
          await waitForLockWaiters(
            ctl,
            db,
            2,
            'removeMember a tér sorának záránál a szinkron mögött vár',
          );
        } finally {
          await gate.release();
        }
        await syncing;
        const removal = await removing;

        const { rows } = await ctl.query<{ n: number }>(
          `SELECT count(*)::int AS n
           FROM space_members sm JOIN users u ON u.id = sm.user_id
           JOIN allowlist a ON a.email = lower(u.email) AND a.deleted_at IS NULL
          WHERE sm.space_id = $1 AND sm.role = 'space_manager' AND sm.removed_at IS NULL`,
          [space],
        );
        expect(
          rows[0]?.n,
          `belépni képes Színtérgazda a térben (removeMember: ${removal.ok ? 'ok' : removal.code}): a szinkron és a tagkezelés egymás döntésére támaszkodott`,
        ).toBeGreaterThanOrEqual(1);
      });

      it('szinkron kivesz egy admint, miközben a másik admint lefokozzák: marad belépni képes admin', async () => {
        const h = pgHarness(db);
        const [r1, r2] = [
          await h.user('root1', { admin: true }),
          await h.user('root2', { admin: true }),
        ];

        const wanted = await configWithout(await emailOf(r1));
        const gate = await allowlistGate(await emailOf(r1));
        let syncing: ReturnType<typeof sync> | undefined;
        let demoting: ReturnType<typeof h.store.changeSystemRole> | undefined;
        try {
          syncing = sync(wanted);
          syncing.catch(() => undefined);
          await waitForLockWaiters(ctl, db, 1, 'syncAllowlist az allowlist-sor UPDATE-jénél vár');
          // A lefokozás az admin-sorok záránál a szinkron mögé sorolódik.
          demoting = h.store.changeSystemRole(admin(r1), r2, 'user', NOW);
          demoting.catch(() => undefined);
          await waitForLockWaiters(
            ctl,
            db,
            2,
            'changeSystemRole az admin-sorok záránál a szinkron mögött vár',
          );
        } finally {
          await gate.release();
        }
        await syncing;
        const demotion = await demoting;

        const { rows } = await ctl.query<{ n: number }>(
          `SELECT count(*)::int AS n
           FROM users u JOIN allowlist a ON a.email = lower(u.email) AND a.deleted_at IS NULL
          WHERE u.system_role = 'system_admin'`,
        );
        expect(
          rows[0]?.n,
          `belépni képes Rendszeradmin (changeSystemRole: ${demotion.ok ? 'ok' : demotion.code}): a szinkron és a lefokozás egymás döntésére támaszkodott`,
        ).toBeGreaterThanOrEqual(1);
      });
    });
  },
);
