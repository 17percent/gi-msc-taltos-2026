import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { readSecret, requireSecret } from './secrets.js';

describe('loadConfig', () => {
  it('fejlesztésben alapértelmezett originekkel indul', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.allowedOrigins).toContain('http://localhost:5173');
    expect(config.trustProxy).toBe(false);
  });

  it('élesben ALLOWED_ORIGINS nélkül nem indul', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('ALLOWED_ORIGINS');
  });

  it('feldolgozza az origin-listát és a proxy-beállítást', () => {
    const config = loadConfig({
      ALLOWED_ORIGINS: 'https://taltos.example, https://b.example',
      TRUST_PROXY: '10.0.0.0/8',
    });
    expect(config.allowedOrigins).toEqual(['https://taltos.example', 'https://b.example']);
    expect(config.trustProxy).toBe('10.0.0.0/8');
  });

  it.each(['true', '1'])('a hamisítható TRUST_PROXY=%s beállítást elutasítja', (value) => {
    expect(() => loadConfig({ TRUST_PROXY: value })).toThrow('TRUST_PROXY');
  });

  it('érvénytelen portot elutasít', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow('PORT');
  });
});

describe('secretek (D13)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taltos-secret-'));

  it('a *_FILE által mutatott fájlból olvas, a záró sortörést levágja', () => {
    const file = join(dir, 'db_password');
    writeFileSync(file, 's3cr3t\n');
    expect(readSecret('DB_PASSWORD', { DB_PASSWORD_FILE: file })).toBe('s3cr3t');
  });

  it('közvetlen környezeti változóból nem olvas', () => {
    expect(readSecret('DB_PASSWORD', { DB_PASSWORD: 's3cr3t' })).toBeUndefined();
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
