import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createPool, OWNER_ROLE, type DbConnection } from './connection.js';
import { runMigrations } from './migrator.js';

/**
 * Eldobható tesztadatbázis az integrációs tesztekhez. A `TEST_DATABASE_URL` egy SUPERUSER URL, amely adatbázist
 * és szerepkört hozhat létre (CI: a service container; helyben: kézzel megadott, eldobható Postgres).
 * Minden futás friss adatbázist és véletlen nevű login-szerepköröket kap, majd mindent eldob; a három
 * NOLOGIN csoportszerepkör (fürt-szintű) megmarad. A telepítést az init-szkript (db/initdb) tükrözi:
 * a séma tulajdonosa a taltos_owner, a migrátor tagja, az app a taltos_app tagja.
 */
export interface TestDb {
  database: string;
  /** Superuser a teszt-adatbázisban: csak az előkészítéshez és az ellenőrzéshez. */
  admin: pg.Pool;
  /** A migrátor login-szerepkör (a taltos_owner tagja). */
  migrator: pg.Pool;
  /** Az alkalmazás login-szerepköre (a taltos_app tagja): a seed és a legtöbb teszt ezzel fut. */
  app: pg.Pool;
  /** A retenciós login-szerepkör (a taltos_retention tagja; a törléshez SET LOCAL ROLE kell). */
  retention: pg.Pool;
  stop(): Promise<void>;
}

export async function createTestDb(superuserUrl: string): Promise<TestDb> {
  const suffix = randomBytes(4).toString('hex');
  const database = `taltos_test_${suffix}`;
  const logins = {
    migrator: {
      user: `t_mig_${suffix}`,
      password: randomBytes(12).toString('hex'),
      group: OWNER_ROLE,
    },
    app: {
      user: `t_app_${suffix}`,
      password: randomBytes(12).toString('hex'),
      group: 'taltos_app',
    },
    retention: {
      user: `t_ret_${suffix}`,
      password: randomBytes(12).toString('hex'),
      group: 'taltos_retention',
    },
  };

  const url = new URL(superuserUrl);
  const root = new pg.Client({ connectionString: superuserUrl });
  await root.connect();
  try {
    for (const group of [OWNER_ROLE, 'taltos_app', 'taltos_retention']) {
      await root.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${group}') THEN
             CREATE ROLE ${group} NOLOGIN;
           END IF;
         END $$`,
      );
    }
    for (const login of Object.values(logins)) {
      // A név és a jelszó csak [a-z0-9_] / hex: biztonságosan beágyazható.
      await root.query(
        `CREATE ROLE ${login.user} LOGIN PASSWORD '${login.password}' IN ROLE ${login.group}`,
      );
    }
    await root.query(`CREATE DATABASE ${database}`);
  } finally {
    await root.end();
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = `/${database}`;
  const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 2 });
  // Az init-szkript (db/initdb/10-roles.sh) ugyanezt végzi a Compose-ban.
  await admin.query(`ALTER SCHEMA public OWNER TO ${OWNER_ROLE}`);
  await admin.query(`GRANT CREATE ON DATABASE ${database} TO ${OWNER_ROLE}`);

  const connection = (login: { user: string; password: string }): DbConnection => ({
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database,
    user: login.user,
    password: login.password,
  });
  const migrator = createPool(connection(logins.migrator), 2);
  const app = createPool(connection(logins.app), 4);
  const retention = createPool(connection(logins.retention), 2);

  await runMigrations(migrator);

  return {
    database,
    admin,
    migrator,
    app,
    retention,
    stop: async () => {
      await Promise.all([app.end(), migrator.end(), retention.end(), admin.end()]);
      const cleanup = new pg.Client({ connectionString: superuserUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
        for (const login of Object.values(logins)) {
          await cleanup.query(`DROP ROLE IF EXISTS ${login.user}`);
        }
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** Explicit BEGIN/COMMIT: a halasztott constraint triggerek a COMMIT-kor dobnak, ezért a tesztek a COMMIT-ot is megvárják. */
export async function withTx<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
