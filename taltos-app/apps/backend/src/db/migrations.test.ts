import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadModule, parse, parsePlPgSQL } from 'libpg-query';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrator.js';

/**
 * Adatbázis NÉLKÜLI ellenőrzés: minden migráció a Postgres saját parserén (libpg-query, WASM) átmegy, a PL/pgSQL
 * függvénytestek is szintaktikailag helyesek, és a drizzle-napló egyezik a fájlokkal. A tényleges végrehajtást a
 * TEST_DATABASE_URL-es integrációs teszt (schema.int.test.ts) végzi.
 */
const EXPECTED = [
  '0000_base_schema',
  '0001_search_infrastructure',
  '0002_append_only',
  '0003_review_invariants',
  '0004_partial_indexes',
  '0005_roles_and_grants',
  '0006_function_search_path',
];

const files = readdirSync(MIGRATIONS_FOLDER)
  .filter((f) => f.endsWith('.sql'))
  .sort();

beforeAll(async () => {
  await loadModule();
});

describe('migrációk (B4 3. szakasz) - szintaxis', () => {
  it('a fájlok és a drizzle-napló a B4 sorrendjét követik', () => {
    expect(files.map((f) => f.replace(/\.sql$/, ''))).toEqual(EXPECTED);
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string; when: number }[] };
    expect(journal.entries.map((e) => e.tag)).toEqual(EXPECTED);
    expect(journal.entries.map((e) => e.idx)).toEqual(EXPECTED.map((_, i) => i));
    // A drizzle a `when` alapján dönti el, mi van még hátra: szigorúan növekvőnek kell lennie.
    const whens = journal.entries.map((e) => e.when);
    expect(whens).toEqual([...whens].sort((a, b) => a - b));
    expect(new Set(whens).size).toBe(whens.length);
  });

  it('a 0006 rögzített search_path-ot ad a 0001-0003 minden függvényének (S26)', () => {
    const read = (name: string): string =>
      readFileSync(join(MIGRATIONS_FOLDER, `${name}.sql`), 'utf8');
    const created = ['0001_search_infrastructure', '0002_append_only', '0003_review_invariants']
      .flatMap((name) => [...read(name).matchAll(/CREATE OR REPLACE FUNCTION\s+(\w+)\(/g)])
      .map((m) => m[1] as string);
    expect(created.length).toBeGreaterThanOrEqual(10);
    const fixed = read('0006_function_search_path');
    for (const fn of created) {
      expect(fixed, fn).toMatch(
        new RegExp(`ALTER FUNCTION\\s+${fn}\\([^)]*\\)\\s+SET search_path = pg_catalog, public;`),
      );
    }
  });

  it.each(EXPECTED)(
    '%s a Postgres parserén átmegy, a PL/pgSQL függvénytestekkel együtt',
    async (name) => {
      const sql = readFileSync(join(MIGRATIONS_FOLDER, `${name}.sql`), 'utf8');
      const { stmts = [] } = await parse(sql);
      expect(stmts.length).toBeGreaterThan(0);

      const bytes = Buffer.from(sql); // a parser bájt-pozíciókat ad (a kommentekben ékezetek vannak)
      for (const raw of stmts) {
        if (raw.stmt && 'CreateFunctionStmt' in raw.stmt) {
          const start = raw.stmt_location ?? 0;
          const end = raw.stmt_len ? start + raw.stmt_len : bytes.length;
          await expect(parsePlPgSQL(bytes.subarray(start, end).toString())).resolves.toBeDefined();
        }
      }
    },
  );

  it('nincs CONCURRENTLY (a migrátor egyetlen tranzakcióban fut) és nincs DROP TABLE', () => {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_FOLDER, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      expect(sql, file).not.toMatch(/CONCURRENTLY/i);
      expect(sql, file).not.toMatch(/\bTRUNCATE\s+(TABLE\s+)?(?!.*\bTRIGGER\b)[a-z_]+\s*;/i);
      expect(sql, file).not.toMatch(/\bDROP\s+TABLE\b/i);
    }
  });

  it('a B4 kulcs-objektumai megvannak a kézi migrációkban', () => {
    const all = files.map((f) => readFileSync(join(MIGRATIONS_FOLDER, f), 'utf8')).join('\n');
    for (const needle of [
      'search_vector',
      'documents_search_vector_idx',
      'document_tags_tag_text_ins',
      'events_append_only',
      'document_revisions_append_only',
      'events_no_truncate',
      'documents_approved_revision_fk',
      'change_requests_one_pending_uq',
      'crr_active_reviewer_uq',
      'crr_at_most_two',
      'cr_exactly_two_at_submission',
      'change_requests_guard',
      'documents_frozen_while_pending',
      'space_members_active_idx',
      'spaces_one_general_uq',
      'membership_requests_one_pending_uq',
      'taltos_owner',
      'taltos_app',
      'taltos_retention',
    ]) {
      expect(all, needle).toContain(needle);
    }
  });

  it('a CI szerepkör-ellenőrző szkriptje (db/checks) szintaktikailag helyes', async () => {
    const file = join(MIGRATIONS_FOLDER, '..', '..', '..', 'db', 'checks', 'roles-hardening.sql');
    const { stmts = [] } = await parse(readFileSync(file, 'utf8'));
    expect(stmts.length).toBeGreaterThan(0);
  });
});
