import type pg from 'pg';
import { createPool, loadDbConnection } from './connection.js';
import { assertSeedAllowed } from './seed-guard.js';
import { runSeed } from './seed-run.js';

// Fejlesztői dummy adat (D11). A `taltos_backend` (app) szerepkörrel fut: ez igazolja, hogy az app jogai elegendők.
// Fail-closed: csak NODE_ENV=development ÉS TALTOS_ALLOW_SEED=1 mellett fut (lásd seed-guard.ts), és csak üres adatbázisra.
// Használat: `NODE_ENV=development TALTOS_ALLOW_SEED=1 pnpm --filter @taltos/backend db:seed`
// (Compose-ban: `docker compose --profile seed run --rm seed`, ahol a dev-only szolgáltatás beállítja a változókat).
let pool: pg.Pool | undefined;
try {
  assertSeedAllowed();
  pool = createPool(loadDbConnection('app'), 1);
  const result = await runSeed(pool);
  console.log('Seed kész:', JSON.stringify(result));
} catch (error) {
  console.error('A seed sikertelen:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
