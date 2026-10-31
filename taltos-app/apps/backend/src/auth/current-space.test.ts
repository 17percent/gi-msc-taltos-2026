import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MeResponse, ProblemDetails, SpaceType } from '@taltos/shared';
import { createTestApp, TEST_ORIGIN, type TestContext, type TestSession } from '../testing/app.js';
import { resolveCurrentSpaceId } from './current-space.js';

/**
 * D57: `PUT /api/v1/me/current-space` és a `GET /me` `currentSpaceId`-je a memóriabeli adapterekkel (a tényleges
 * SQL-t az `auth.int.test.ts` PostgreSQL-es ága bizonyítja).
 */
const PUT = '/api/v1/me/current-space';
const ME = '/api/v1/me';

let ctx: TestContext;
let anna: TestSession;

beforeEach(async () => {
  ctx = await createTestApp();
  anna = await ctx.signIn('anna@example.test');
});

afterEach(async () => {
  await ctx.app.close();
});

/** Egy tér mindkét memóriabeli világban (hozzáférés-döntés és `/me` lista); `member`: a tagja, akit megadunk. */
function space(type: SpaceType, member?: TestSession, name = `tér-${randomUUID()}`): string {
  const id = randomUUID();
  ctx.collab.access.addSpace(id, name, { type });
  if (member) {
    ctx.collab.addMember(id, member.userId);
    ctx.store.addMembership(member.userId, { id, name, type, role: 'author' });
  }
  return id;
}

const put = (
  session: TestSession | undefined,
  payload?: object,
  headers?: Record<string, string>,
) =>
  ctx.app.inject({
    method: 'PUT',
    url: PUT,
    headers: headers ?? session?.headers ?? { origin: TEST_ORIGIN },
    ...(payload === undefined ? {} : { payload }),
  });

const me = async (session: TestSession): Promise<MeResponse> =>
  (await ctx.app.inject({ method: 'GET', url: ME, headers: { cookie: session.cookie } })).json();

const expectProblem = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json<ProblemDetails>().code).toBe(code);
};

describe('PUT /me/current-space', () => {
  it('saját térre 204, és a /me a mentett értéket adja', async () => {
    const general = space('general', anna);
    const team = space('team', anna);
    expect((await me(anna)).currentSpaceId).toBe(general);
    const res = await put(anna, { spaceId: team });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect((await me(anna)).currentSpaceId).toBe(team);
  });

  it('nem naplózott (privát beállítás)', async () => {
    const team = space('team', anna);
    const before = ctx.spaces.events.length;
    expect((await put(anna, { spaceId: team })).statusCode).toBe(204);
    expect(ctx.spaces.events.length).toBe(before);
  });

  it('idegen térre 403 not_space_member (részletekkel), és az érték nem változik', async () => {
    const general = space('general', anna);
    const other = space('team');
    const res = await put(anna, { spaceId: other });
    expectProblem(res, 403, 'not_space_member');
    expect(res.json<ProblemDetails>().details).toMatchObject({ space: { id: other } });
    expect((await me(anna)).currentSpaceId).toBe(general);
  });

  it('a már eltávolított tag (nem aktív tagság) sem választhatja', async () => {
    const team = space('team');
    ctx.collab.addMember(team, anna.userId, true);
    expectProblem(await put(anna, { spaceId: team }), 403, 'not_space_member');
  });

  it('a tagság nélküli Rendszeradmin sem választhat (a tartalom csak a tagé, D44)', async () => {
    const admin = await ctx.signIn('admin@example.test', 'system_admin');
    expectProblem(await put(admin, { spaceId: space('team') }), 403, 'not_space_member');
  });

  it('lezárt, de saját projekt-tér választható (olvasás)', async () => {
    const id = randomUUID();
    ctx.collab.access.addSpace(id, 'lezárt', { type: 'project', closed: true });
    ctx.collab.addMember(id, anna.userId);
    expect((await put(anna, { spaceId: id })).statusCode).toBe(204);
  });

  it('ismeretlen tér 404 not_found', async () => {
    expectProblem(await put(anna, { spaceId: randomUUID() }), 404, 'not_found');
  });

  it('hiányzó vagy hibás törzs 400 validation_error', async () => {
    for (const payload of [{}, { spaceId: 'nem-uuid' }, { spaceId: 5 }]) {
      expectProblem(await put(anna, payload), 400, 'validation_error');
    }
    expectProblem(await put(anna), 400, 'validation_error');
  });

  it('munkamenet nélkül 401', async () => {
    expectProblem(await put(undefined, { spaceId: randomUUID() }), 401, 'unauthenticated');
  });

  it('CSRF-token nélkül, vagy idegen Originnel 403 csrf_failed, és nem ír', async () => {
    const team = space('team', anna);
    const general = space('general', anna);
    const withoutCsrf = { cookie: anna.cookie, origin: TEST_ORIGIN };
    expectProblem(await put(anna, { spaceId: team }, withoutCsrf), 403, 'csrf_failed');
    const badOrigin = { ...anna.headers, origin: 'https://evil.example' };
    expectProblem(await put(anna, { spaceId: team }, badOrigin), 403, 'csrf_failed');
    expect((await me(anna)).currentSpaceId).toBe(general);
  });
});

describe('GET /me currentSpaceId tartalék', () => {
  it('a tárolt, még érvényes tér', async () => {
    space('general', anna);
    const team = space('team', anna);
    await ctx.store.setCurrentSpace(anna.userId, team);
    expect((await me(anna)).currentSpaceId).toBe(team);
  });

  it('a tárolt tér, de a tagság megszűnt: az Általános', async () => {
    const general = space('general', anna);
    const team = space('team', anna);
    await ctx.store.setCurrentSpace(anna.userId, team);
    ctx.store.removeMembership(anna.userId, team);
    expect((await me(anna)).currentSpaceId).toBe(general);
  });

  it('nincs mentett érték, és nincs Általános: az első saját tér', async () => {
    const first = space('team', anna, 'Alfa');
    space('project', anna, 'Béta');
    expect((await me(anna)).currentSpaceId).toBe(first);
  });

  it('nincs tér: null', async () => {
    const body = await me(anna);
    expect(body.spaces).toEqual([]);
    expect(body.currentSpaceId).toBeNull();
    await ctx.store.setCurrentSpace(anna.userId, randomUUID());
    expect((await me(anna)).currentSpaceId).toBeNull();
  });
});

describe('resolveCurrentSpaceId', () => {
  const s = (id: string, type: SpaceType) => ({ id, name: id, type, role: 'author' as const });
  const list = [s('g', 'general'), s('a', 'team'), s('b', 'project')];

  it('érvényes tárolt érték, tartalék sorrend, üres lista', () => {
    expect(resolveCurrentSpaceId('b', list)).toBe('b');
    expect(resolveCurrentSpaceId('x', list)).toBe('g');
    expect(resolveCurrentSpaceId(null, list)).toBe('g');
    expect(resolveCurrentSpaceId('x', [s('a', 'team'), s('b', 'project')])).toBe('a');
    expect(resolveCurrentSpaceId('x', [])).toBeNull();
    expect(resolveCurrentSpaceId(null, [])).toBeNull();
  });
});
