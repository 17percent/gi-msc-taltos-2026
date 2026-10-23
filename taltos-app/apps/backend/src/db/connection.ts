import pg from 'pg';
import { requireSecret } from '../secrets.js';

/**
 * Adatbázis-kapcsolat szerepkörönként (B4 S23). A két login-szerepkör külön jelszót kap:
 *  - `migrator` (taltos_migrator): csak a `migrate` szolgáltatás használja; tagja a NOLOGIN `taltos_owner`
 *    csoportnak (DDL-jog). A backend soha nem kapja meg a jelszavát.
 *  - `app` (taltos_backend): az alkalmazás és a seed; tagja a `taltos_app` csoportnak (DML, DELETE csak a D51 j táblákon).
 * A jelszó kizárólag `*_FILE` secretből jön (D13).
 */
export type DbRole = 'migrator' | 'app';

export interface DbConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** A migrációt futtató login-szerepkör a kapcsolat elején erre a csoportszerepkörre vált, hogy az objektumok tulajdonosa az legyen. */
export const OWNER_ROLE = 'taltos_owner';

export function loadDbConnection(role: DbRole, env: NodeJS.ProcessEnv = process.env): DbConnection {
  const port = Number(env.DB_PORT ?? '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Érvénytelen DB_PORT: ${env.DB_PORT}`);
  }
  return {
    host: env.DB_HOST ?? 'localhost',
    port,
    database: env.DB_NAME ?? 'taltos',
    user:
      role === 'migrator'
        ? (env.DB_MIGRATOR_USER ?? 'taltos_migrator')
        : (env.DB_APP_USER ?? 'taltos_backend'),
    password: requireSecret(role === 'migrator' ? 'DB_MIGRATOR_PASSWORD' : 'DB_APP_PASSWORD', env),
  };
}

/** A kapcsolódás időkorlátja: a migrate és a seed hibával áll le ahelyett, hogy egy elérhetetlen DB-n lógna. */
const CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Kapcsolatkészlet. A `pg.Pool` kapcsolatot csak az első lekérdezéskor nyit, ezért a készlet létrehozása
 * nem igényel elérhető adatbázist (a backend indulása nem függ tőle). A készlet hibaeseményét naplózzuk,
 * különben egy elveszett kapcsolat a folyamatot is leállítaná.
 */
export function createPool(connection: DbConnection, max = 5): pg.Pool {
  const pool = new pg.Pool({ ...connection, max, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  pool.on('error', (error) => {
    console.error('Adatbázis-kapcsolat hiba (készlet):', error.message);
  });
  return pool;
}
