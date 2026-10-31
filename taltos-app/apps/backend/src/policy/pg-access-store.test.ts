import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import { createPgAccessStore } from './pg-access-store.js';

/**
 * A PostgreSQL-adapter SQL-alakja adatbázis nélkül: egy csonk-kapcsolat rögzíti a kiadott lekérdezéseket
 * (a tényleges eredményt az `access.int.test.ts` bizonyítja). Ez őrzi a tervezési szabályokat: kérésenként EGY
 * betöltés, kötött paraméterek, semmi `SELECT *`, a `denialDetails` csak a saját három kis lekérdezése.
 */
function capture() {
  const queries: { text: string; values: unknown[] }[] = [];
  const client = {
    query(config: { text: string; values?: unknown[] } | string, values?: unknown[]) {
      const text = typeof config === 'string' ? config : config.text;
      queries.push({
        text: text.replace(/\s+/g, ' ').trim(),
        values: values ?? (typeof config === 'string' ? [] : (config.values ?? [])),
      });
      return Promise.resolve({ rows: [], rowCount: 0, fields: [] });
    },
  };
  // csonk-kapcsolat: csak a `query` kell a drizzle node-postgres driverének
  const db = drizzle({ client: client as never });
  return { store: createPgAccessStore(db), queries };
}

const actor = { userId: 'u-1', systemRole: 'user' } as const;

describe('PgAccessStore: a kiadott SQL alakja', () => {
  it('spaceTarget: egyetlen lekérdezés, az aktív tagságra illesztve, kötött paraméterekkel', async () => {
    const { store, queries } = capture();
    expect(await store.spaceTarget('u-1', 's-1')).toBeUndefined();
    expect(queries).toHaveLength(1);
    const { text, values } = queries[0] ?? { text: '', values: [] };
    expect(text).toContain('left join "space_members"');
    expect(text).toContain('"space_members"."removed_at" is null');
    expect(text).toContain('"spaces"."deleted_at" is null');
    expect(text).not.toMatch(/select \*/i);
    expect(values).toEqual(expect.arrayContaining(['u-1', 's-1']));
  });

  it('documentTarget: egyetlen lekérdezés; az eldobott piszkozat és a törölt színtér kiszűrve; a függő kérés részleges indexen', async () => {
    const { store, queries } = capture();
    expect(await store.documentTarget('u-1', 'd-1')).toBeUndefined();
    expect(queries).toHaveLength(1);
    const { text } = queries[0] ?? { text: '' };
    expect(text).toContain('inner join "spaces"');
    expect(text).toContain('left join "space_members"');
    expect(text).toContain('left join "change_requests"');
    expect(text).toContain('"change_requests"."state" = $');
    expect(text).toContain('"documents"."approved_revision_id" is not null');
    expect(text).toContain('"change_request_reviewers"."ended_at" IS NULL');
    // a tartalom és a cím soha nem töltődik be a döntéshez
    expect(text).not.toMatch(/"documents"\."(content|title)"/);
  });

  it('denialDetails: három kis lekérdezés, cím és darabszám nélkül; nem létező térre undefined', async () => {
    const { store, queries } = capture();
    expect(await store.denialDetails(actor, 's-1')).toBeUndefined();
    expect(queries).toHaveLength(3);
    const all = queries.map((q) => q.text).join(' | ');
    expect(all).not.toMatch(/count\(|"documents"/i);
    expect(all).toContain('"space_members"."role" = $');
    expect(all).toContain('"membership_requests"');
  });
});
