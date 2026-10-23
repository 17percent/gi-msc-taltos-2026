import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// A `@taltos/shared` forrásból töltődik (build nélkül), ugyanúgy, mint a `tsx watch`-ban.
export default defineConfig({
  ssr: { resolve: { conditions: ['@taltos/source', ...defaultServerConditions] } },
  test: { environment: 'node' },
});
