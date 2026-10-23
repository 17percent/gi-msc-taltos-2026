import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { TEST_CONFIG, FakeOidc, TestClock } from '../testing/app.js';
import { createTestDb, type TestDb } from '../db/test-db.js';
import { syncAllowlist } from './allowlist.js';
import { createPgAuthStore } from './pg-store.js';
import { SessionService, TOUCH_INTERVAL_MS } from './session-service.js';
import type { OidcIdentity } from './types.js';

/**
 * WP2 adatbázis-tesztek (PostgreSQL ellen, eldobható adatbázison; csak TEST_DATABASE_URL-lel futnak, CI `db` job).
 * A `taltos_app` szerepkörrel futnak: ez bizonyítja, hogy az app jogai elegendők (DELETE nélkül a sessions-on).
 */
const url = process.env.TEST_DATABASE_URL;

/** A rendszerindító e-mail (D54): a tesztekben csak ő lehet az első belépő. */
const BOOTSTRAP = 'owner@example.test';

const identity = (email: string): OidcIdentity => ({
  sub: `sub-${email}`,
  email,
  name: email.split('@')[0] ?? null,
  picture: null,
});

describe.skipIf(!url)('hitelesítés, munkamenet, allowlist-szinkron (WP2)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb(url as string);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  }, 60_000);

  // Minden teszt üres adatbázisról indul (a tábla-sorrend a FK-k miatt: gyerek előbb). A takarítás superuserrel megy.
  beforeEach(async () => {
    const client = await db.admin.connect();
    try {
      // replica-módban a (truncate- és append-only) triggerek nem futnak: csak a teszt-takarításhoz.
      await client.query('SET session_replication_role = replica');
      await client.query(
        'TRUNCATE sessions, space_members, events, documents, spaces, allowlist, users CASCADE',
      );
    } finally {
      // A pool-kapcsolat visszaadása előtt visszaállítjuk, hogy a replica-mód ne szivárogjon más tesztre.
      try {
        await client.query('RESET session_replication_role');
      } finally {
        client.release();
      }
    }
  });

  const store = () => createPgAuthStore(drizzle(db.app), { bootstrapAdminEmail: BOOTSTRAP });
  const now = new Date('2026-10-23T08:00:00Z');
  const allow = (...emails: string[]) => syncAllowlist(drizzle(db.app), emails, now);
  const q = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await db.admin.query<T>(sql, params)).rows;

  it('a migráció után a system_bootstrapped aktor nélkül írható, a többi emberi típus nem (S16)', async () => {
    await db.app.query("INSERT INTO events (type, actor_id) VALUES ('system_bootstrapped', NULL)");
    await expect(
      db.app.query("INSERT INTO events (type, actor_id) VALUES ('member_added', NULL)"),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('allowlist nélküli cím nem léphet be', async () => {
    await allow('anna@example.test');
    expect(await store().login(identity('kivul@example.test'), now)).toEqual({
      status: 'not_on_allowlist',
    });
    expect(await q('SELECT 1 FROM users')).toHaveLength(0);
  });

  it('az első belépő Rendszeradmin és az Általános gazdája, a második csak Szerző (D52)', async () => {
    await allow('owner@example.test', 'user@example.test');
    const first = await store().login(identity('owner@example.test'), now);
    const second = await store().login(identity('user@example.test'), now);
    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    const users = await q<{ email: string; system_role: string }>(
      'SELECT email, system_role FROM users ORDER BY email',
    );
    expect(users).toEqual([
      { email: 'owner@example.test', system_role: 'system_admin' },
      { email: 'user@example.test', system_role: 'user' },
    ]);
    const members = await q<{ email: string; role: string; type: string }>(
      `SELECT u.email, m.role, s.type FROM space_members m
         JOIN users u ON u.id = m.user_id JOIN spaces s ON s.id = m.space_id ORDER BY u.email`,
    );
    expect(members).toEqual([
      { email: 'owner@example.test', role: 'space_manager', type: 'general' },
      { email: 'user@example.test', role: 'author', type: 'general' },
    ]);
    const events = await q<{ type: string; actor_id: string | null }>(
      "SELECT type, actor_id FROM events WHERE type IN ('system_bootstrapped','member_added')",
    );
    expect(events.filter((e) => e.type === 'system_bootstrapped')).toEqual([
      { type: 'system_bootstrapped', actor_id: null },
    ]);
    expect(events.filter((e) => e.type === 'member_added')).toHaveLength(1);
    if (first.status === 'ok') {
      expect((await store().spacesOf(first.userId))[0]).toMatchObject({
        type: 'general',
        role: 'space_manager',
      });
    }
  });

  it('a bootstrap e-mail három egyidejű belépéséből a jog egyszer íródik (versenyhelyzet, D54)', async () => {
    await allow(BOOTSTRAP);
    const results = await Promise.all([1, 2, 3].map(() => store().login(identity(BOOTSTRAP), now)));
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(new Set(results.map((r) => (r.status === 'ok' ? r.userId : ''))).size).toBe(1);
    expect(await q('SELECT 1 FROM users')).toHaveLength(1);
    expect(await q("SELECT 1 FROM users WHERE system_role = 'system_admin'")).toHaveLength(1);
    expect(await q("SELECT 1 FROM spaces WHERE type = 'general'")).toHaveLength(1);
    expect(await q("SELECT 1 FROM space_members WHERE role = 'space_manager'")).toHaveLength(1);
    expect(await q("SELECT 1 FROM events WHERE type = 'system_bootstrapped'")).toHaveLength(1);
  });

  it('rendszerindítás előtt más allowlistes felhasználó setup_pending, semmi sem íródik (D54)', async () => {
    await allow(BOOTSTRAP, 'a@example.test', 'b@example.test');
    const results = await Promise.all(
      ['a', 'b'].map((n) => store().login(identity(`${n}@example.test`), now)),
    );
    expect(results).toEqual([{ status: 'setup_pending' }, { status: 'setup_pending' }]);
    expect(await q('SELECT 1 FROM users')).toHaveLength(0);
    expect(await q('SELECT 1 FROM spaces')).toHaveLength(0);
    expect(await q('SELECT 1 FROM events WHERE type = $1', ['system_bootstrapped'])).toHaveLength(
      0,
    );
  });

  it('egyidejű bootstrap és más belépő: csak a bootstrap e-mail kap jogot (D54)', async () => {
    await allow(BOOTSTRAP, 'a@example.test');
    const [boot, other] = await Promise.all([
      store().login(identity(BOOTSTRAP), now),
      store().login(identity('a@example.test'), now),
    ]);
    expect(boot.status).toBe('ok');
    // A sorrendtől függően a másik a rendszerindítás előtt (setup_pending) vagy után (ok, Szerző) ért oda.
    expect(['setup_pending', 'ok']).toContain(other.status);
    expect(await q("SELECT email FROM users WHERE system_role = 'system_admin'")).toEqual([
      { email: BOOTSTRAP },
    ]);
    expect(await q("SELECT 1 FROM space_members WHERE role = 'space_manager'")).toHaveLength(1);
  });

  it('az ismételt belépés ugyanazt a felhasználót adja, új tagság nélkül', async () => {
    await allow('owner@example.test');
    const one = await store().login(identity('owner@example.test'), now);
    const two = await store().login(identity('owner@example.test'), now);
    expect(two).toEqual(one);
    expect(await q('SELECT 1 FROM users')).toHaveLength(1);
    expect(await q('SELECT 1 FROM space_members')).toHaveLength(1);
  });

  it('másik OIDC-azonosítóhoz kötött e-mail nem vehető át', async () => {
    await allow('owner@example.test');
    await store().login(identity('owner@example.test'), now);
    const other = { ...identity('owner@example.test'), sub: 'masik-sub' };
    expect(await store().login(other, now)).toEqual({ status: 'identity_conflict' });
  });

  describe('munkamenet', () => {
    const policy = {
      absoluteMs: 8 * 3_600_000,
      idleMs: 3_600_000,
      touchIntervalMs: TOUCH_INTERVAL_MS,
    };

    it('újraindítást túlél (a tár új példánya is érvényesíti), időutazással lejár, a visszavonás UPDATE', async () => {
      await allow('owner@example.test');
      const login = await store().login(identity('owner@example.test'), now);
      if (login.status !== 'ok') throw new Error('belépés sikertelen');
      const clock = new TestClock(now);
      const { token } = await new SessionService(store(), policy, clock.now).issue(login.userId);

      // „Újraindítás”: új tár és szolgáltatás-példány, ugyanaz az adatbázis.
      const restarted = new SessionService(store(), policy, clock.now);
      expect((await restarted.authenticate(token))?.userId).toBe(login.userId);

      clock.advance(61 * 60_000); // tétlenség
      expect(await restarted.authenticate(token)).toBeUndefined();

      const fresh = await new SessionService(store(), policy, clock.now).issue(login.userId);
      clock.advance(30 * 60_000);
      expect(await restarted.authenticate(fresh.token)).toBeDefined();
      const session = await restarted.authenticate(fresh.token);
      await restarted.revoke((session as NonNullable<typeof session>).id);
      expect(await restarted.authenticate(fresh.token)).toBeUndefined();
      // Az app szerepnek nincs DELETE-je: a sor megvan, csak lejárt.
      expect(await q('SELECT 1 FROM sessions')).toHaveLength(2);
    });

    it('a last_seen_at írása ritkított (percenként legfeljebb egyszer)', async () => {
      await allow('owner@example.test');
      const login = await store().login(identity('owner@example.test'), now);
      if (login.status !== 'ok') throw new Error('belépés sikertelen');
      const clock = new TestClock(now);
      const service = new SessionService(store(), policy, clock.now);
      const { token } = await service.issue(login.userId);
      const seen = async () =>
        (await q<{ t: Date }>('SELECT last_seen_at AS t FROM sessions'))[0]?.t.getTime();
      clock.advance(30_000);
      await service.authenticate(token);
      expect(await seen()).toBe(now.getTime());
      clock.advance(31_000);
      await service.authenticate(token);
      expect(await seen()).toBe(now.getTime() + 61_000);
    });

    /** b sima Szerző (előbb a rendszerindító e-mail lép be, D54): nem gazda, nem admin, levehető. */
    async function authorWithSession() {
      await allow(BOOTSTRAP, 'b@example.test');
      await store().login(identity(BOOTSTRAP), now);
      const login = await store().login(identity('b@example.test'), now);
      if (login.status !== 'ok') throw new Error('belépés sikertelen');
      const clock = new TestClock(now);
      const app = await buildApp(
        { ...TEST_CONFIG, bootstrapAdminEmail: BOOTSTRAP },
        { store: store(), oidc: new FakeOidc(), cookieSecret: 'k', clock: clock.now },
      );
      const { token } = await new SessionService(store(), policy, clock.now).issue(login.userId);
      const get = () =>
        app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: { cookie: `taltos_sid=${token}` },
        });
      return { app, get };
    }

    it('a konfig-szinkron a levett felhasználó munkamenetét azonnal visszavonja: a következő kérés 401 (HTTP, pg-tárral)', async () => {
      const { app, get } = await authorWithSession();
      try {
        expect((await get()).statusCode).toBe(200);
        const sync = await syncAllowlist(drizzle(db.app), [BOOTSTRAP], now);
        expect(sync.removed).toBe(1);
        expect((await get()).statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('a máshonnan (nem a szinkronból) levett felhasználó következő kérése 403, a munkamenet visszavonva (HTTP, pg-tárral)', async () => {
      const { app, get } = await authorWithSession();
      try {
        expect((await get()).statusCode).toBe(200);
        // Pl. a második ütemes allowlist-felület: a sor kikerül, a munkamenet még él.
        await q("UPDATE allowlist SET deleted_at = now() WHERE email = 'b@example.test'");
        const removed = await get();
        expect(removed.statusCode).toBe(403);
        expect(removed.json()).toMatchObject({ code: 'not_on_allowlist' });
        expect((await get()).statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });
  });

  describe('allowlist-szinkron (D53)', () => {
    it('új cím beszúrva, aktor nélküli eseménnyel; a második futás idempotens', async () => {
      const first = await allow('a@example.test', 'b@example.test');
      expect(first).toMatchObject({ added: 2, removed: 0, reactivated: 0 });
      const again = await allow('b@example.test', 'a@example.test');
      expect(again).toMatchObject({ added: 0, removed: 0, reactivated: 0 });
      expect(
        await q("SELECT 1 FROM events WHERE type = 'allowlist_added' AND actor_id IS NULL"),
      ).toHaveLength(2);
    });

    it('eltávolított cím soft delete, újra felvéve ugyanaz a sor él újra', async () => {
      await allow('a@example.test', 'b@example.test');
      const removed = await allow('a@example.test');
      expect(removed.removed).toBe(1);
      expect(
        await q('SELECT 1 FROM allowlist WHERE email = $1 AND deleted_at IS NOT NULL', [
          'b@example.test',
        ]),
      ).toHaveLength(1);
      const back = await allow('a@example.test', 'b@example.test');
      expect(back.reactivated).toBe(1);
      expect(await q('SELECT 1 FROM allowlist')).toHaveLength(2);
      expect(await q('SELECT 1 FROM allowlist WHERE deleted_at IS NULL')).toHaveLength(2);
    });

    it('üres konfig nem szinkronizálódik', async () => {
      await expect(allow()).rejects.toThrow('nem tartalmaz');
    });

    it('a levett felhasználó munkamenetei azonnal visszavonódnak', async () => {
      await allow(BOOTSTRAP, 'b@example.test');
      await store().login(identity(BOOTSTRAP), now);
      const b = await store().login(identity('b@example.test'), now);
      if (b.status !== 'ok') throw new Error('belépés sikertelen');
      await store().createSession({
        id: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
        userId: b.userId,
        now,
        expiresAt: new Date(now.getTime() + 8 * 3_600_000),
      });
      await allow(BOOTSTRAP);
      const rows = await q<{ expires_at: Date }>('SELECT expires_at FROM sessions');
      expect(rows[0]?.expires_at.getTime()).toBe(now.getTime());
    });

    async function twoUsers(): Promise<{ admin: string; user: string; general: string }> {
      await allow('owner@example.test', 'user@example.test');
      const admin = await store().login(identity('owner@example.test'), now);
      const user = await store().login(identity('user@example.test'), now);
      if (admin.status !== 'ok' || user.status !== 'ok') throw new Error('belépés sikertelen');
      const [space] = await q<{ id: string }>("SELECT id FROM spaces WHERE type = 'general'");
      return { admin: admin.userId, user: user.userId, general: (space as { id: string }).id };
    }

    it('409-védelem: dokumentum-tulajdonos aktív marad (owner_handover_required)', async () => {
      const { user, general } = await twoUsers();
      await db.admin.query(
        `INSERT INTO document_kinds (key, label) VALUES ('teszt', 'Teszt') ON CONFLICT DO NOTHING`,
      );
      await db.admin.query(
        `INSERT INTO documents (id, space_id, slug, title, kind, owner_id, content, created_by)
         VALUES ($1, $2, 'd', 'D', 'teszt', $3, '', $3)`,
        [randomUUID(), general, user],
      );
      const result = await allow('owner@example.test');
      expect(result.removed).toBe(0);
      expect(result.kept).toEqual([{ userId: user, reason: 'owner_handover_required' }]);
      expect(
        await q('SELECT 1 FROM allowlist WHERE email = $1 AND deleted_at IS NULL', [
          'user@example.test',
        ]),
      ).toHaveLength(1);
    });

    it('409-védelem: az utolsó Színtérgazda, majd az utolsó Rendszeradmin aktív marad', async () => {
      const { admin } = await twoUsers();
      const result = await allow('user@example.test');
      expect(result.removed).toBe(0);
      // Az admin egyszerre utolsó gazda és utolsó admin: a gazda-szabály az első.
      expect(result.kept).toEqual([{ userId: admin, reason: 'last_space_manager' }]);
      await db.admin.query("UPDATE space_members SET role = 'space_manager'");
      await db.admin.query(
        "UPDATE users SET system_role = 'user' WHERE email = 'user@example.test'",
      );
      // Mindketten gazdák, de az admin az egyetlen admin.
      const second = await allow('user@example.test');
      expect(second.kept).toEqual([{ userId: admin, reason: 'last_admin' }]);
    });

    it('két utolsó-pótló nem távolítható el egy szinkronban (a korábban törölt már nem számít)', async () => {
      const { admin } = await twoUsers();
      await db.admin.query("UPDATE space_members SET role = 'space_manager'");
      await db.admin.query("UPDATE users SET system_role = 'system_admin'");
      await allow('keep@example.test'); // mindkét meglévő cím kikerül
      const rows = await q<{ email: string }>(
        'SELECT email FROM allowlist WHERE deleted_at IS NULL',
      );
      expect(rows.map((r) => r.email)).toContain('user@example.test');
      expect(admin).toBeDefined();
      expect(rows).toHaveLength(2); // keep + az egyik védett (a rendezés szerint az első törölhető)
    });
  });
});
