import { defineConfig } from 'drizzle-kit';

// Csak `drizzle-kit generate` (séma → SQL) fut belőle; a `push` TILOS (B4 1. szakasz):
// a search_vector, a kompozit FK-k és a kézi indexek a TS-sémán kívül élnek.
// A kapcsolat nem kell: a migrációkat a src/db/migrate.ts futtatja.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
});
