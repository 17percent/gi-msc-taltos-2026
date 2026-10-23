// Fejlesztői secret-fájlok létrehozása a Compose-hoz (D13). Meglévő fájlt nem ír felül.
// A három DB-jelszó (superuser, migrátor, alkalmazás) véletlen; az OIDC- és SMTP-secret helyőrző, amíg a WP2 /
// az e-mail-küldés be nem köti.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'secrets');
mkdirSync(dir, { recursive: true });

const secrets = {
  'db_superuser_password.txt': () => randomBytes(24).toString('base64url'),
  'db_migrator_password.txt': () => randomBytes(24).toString('base64url'),
  'db_app_password.txt': () => randomBytes(24).toString('base64url'),
  'oidc_client_secret.txt': () => 'dev-placeholder-set-in-wp2',
  'smtp_password.txt': () => 'dev-placeholder-mailpit',
};

for (const [name, generate] of Object.entries(secrets)) {
  const file = join(dir, name);
  if (existsSync(file)) {
    console.log(`megvan:     secrets/${name}`);
    continue;
  }
  // 0644: a Compose a fájl-secretet bind-mountként, a host jogosultságával csatolja, és ugyanazt a fájlt más-más
  // uid olvassa (postgres: 70, node: 1000). Csak fejlesztői/CI dummy secret; éles: secrets/README.md (D13).
  writeFileSync(file, `${generate()}\n`, { mode: 0o644 });
  console.log(`létrehozva: secrets/${name}`);
}

// Az allowlist helyi példánya (a Compose bind-mountolja; hiányzó fájlt a Docker könyvtárként hozná létre).
const configDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'config');
const allowlist = join(configDir, 'allowlist.txt');
if (existsSync(allowlist)) {
  console.log('megvan:     config/allowlist.txt');
} else {
  copyFileSync(join(configDir, 'allowlist.example.txt'), allowlist);
  console.log('létrehozva: config/allowlist.txt (a mintából; szerkeszd)');
}
