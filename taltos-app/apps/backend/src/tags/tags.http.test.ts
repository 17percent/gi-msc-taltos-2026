import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  KindRef,
  ProblemDetails,
  TagListResponse,
  TagRef,
  TagSearchResponse,
} from '@taltos/shared';
import { createTestApp, TEST_ORIGIN, type TestContext, type TestSession } from '../testing/app.js';

/** A WP5a címke- és fajta-végpontok HTTP-tesztjei a memóriabeli adapterekkel (D58, D59). */
let ctx: TestContext;
let alice: TestSession;
let bob: TestSession;
let admin: TestSession;

beforeEach(async () => {
  ctx = await createTestApp();
  alice = await ctx.signIn('alice@example.test');
  bob = await ctx.signIn('bob@example.test');
  admin = await ctx.signIn('admin@example.test', 'system_admin');
});

afterEach(async () => {
  await ctx.app.close();
});

const call = (session: TestSession | undefined, method: string, url: string, payload?: object) =>
  ctx.app.inject({
    method: method as 'GET',
    url: `/api/v1${url}`,
    headers: session?.headers ?? { origin: TEST_ORIGIN },
    ...(payload === undefined ? {} : { payload }),
  });
const expectProblem = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json<ProblemDetails>().code).toBe(code);
};

/** Egy tér, benne egy dokumentum a megadott címkékkel; a tulajdonos a tag. */
function usedBy(session: TestSession, tagIds: string[]): string {
  const spaceId = randomUUID();
  ctx.collab.addSpace(spaceId);
  ctx.collab.addMember(spaceId, session.userId);
  const id = randomUUID();
  ctx.collab.addDocument(id, spaceId);
  ctx.tags.attach(id, tagIds);
  return spaceId;
}

describe('GET /tags', () => {
  it('q nélkül a látható címkéket adja darabszámmal; 401 munkamenet nélkül', async () => {
    const tag = ctx.tags.addTag('közös');
    usedBy(alice, [tag.id]);
    usedBy(bob, [tag.id]);
    const res = await call(alice, 'GET', '/tags');
    expect(res.json<TagListResponse>()).toEqual({
      tags: [{ id: tag.id, name: 'közös', count: 1 }],
    });
    expectProblem(await call(undefined, 'GET', '/tags'), 401, 'unauthenticated');
  });

  it('q-val: a lekérdezés normalizált (kis/nagybetű, ékezet, szóköz), pontos egyezés + javaslatok', async () => {
    const [a, b] = [ctx.tags.addTag('Gépi tanulás'), ctx.tags.addTag('gépi tanulások')];
    usedBy(alice, [a.id, b.id]);
    const body = (
      await call(alice, 'GET', `/tags?q=${encodeURIComponent('  GEPI   TANULAS ')}`)
    ).json<TagSearchResponse>();
    expect(body.exact).toEqual({ id: a.id, name: 'Gépi tanulás', count: 1 });
    expect(body.similar.map((t) => t.id)).toEqual([b.id]);
  });

  it('idegen színtérben használt címke se a listában, se a keresésben nem látszik', async () => {
    const tag = ctx.tags.addTag('titkos');
    usedBy(bob, [tag.id]);
    expect((await call(alice, 'GET', '/tags')).json<TagListResponse>().tags).toEqual([]);
    expect((await call(alice, 'GET', '/tags?q=titkos')).json<TagSearchResponse>()).toEqual({
      exact: null,
      similar: [],
    });
  });
});

describe('POST /tags', () => {
  it('új és már létező címke: azonos státusz és kulcskészlet (200 {id, name}); esemény csak az újnál', async () => {
    const created = await call(alice, 'POST', '/tags', { name: 'Új címke' });
    // a másik színtérben használt, alice számára rejtett címke újrahasznosítása
    const hidden = ctx.tags.addTag('Rejtett');
    usedBy(bob, [hidden.id]);
    const reused = await call(alice, 'POST', '/tags', { name: 'rejtett' });
    const again = await call(bob, 'POST', '/tags', { name: 'ÚJ   CÍMKE' });
    for (const res of [created, reused, again]) {
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.json<TagRef>()).sort()).toEqual(['id', 'name']);
    }
    expect(reused.json<TagRef>()).toEqual(hidden);
    expect(again.json<TagRef>()).toEqual(created.json<TagRef>());
    expect(ctx.tags.events.filter((e) => e.type === 'tag_created')).toEqual([
      { type: 'tag_created', actorId: alice.userId, details: { tagId: created.json<TagRef>().id } },
    ]);
  });

  it.each([
    ['üres név', { name: '' }],
    ['szóköz', { name: '   ' }],
    ['65 karakter', { name: 'x'.repeat(65) }],
    ['csak összetett jel', { name: '́' }],
    ['név nélkül', {}],
  ])('séma: %s → 400', async (_n, body) => {
    expectProblem(await call(alice, 'POST', '/tags', body), 400, 'validation_error');
  });

  it('a 64 karakteres név megfelel; munkamenet nélkül 401', async () => {
    expect((await call(alice, 'POST', '/tags', { name: 'x'.repeat(64) })).statusCode).toBe(200);
    expectProblem(await call(undefined, 'POST', '/tags', { name: 'x' }), 401, 'unauthenticated');
  });
});

describe('GET/POST /kinds', () => {
  it('bármely belépett felhasználó listázhat; 401 munkamenet nélkül', async () => {
    const res = await call(alice, 'GET', '/kinds');
    expect(res.json<KindRef[]>().map((k) => k.key)).toEqual(['prompt', 'skill', 'agent']);
    expectProblem(await call(undefined, 'GET', '/kinds'), 401, 'unauthenticated');
  });

  it('bővíteni csak a Rendszeradmin tud (403 forbidden másnak); 201; a lista bővül; kind_created', async () => {
    expectProblem(
      await call(alice, 'POST', '/kinds', { key: 'mcp_server', label: 'MCP' }),
      403,
      'forbidden',
    );
    const res = await call(admin, 'POST', '/kinds', { key: 'mcp_server', label: ' MCP-szerver ' });
    expect(res.statusCode).toBe(201);
    expect(res.json<KindRef>()).toEqual({ key: 'mcp_server', label: 'MCP-szerver' });
    expect((await call(alice, 'GET', '/kinds')).json<KindRef[]>().at(-1)?.key).toBe('mcp_server');
    expect(ctx.tags.events).toEqual([
      { type: 'kind_created', actorId: admin.userId, details: { key: 'mcp_server' } },
    ]);
  });

  it('már létező kulcs és rossz alak: 400 validation_error', async () => {
    expectProblem(
      await call(admin, 'POST', '/kinds', { key: 'prompt', label: 'Más' }),
      400,
      'validation_error',
    );
    for (const key of ['Nagy', '1abc', 'van szóköz', '']) {
      expectProblem(
        await call(admin, 'POST', '/kinds', { key, label: 'X' }),
        400,
        'validation_error',
      );
    }
  });
});
