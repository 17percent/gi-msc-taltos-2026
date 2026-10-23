import type pg from 'pg';
import { createPool, loadDbConnection } from './connection.js';
import { runMigrations } from './migrator.js';

// Egyszeri belépési pont a Compose `migrate` szolgáltatásnak: `node dist/db/migrate.js`.
// Nem nulla kilépési kóddal áll le hibánál, így a `backend` (depends_on: service_completed_successfully) nem indul el.
let pool: pg.Pool | undefined;
try {
  pool = createPool(loadDbConnection('migrator'), 1);
  await runMigrations(pool);
  console.log('Migrációk alkalmazva.');
} catch (error) {
  console.error('A migráció sikertelen:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
