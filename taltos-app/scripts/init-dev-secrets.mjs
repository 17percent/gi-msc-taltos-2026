// Fejlesztői secret-fájlok létrehozása a Compose-hoz (D13). Meglévő fájlt nem ír felül.
// A DB-jelszó véletlen; az OIDC- és SMTP-secret helyőrző, amíg a WP2 / az e-mail-küldés be nem köti.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'secrets');
mkdirSync(dir, { recursive: true });

const secrets = {
  'db_password.txt': () => randomBytes(24).toString('base64url'),
  'oidc_client_secret.txt': () => 'dev-placeholder-set-in-wp2',
  'smtp_password.txt': () => 'dev-placeholder-mailpit',
};

for (const [name, generate] of Object.entries(secrets)) {
  const file = join(dir, name);
  if (existsSync(file)) {
    console.log(`megvan:     secrets/${name}`);
    continue;
  }
  writeFileSync(file, `${generate()}\n`, { mode: 0o600 });
  console.log(`létrehozva: secrets/${name}`);
}
