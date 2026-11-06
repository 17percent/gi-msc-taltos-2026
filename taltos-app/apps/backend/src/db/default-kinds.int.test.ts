import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ROLE } from './connection.js';
import { MIGRATIONS_FOLDER } from './migrator.js';
import { buildSeedPlan } from './seed-data.js';
import { runSeed } from './seed-run.js';
import { createTestDb, type TestDb } from './test-db.js';

/**
 * A 0010 adat-migráció (D60 NK3) valódi Postgresen: friss, MIGRÁLT (seedeletlen) adatbázison ott a kilenc alap-fajta,
 * a migráció újrafuttatása nem változtat, a soft delete-tel törölt kulcsot nem állítja vissza, és a seed utána is lefut.
 * Csak a TEST_DATABASE_URL megadásakor fut (lásd README, Adatbázis-tesztek).
 */
const url = process.env.TEST_DATABASE_URL;
const MIGRATION_SQL = readFileSync(
  join(MIGRATIONS_FOLDER, '0010_default_document_kinds.sql'),
  'utf8',
);

interface KindRow {
  key: string;
  label: string;
  sort_order: number;
  deleted_at: Date | null;
}

describe.skipIf(!url)('0010 alap-fajták (D60 NK3)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb(url as string);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  }, 60_000);

  const kinds = async (): Promise<KindRow[]> =>
    (
      await db.admin.query<KindRow>(
        'SELECT key, label, sort_order, deleted_at FROM document_kinds ORDER BY sort_order, key',
      )
    ).rows;

  /** A migráció SQL-je újra, ugyanazzal a szerepkörrel, mint a migrátor (taltos_owner). */
  async function rerunMigration(): Promise<void> {
    const client = await db.migrator.connect();
    try {
      await client.query(`SET ROLE ${OWNER_ROLE}`);
      await client.query(MIGRATION_SQL);
      await client.query('RESET ROLE');
    } finally {
      client.release();
    }
  }

  it('friss adatbázison a migrálás után ott a kilenc fajta, a seed kulcsaival, címkéivel és sorrendjével', async () => {
    const rows = await kinds();
    expect(rows.map((r) => ({ key: r.key, label: r.label, sortOrder: r.sort_order }))).toEqual(
      buildSeedPlan().kinds,
    );
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.deleted_at === null)).toBe(true);
  });

  it('a migráció kétszeri futtatása nem hibázik és nem változtat', async () => {
    const before = await kinds();
    await rerunMigration();
    await rerunMigration();
    expect(await kinds()).toEqual(before);
  });

  it('a soft delete-tel törölt (és átnevezett) kulcsot a migráció nem állítja vissza és nem írja felül', async () => {
    await db.admin.query(
      `UPDATE document_kinds SET deleted_at = '2026-01-02T03:04:05Z', label = 'Átnevezett' WHERE key = 'skill'`,
    );
    const before = await kinds();
    await rerunMigration();
    const after = await kinds();
    expect(after).toEqual(before);
    const skill = after.find((r) => r.key === 'skill');
    expect(skill?.deleted_at).not.toBeNull();
    expect(skill?.label).toBe('Átnevezett');
  });

  it('hiányzó kulcsot pótol, a többihez nem nyúl', async () => {
    await db.admin.query(`DELETE FROM document_kinds WHERE key = 'mcp_server'`);
    const before = (await kinds()).filter((r) => r.key !== 'mcp_server');
    await rerunMigration();
    const after = await kinds();
    expect(after.filter((r) => r.key !== 'mcp_server')).toEqual(before);
    expect(after.find((r) => r.key === 'mcp_server')).toMatchObject({
      label: 'MCP-szerverek',
      sort_order: 8,
      deleted_at: null,
    });
  });

  it('a seed a migrált (már fajtákat tartalmazó) adatbázison is lefut, és a fajta-lista a tervvel egyezik', async () => {
    // A korábbi tesztek módosították a sorokat: a seed-ellenőrzés előtt az eredeti állapotot állítjuk helyre.
    await db.admin.query(
      `UPDATE document_kinds SET deleted_at = NULL, label = 'Skillek' WHERE key = 'skill'`,
    );
    const result = await runSeed(db.app);
    expect(result.documents).toBeGreaterThan(0);
    const rows = await kinds();
    expect(rows.map((r) => ({ key: r.key, label: r.label, sortOrder: r.sort_order }))).toEqual(
      buildSeedPlan().kinds,
    );
  }, 180_000);
});
