import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { OWNER_ROLE } from './connection.js';

/** A migrációk mappája: src/db és dist/db is két szinttel a csomag gyökere alatt van (`files`: drizzle). */
export const MIGRATIONS_FOLDER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

/**
 * Az összes függő migráció alkalmazása egy rendezett naplóban (generált DDL + kézi B4 3. szakasz).
 * Egy dedikált kapcsolaton fut, amely előbb `SET ROLE taltos_owner`-re vált: a migrátor login-szerepkör ennek
 * a csoportnak a tagja, így minden objektum tulajdonosa a `taltos_owner` lesz (az app nem tulajdonos, B4 S23).
 */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query(`SET ROLE ${OWNER_ROLE}`);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    // A kapcsolat ne maradjon taltos_owner a készletben; ha a visszaváltás sem sikerül, eldobjuk a kapcsolatot.
    try {
      await client.query('RESET ROLE');
    } catch (error) {
      broken = error instanceof Error ? error : new Error(String(error));
    }
    client.release(broken);
  }
}
