import { readFileSync } from 'node:fs';

/**
 * Secret-váz (D13): a secretek kizárólag fájlból jönnek (Compose secrets, `/run/secrets/*`),
 * a `<NÉV>_FILE` környezeti változó mutat rájuk. Közvetlen környezeti változóból, image-ből vagy
 * commitolható `.env`-ből soha nem olvasunk; az értéket sem logoljuk, sem hibaüzenetbe nem írjuk.
 */
export type SecretName =
  'DB_MIGRATOR_PASSWORD' | 'DB_APP_PASSWORD' | 'OIDC_CLIENT_SECRET' | 'SMTP_PASSWORD';

export function readSecret(
  name: SecretName,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const path = env[`${name}_FILE`];
  if (!path) return undefined;
  const value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  if (value.length === 0) {
    throw new Error(`A(z) ${name} secret fájlja üres: ${path}`);
  }
  return value;
}

export function requireSecret(name: SecretName, env: NodeJS.ProcessEnv = process.env): string {
  const value = readSecret(name, env);
  if (value === undefined) {
    throw new Error(
      `Hiányzó secret: ${name} (állítsd be a ${name}_FILE változót egy secret fájlra)`,
    );
  }
  return value;
}
