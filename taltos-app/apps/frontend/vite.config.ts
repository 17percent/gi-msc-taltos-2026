import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // A `@taltos/shared` forrásból töltődik, külön build nélkül.
  resolve: { conditions: ['@taltos/source', ...defaultClientConditions] },
  server: {
    port: 5173,
    strictPort: true,
    // Fejlesztésben a Vite proxyzza a backendet; élesben ugyanezt a frontend-konténer nginx-e (D50).
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/healthz': backend,
      '/collab': { target: backend, ws: true },
      '/ws': { target: backend, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
