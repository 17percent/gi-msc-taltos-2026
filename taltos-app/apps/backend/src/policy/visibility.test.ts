import { PgDialect } from 'drizzle-orm/pg-core';
import { alias } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as t from '../db/schema.js';
import { visibleDocumentsWhere, visibleSpacesWhere } from './visibility.js';

const dialect = new PgDialect();
const render = (predicate: Parameters<PgDialect['sqlToQuery']>[0]) => {
  const { sql, params } = dialect.sqlToQuery(predicate);
  return { sql: sql.replace(/\s+/g, ' ').trim(), params };
};

describe('visibleDocumentsWhere (a generált SQL alakja)', () => {
  it('korrelált EXISTS az aktív tagságra és az élő színtérre; a nézőazonosító kötött paraméter', () => {
    const { sql, params } = render(visibleDocumentsWhere('viewer-1'));
    expect(sql).toBe(
      'EXISTS ( SELECT 1 FROM "space_members" JOIN "spaces" ON "spaces"."id" = "space_members"."space_id" ' +
        'WHERE "space_members"."space_id" = "documents"."space_id" AND "space_members"."user_id" = $1 ' +
        'AND "space_members"."removed_at" IS NULL AND "spaces"."deleted_at" IS NULL)',
    );
    expect(params).toEqual(['viewer-1']);
  });

  it('nincs benne Rendszeradmin-kivétel, lezártság-szűrés, DISTINCT vagy NOT IN', () => {
    const { sql } = render(visibleDocumentsWhere('v'));
    expect(sql).not.toMatch(/system_role|closed_at|DISTINCT|NOT IN/i);
  });

  it('aliasolt dokumentum-táblával is a külső sorra korrelál', () => {
    const d = alias(t.documents, 'd');
    const { sql } = render(visibleDocumentsWhere('v', d));
    expect(sql).toContain('"space_members"."space_id" = "d"."space_id"');
  });

  it('a nézőazonosító sosem kerül az SQL szövegébe (injektálás ellen)', () => {
    const { sql, params } = render(visibleDocumentsWhere("x'; DROP TABLE documents; --"));
    expect(sql).not.toContain('DROP');
    expect(params).toEqual(["x'; DROP TABLE documents; --"]);
  });
});

describe('visibleSpacesWhere (a generált SQL alakja)', () => {
  it('élő színtér és aktív tagság, korrelált EXISTS-szel', () => {
    const { sql, params } = render(visibleSpacesWhere('viewer-1'));
    expect(sql).toBe(
      '("spaces"."deleted_at" IS NULL AND EXISTS ( SELECT 1 FROM "space_members" ' +
        'WHERE "space_members"."space_id" = "spaces"."id" AND "space_members"."user_id" = $1 ' +
        'AND "space_members"."removed_at" IS NULL))',
    );
    expect(params).toEqual(['viewer-1']);
  });
});
