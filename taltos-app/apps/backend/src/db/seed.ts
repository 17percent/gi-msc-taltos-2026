import type pg from 'pg';
import { createPool, loadDbConnection } from './connection.js';
import { runSeed } from './seed-run.js';

// Fejlesztői dummy adat (D11). A `taltos_backend` (app) szerepkörrel fut: ez igazolja, hogy az app jogai elegendők.
// Éles környezetben megtagadja a futást. Használat: `pnpm --filter @taltos/backend db:seed`
// (Compose-ban: `docker compose --profile seed run --rm seed`).
if (process.env.NODE_ENV === 'production') {
  console.error('A seed élesben (NODE_ENV=production) nem futtatható: csak dummy fejlesztői adat.');
  process.exit(1);
}

let pool: pg.Pool | undefined;
try {
  pool = createPool(loadDbConnection('app'), 1);
  const result = await runSeed(pool);
  console.log('Seed kész:', JSON.stringify(result));
} catch (error) {
  console.error('A seed sikertelen:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
