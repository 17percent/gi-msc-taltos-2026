import pg from 'pg';
import type { TestDb } from '../db/test-db.js';

/**
 * Versenyhelyzet-segédek a PostgreSQL integrációs tesztekhez (WP4a S8). Nincs `sleep`: a szinkronizáció egy tesztkapcsolat
 * által tartott sorzár (a „kapu”) és a `pg_stat_activity` állapotfigyelése: a tesztelt műveletek a kapun állnak sorba,
 * a teszt megvárja, amíg valóban a zárra vártak (`wait_event_type = 'Lock'`), és csak utána engedi el a kaput.
 *
 * Miért kell a kapu: két `Promise.all`-lal indított tranzakció átfedése időzítésfüggő, így a szabály megszegése is csak
 * „néha” látszana. A kapuval az átfedés determinisztikus: mindkét művelet a zárnál áll, amikor az első továbbmehet. Ha a
 * tesztelt kód NEM veszi fel a várt szülő-sor zárat (B4 S8), akkor a várakozók száma sosem éri el az elvárt értéket, és
 * a teszt érthető üzenettel bukik (nem lóg örökké).
 *
 * Az `admin` pool (max 2) kevés a kapu + figyelés + fixture együttes használatához, ezért a teszt külön, saját
 * superuser pool-t (`createControlPool`) kap ugyanarra az adatbázisra. A sorrend: a sorbaállás sorrendje a Postgres
 * sorzár-sorában FIFO, ezért az érkezési sorrend (egyenként várjuk meg a várakozót) a feldolgozás sorrendje is.
 */

/** Külön superuser pool a teszt-adatbázisra (kapu, figyelés, ellenőrző lekérdezések). */
export function createControlPool(superuserUrl: string, db: TestDb): pg.Pool {
  const url = new URL(superuserUrl);
  url.pathname = `/${db.database}`;
  return new pg.Pool({ connectionString: url.toString(), max: 4 });
}

/**
 * Megvárja, hogy legalább `expected` háttérfolyamat várjon zárra a teszt-adatbázisban. Állapotfigyelés, nem fix
 * várakozás: a lekérdezés körbefordulása adja az ütemet, a határidő csak a lógás ellen véd.
 */
export async function waitForLockWaiters(
  ctl: pg.Pool,
  db: TestDb,
  expected: number,
  what: string,
  deadlineMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const { rows } = await ctl.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
          AND state = 'active' AND wait_event_type = 'Lock'`,
      [db.database],
    );
    if ((rows[0]?.n ?? 0) >= expected) return;
    if (Date.now() > deadline) {
      throw new Error(
        `${what}: ${String(expected)} zárra váró munkamenet kellett volna, de ${String(rows[0]?.n ?? 0)} van. ` +
          'A művelet nem vette fel a várt szülő-sor zárat (B4 S8), vagy más ok miatt nem jutott el odáig.',
      );
    }
  }
}

export interface Gate {
  /** COMMIT és a kapcsolat visszaadása: a zárra várók ezzel indulnak. */
  release(): Promise<void>;
}

/** Tranzakciót nyit a `ctl` poolon, lefuttatja a zároló utasítást, és tartja a zárat a `release()`-ig. */
export async function holdLock(
  ctl: pg.Pool,
  lockSql: string,
  params: unknown[] = [],
): Promise<Gate> {
  const client = await ctl.connect();
  try {
    await client.query('BEGIN');
    await client.query(lockSql, params);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw error;
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    },
  };
}

/**
 * A műveleteket egyenként a kapura állítja (mindegyiket megvárja, amíg zárra vár), majd elengedi a kaput, és visszaadja
 * az eredményeiket a megadott sorrendben. A műveletek a sorrendjükben kapják meg a zárat (FIFO).
 */
export async function runGated<T>(opts: {
  ctl: pg.Pool;
  db: TestDb;
  /** A kapu zárja: ugyanaz az utasítás-alak, amellyel a tesztelt kód a szülő sort zárolja. */
  gateSql: string;
  gateParams?: unknown[];
  ops: (() => Promise<T>)[];
  what: string;
}): Promise<T[]> {
  const gate = await holdLock(opts.ctl, opts.gateSql, opts.gateParams);
  const started: Promise<T>[] = [];
  try {
    for (const [index, op] of opts.ops.entries()) {
      const promise = op();
      promise.catch(() => undefined); // a várakozás közbeni elbukás ne legyen kezeletlen elutasítás
      started.push(promise);
      await waitForLockWaiters(opts.ctl, opts.db, index + 1, opts.what);
    }
  } catch (error) {
    await gate.release();
    await Promise.allSettled(started);
    throw error;
  }
  await gate.release();
  return Promise.all(started);
}

/** A `ctl` poolról egy replica módú (triggerek és FK-k nélküli) kliens: csak fixture-hez, a végén vissza kell adni. */
export async function replicaClient(ctl: pg.Pool): Promise<pg.PoolClient> {
  const client = await ctl.connect();
  await client.query('SET session_replication_role = replica');
  return client;
}

export async function releaseReplicaClient(client: pg.PoolClient): Promise<void> {
  try {
    await client.query('SET session_replication_role = DEFAULT');
  } finally {
    client.release();
  }
}
