import { createHmac } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { AUTH_CALLBACK_PATH } from '@taltos/shared';
import { buildApp } from './app.js';
import { syncAllowlistFromFile } from './auth/allowlist.js';
import { createOidcFlow } from './auth/oidc.js';
import { createPgAuthStore } from './auth/pg-store.js';
import { loadConfig } from './config.js';
import { createPool, loadDbConnection } from './db/connection.js';
import { requireSecret } from './secrets.js';

const config = loadConfig();
const clientSecret = requireSecret('OIDC_CLIENT_SECRET');
const pool = createPool(loadDbConnection('app'));
const db = drizzle(pool);

const app = await buildApp(config, {
  store: createPgAuthStore(db, { bootstrapAdminEmail: config.bootstrapAdminEmail }),
  oidc: createOidcFlow({
    issuer: config.oidcIssuer,
    clientId: config.oidcClientId,
    clientSecret,
    redirectUri: `${config.publicOrigin}${AUTH_CALLBACK_PATH}`,
  }),
  // A kísérlet-süti aláírókulcsa a kliens-secretből származik (külön secret nem kell), de nem azonos vele.
  cookieSecret: createHmac('sha256', clientSecret)
    .update('taltos-login-cookie-v1')
    .digest('base64url'),
});
app.addHook('onClose', async () => {
  await pool.end();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'leállás');
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'hiba a leállás közben');
        process.exit(1);
      },
    );
  });
}

try {
  // Az allowlist a konfigurációból szinkronizálódik, mielőtt kérést fogadnánk (D53); hiba esetén nem indulunk el.
  await syncAllowlistFromFile(db, config.allowlistFile, app.log);
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'a szerver nem indult el');
  process.exit(1);
}
