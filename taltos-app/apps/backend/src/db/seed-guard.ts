/**
 * A seed védelme (fail-closed): csak kifejezetten fejlesztői környezetben és kifejezett engedéllyel fut.
 * A `NODE_ENV=production` ellenőrzése önmagában nem elég: egy hiányzó vagy elírt NODE_ENV mellett éles adatbázison is lefutna.
 * Ezért két feltétel kell együtt: `NODE_ENV=development` ÉS `TALTOS_ALLOW_SEED=1`. A Compose-ban csak a dev-only `seed`
 * szolgáltatás állítja be (compose.override.yaml); a nem üres adatbázist a futtató (`runSeed`) külön visszautasítja.
 */
export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'development') {
    throw new Error(
      'A seed csak NODE_ENV=development mellett futtatható (dummy fejlesztői adat, D11); jelenlegi érték: ' +
        (env.NODE_ENV ?? 'nincs beállítva'),
    );
  }
  if (env.TALTOS_ALLOW_SEED !== '1') {
    throw new Error('A seed kifejezett engedélyt kér: állítsd be a TALTOS_ALLOW_SEED=1 változót.');
  }
}
