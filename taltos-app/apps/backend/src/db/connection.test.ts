import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDbConnection } from './connection.js';

describe('adatbázis-kapcsolat szerepkörönként (B4 S23, D13)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taltos-db-'));
  const secret = (name: string, value: string): string => {
    const file = join(dir, name);
    writeFileSync(file, `${value}\n`);
    return file;
  };

  it('a migrátor és az alkalmazás külön login-szerepkört és külön jelszót kap', () => {
    const env = {
      DB_HOST: 'postgres',
      DB_MIGRATOR_PASSWORD_FILE: secret('mig', 'mig-pw'),
      DB_APP_PASSWORD_FILE: secret('app', 'app-pw'),
    };
    expect(loadDbConnection('migrator', env)).toEqual({
      host: 'postgres',
      port: 5432,
      database: 'taltos',
      user: 'taltos_migrator',
      password: 'mig-pw',
    });
    expect(loadDbConnection('app', env)).toMatchObject({
      user: 'taltos_backend',
      password: 'app-pw',
    });
  });

  it('a jelszót csak fájlból olvassa, és a hiányzó secretnél a nevet jelzi, az értéket nem', () => {
    expect(() => loadDbConnection('app', { DB_APP_PASSWORD: 'nyers' })).toThrow(
      'DB_APP_PASSWORD_FILE',
    );
    // Az alkalmazás nem kaphatja meg a migrátor jelszavát: a másik szerepkör secretjét nem használja.
    expect(() => loadDbConnection('app', { DB_MIGRATOR_PASSWORD_FILE: secret('m2', 'x') })).toThrow(
      'DB_APP_PASSWORD',
    );
  });

  it('érvénytelen portot elutasít', () => {
    expect(() =>
      loadDbConnection('app', { DB_PORT: 'nem-szam', DB_APP_PASSWORD_FILE: secret('a2', 'x') }),
    ).toThrow('DB_PORT');
  });
});
