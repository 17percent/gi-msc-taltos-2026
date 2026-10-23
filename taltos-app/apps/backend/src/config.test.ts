import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { readSecret, requireSecret } from './secrets.js';

const BASE = { OIDC_CLIENT_ID: 'kliens-id', ALLOWLIST_FILE: '/etc/taltos/allowlist.txt' };

describe('loadConfig', () => {
  it('fejlesztésben alapértelmezett originekkel indul', () => {
    const config = loadConfig({ ...BASE });
    expect(config.port).toBe(3000);
    expect(config.allowedOrigins).toContain('http://localhost:5173');
    expect(config.trustProxy).toBe(false);
  });

  it('élesben ALLOWED_ORIGINS nélkül nem indul', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production' })).toThrow('ALLOWED_ORIGINS');
  });

  it('feldolgozza az origin-listát és a proxy-beállítást', () => {
    const config = loadConfig({
      ...BASE,
      ALLOWED_ORIGINS: 'https://taltos.example, https://b.example',
      TRUST_PROXY: '10.0.0.0/8',
    });
    expect(config.allowedOrigins).toEqual(['https://taltos.example', 'https://b.example']);
    expect(config.trustProxy).toBe('10.0.0.0/8');
  });

  it.each(['true', '1'])('a hamisítható TRUST_PROXY=%s beállítást elutasítja', (value) => {
    expect(() => loadConfig({ ...BASE, TRUST_PROXY: value })).toThrow('TRUST_PROXY');
  });

  it('érvénytelen portot elutasít', () => {
    expect(() => loadConfig({ ...BASE, PORT: '70000' })).toThrow('PORT');
  });

  it('az auth-beállítások alapértékei: Google, nem Secure fejlesztésben, 8 óra / 60 perc', () => {
    const config = loadConfig({ ...BASE });
    expect(config.oidcIssuer).toBe('https://accounts.google.com/');
    expect(config.publicOrigin).toBe('http://localhost:8080');
    expect(config.cookieSecure).toBe(false);
    expect(config.sessionAbsoluteMs).toBe(8 * 60 * 60_000);
    expect(config.sessionIdleMs).toBe(60 * 60_000);
  });

  it('élesben a süti alapból Secure, kifejezetten kikapcsolható', () => {
    const env = {
      ...BASE,
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'https://t.example',
      PUBLIC_ORIGIN: 'https://t.example',
    };
    expect(loadConfig(env).cookieSecure).toBe(true);
    expect(loadConfig({ ...env, COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
  });

  it('élesben PUBLIC_ORIGIN nélkül nem indul', () => {
    const env = { ...BASE, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://t.example' };
    expect(() => loadConfig(env)).toThrow('PUBLIC_ORIGIN');
  });

  it.each(['OIDC_CLIENT_ID', 'ALLOWLIST_FILE'])('hiányzó %s esetén nem indul', (name) => {
    expect(() => loadConfig({ ...BASE, [name]: undefined })).toThrow(name);
  });

  it('érvénytelen COOKIE_SECURE, PUBLIC_ORIGIN és lejárat-érték hibát ad', () => {
    expect(() => loadConfig({ ...BASE, COOKIE_SECURE: 'igen' })).toThrow('COOKIE_SECURE');
    expect(() => loadConfig({ ...BASE, PUBLIC_ORIGIN: 'ftp://x' })).toThrow('PUBLIC_ORIGIN');
    expect(() => loadConfig({ ...BASE, SESSION_IDLE_MINUTES: '0' })).toThrow('SESSION_IDLE');
  });

  it('a PUBLIC_ORIGIN-t origin-ná normalizálja', () => {
    expect(loadConfig({ ...BASE, PUBLIC_ORIGIN: 'https://T.example/valami' }).publicOrigin).toBe(
      'https://t.example',
    );
  });
});

describe('secretek (D13)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taltos-secret-'));

  it('a *_FILE által mutatott fájlból olvas, a záró sortörést levágja', () => {
    const file = join(dir, 'db_password');
    writeFileSync(file, 's3cr3t\n');
    expect(readSecret('DB_APP_PASSWORD', { DB_APP_PASSWORD_FILE: file })).toBe('s3cr3t');
  });

  it('közvetlen környezeti változóból nem olvas', () => {
    expect(readSecret('DB_APP_PASSWORD', { DB_APP_PASSWORD: 's3cr3t' })).toBeUndefined();
  });

  it('hiányzó kötelező secretnél a nevet jelzi, az értéket nem', () => {
    expect(() => requireSecret('OIDC_CLIENT_SECRET', {})).toThrow('OIDC_CLIENT_SECRET_FILE');
  });

  it('üres secret fájlt elutasít', () => {
    const file = join(dir, 'empty');
    writeFileSync(file, '\n');
    expect(() => readSecret('SMTP_PASSWORD', { SMTP_PASSWORD_FILE: file })).toThrow('üres');
  });
});
