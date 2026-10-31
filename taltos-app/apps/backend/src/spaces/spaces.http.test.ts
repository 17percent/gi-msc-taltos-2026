import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AdminHandoverResponse,
  type AdminUser,
  type ProblemDetails,
  type SpaceDetail,
  type SpaceMember,
  type SpaceRole,
  type SpaceSummary,
  type SpaceType,
  type UserRef,
} from '@taltos/shared';
import { can } from '../policy/policy.js';
import { createTestApp, TEST_ORIGIN, type TestContext, type TestSession } from '../testing/app.js';
import type { MemoryDocument } from '../testing/memory-access-store.js';

/**
 * A WP4a végpontok HTTP-tesztjei a memóriabeli adapterekkel (a tényleges SQL-t, a zárakat és az atomicitást a
 * PostgreSQL elleni integrációs tesztek bizonyítják). Minden végponthoz: siker, 401, 403 (`forbidden`,
 * `not_space_member`, `space_closed`), 404 és a 409/422-es védelmek.
 */
let ctx: TestContext;
let admin: TestSession;
let mgr: TestSession;
let anna: TestSession;
let bela: TestSession;
let out: TestSession;

beforeEach(async () => {
  ctx = await createTestApp();
  admin = await ctx.signIn('admin@example.test', 'system_admin');
  mgr = await ctx.signIn('mgr@example.test');
  anna = await ctx.signIn('anna@example.test');
  bela = await ctx.signIn('bela@example.test');
  out = await ctx.signIn('out@example.test');
});

afterEach(async () => {
  await ctx.app.close();
});

const call = (session: TestSession | undefined, method: string, url: string, payload?: object) =>
  ctx.app.inject({
    method: method as 'GET',
    url: `/api/v1${url}`,
    headers: session?.headers ?? { origin: TEST_ORIGIN }, // munkamenet nélkül is böngészős (Origin), így a 401 jön, nem a csrf_failed
    ...(payload === undefined ? {} : { payload }),
  });

const problem = (res: LightMyRequestResponse) => res.json<ProblemDetails>();
const expectProblem = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(problem(res).code).toBe(code);
};
const events = (type: string) => ctx.spaces.events.filter((e) => e.type === type);

/** Egy színtér a memóriabeli világban; a lezárt tér mindig projekt (CHECK `spaces_closed_only_project`). */
function newSpace(options: { type?: SpaceType; closed?: boolean } = {}): string {
  const id = randomUUID();
  ctx.collab.access.addSpace(id, `tér-${id}`, {
    type: options.type ?? (options.closed ? 'project' : 'team'),
    closed: options.closed ?? false,
  });
  return id;
}
const join = (spaceId: string, session: TestSession, role: SpaceRole = 'author') =>
  ctx.collab.access.addMember(spaceId, session.userId, role);
const newDoc = (
  spaceId: string,
  ownerId: string,
  options: Partial<Omit<MemoryDocument, 'spaceId' | 'ownerId'>> = {},
): string => {
  const id = randomUUID();
  ctx.collab.access.addDocument(id, spaceId, ownerId, options);
  return id;
};
/** Nyitott csapat-tér: mgr gazda, anna és bela szerző. */
function standardSpace(options: { type?: SpaceType; closed?: boolean } = {}): string {
  const id = newSpace(options);
  join(id, mgr, 'space_manager');
  join(id, anna);
  join(id, bela);
  return id;
}

describe('GET /spaces', () => {
  it('401 munkamenet nélkül', async () => {
    expect((await call(undefined, 'GET', '/spaces')).statusCode).toBe(401);
  });

  it('a tag a saját színtereit látja, a nem tag semmit; a Rendszeradmin mindet (csak metaadat)', async () => {
    const id = standardSpace();
    const other = newSpace();
    expect((await call(anna, 'GET', '/spaces')).json<SpaceSummary[]>().map((s) => s.id)).toEqual([
      id,
    ]);
    expect((await call(out, 'GET', '/spaces')).json()).toEqual([]);
    const all = (await call(admin, 'GET', '/spaces')).json<SpaceSummary[]>();
    expect(all.map((s) => s.id).sort()).toEqual([id, other].sort());
    expect(Object.keys(all[0] ?? {}).sort()).toEqual(
      ['closed', 'color', 'description', 'id', 'name', 'type'].sort(),
    );
  });
});

describe('POST /spaces', () => {
  const body = (initialManagerId: string, extra: object = {}) => ({
    name: 'Új csapat',
    type: 'team',
    description: 'Leírás',
    color: '#3B6FB6',
    initialManagerId,
    ...extra,
  });

  it('401 / 403: csak a Rendszeradmin hozhat létre', async () => {
    expect((await call(undefined, 'POST', '/spaces', body(mgr.userId))).statusCode).toBe(401);
    expectProblem(await call(mgr, 'POST', '/spaces', body(mgr.userId)), 403, 'forbidden');
  });

  it('201: a tér létrejön a kezdeti Színtérgazdával, space_created és space_manager_assigned esemény', async () => {
    const res = await call(admin, 'POST', '/spaces', body(mgr.userId));
    expect(res.statusCode, res.body).toBe(201);
    const space = res.json<SpaceDetail>();
    expect(space).toMatchObject({ name: 'Új csapat', type: 'team', closed: false, memberCount: 1 });
    expect(space.managers.map((m) => m.id)).toEqual([mgr.userId]);
    expect(events('space_created')).toHaveLength(1);
    expect(events('space_manager_assigned')).toHaveLength(1);
    expect(JSON.stringify(ctx.spaces.events)).not.toMatch(/Új csapat|@example/);
  });

  it('400: érvénytelen szín, nem létrehozható típus (general), ismeretlen vagy nem allowlistes gazda, foglalt név', async () => {
    for (const bad of [{ color: '#000000' }, { type: 'general' }, { name: '   ' }, { x: 1 }]) {
      const res = await call(admin, 'POST', '/spaces', body(mgr.userId, bad));
      // a felesleges mező (x) némán kimarad, a többi hibás érték 400
      expect(res.statusCode).toBe('x' in bad ? 201 : 400);
    }
    expectProblem(
      await call(admin, 'POST', '/spaces', body(randomUUID())),
      400,
      'validation_error',
    );
    ctx.store.disallow('mgr@example.test');
    expectProblem(
      await call(admin, 'POST', '/spaces', body(mgr.userId, { name: 'Más' })),
      400,
      'validation_error',
    );
    ctx.store.allow('mgr@example.test');
    expectProblem(await call(admin, 'POST', '/spaces', body(mgr.userId)), 400, 'validation_error'); // a név már foglalt
  });
});

describe('GET /spaces/:id', () => {
  it('401, 200 tagnak, 200 nem tag Rendszeradminnak, 403 not_space_member nem tagnak (részletekkel), 404', async () => {
    const id = standardSpace();
    expect((await call(undefined, 'GET', `/spaces/${id}`)).statusCode).toBe(401);
    const detail = (await call(anna, 'GET', `/spaces/${id}`)).json<SpaceDetail>();
    expect(detail).toMatchObject({ id, memberCount: 3 });
    expect(detail.managers.map((m) => m.id)).toEqual([mgr.userId]);
    expect((await call(admin, 'GET', `/spaces/${id}`)).statusCode).toBe(200);
    const denied = await call(out, 'GET', `/spaces/${id}`);
    expectProblem(denied, 403, 'not_space_member');
    expect(problem(denied).details).toMatchObject({
      space: { id },
      managers: [{ id: mgr.userId }],
      canRequestMembership: true,
    });
    expectProblem(await call(anna, 'GET', `/spaces/${randomUUID()}`), 404, 'not_found');
    expectProblem(await call(anna, 'GET', '/spaces/nem-uuid'), 400, 'validation_error');
  });
});

describe('PATCH /spaces/:id', () => {
  it('401, 404, 403 (Szerző forbidden, nem tag not_space_member)', async () => {
    const id = standardSpace();
    expect((await call(undefined, 'PATCH', `/spaces/${id}`, { description: 'x' })).statusCode).toBe(
      401,
    );
    expectProblem(
      await call(admin, 'PATCH', `/spaces/${randomUUID()}`, { description: 'x' }),
      404,
      'not_found',
    );
    expectProblem(
      await call(anna, 'PATCH', `/spaces/${id}`, { description: 'x' }),
      403,
      'forbidden',
    );
    expectProblem(
      await call(out, 'PATCH', `/spaces/${id}`, { description: 'x' }),
      403,
      'not_space_member',
    );
  });

  it('a Színtérgazda a leírást és a színt módosítja (space_updated), a nevet nem (forbidden)', async () => {
    const id = standardSpace();
    const res = await call(mgr, 'PATCH', `/spaces/${id}`, { description: 'Új', color: '#2E8B6F' });
    expect(res.json<SpaceDetail>()).toMatchObject({ description: 'Új', color: '#2E8B6F' });
    expect(events('space_updated')[0]).toMatchObject({
      details: { fields: ['description', 'color'] },
    });
    expectProblem(await call(mgr, 'PATCH', `/spaces/${id}`, { name: 'Másik' }), 403, 'forbidden');
  });

  it('a Rendszeradmin átnevezheti (nem tagként is); a típus nem módosítható; a foglalt név 400', async () => {
    const id = standardSpace();
    const other = newSpace();
    const res = await call(admin, 'PATCH', `/spaces/${id}`, {
      name: 'Átnevezett',
      type: 'project',
    });
    expect(res.json<SpaceDetail>()).toMatchObject({ name: 'Átnevezett', type: 'team' });
    expectProblem(
      await call(admin, 'PATCH', `/spaces/${other}`, { name: 'átnevezett' }),
      400,
      'validation_error',
    );
    expectProblem(
      await call(admin, 'PATCH', `/spaces/${id}`, { color: '#123456' }),
      400,
      'validation_error',
    );
    expectProblem(await call(admin, 'PATCH', `/spaces/${id}`, {}), 400, 'validation_error');
  });

  it('lezárt térben a Színtérgazda és a Rendszeradmin is 403 space_closed', async () => {
    const id = standardSpace({ closed: true });
    expectProblem(
      await call(mgr, 'PATCH', `/spaces/${id}`, { description: 'x' }),
      403,
      'space_closed',
    );
    expectProblem(await call(admin, 'PATCH', `/spaces/${id}`, { name: 'x' }), 403, 'space_closed');
  });
});

describe('POST /spaces/:id/close', () => {
  it('401, 404, 403 (nem admin forbidden, nem tag not_space_member)', async () => {
    const id = standardSpace({ type: 'project' });
    expect((await call(undefined, 'POST', `/spaces/${id}/close`)).statusCode).toBe(401);
    expectProblem(await call(admin, 'POST', `/spaces/${randomUUID()}/close`), 404, 'not_found');
    expectProblem(await call(mgr, 'POST', `/spaces/${id}/close`), 403, 'forbidden');
    expectProblem(await call(out, 'POST', `/spaces/${id}/close`), 403, 'not_space_member');
  });

  it('nem projekt-tér lezárása 403 forbidden (csapat és Általános)', async () => {
    expectProblem(await call(admin, 'POST', `/spaces/${standardSpace()}/close`), 403, 'forbidden');
    expectProblem(
      await call(admin, 'POST', `/spaces/${standardSpace({ type: 'general' })}/close`),
      403,
      'forbidden',
    );
  });

  it('200, és az ismételt lezárás is 200 (idempotens), egyetlen space_closed esemény', async () => {
    const id = standardSpace({ type: 'project' });
    const first = await call(admin, 'POST', `/spaces/${id}/close`);
    expect(first.json<SpaceDetail>().closed).toBe(true);
    expect((await call(admin, 'POST', `/spaces/${id}/close`)).statusCode).toBe(200);
    expect(events('space_closed')).toHaveLength(1);
  });

  it('a lezárás atomikus: a függő kérések aktor nélkül visszavonódnak, a dokumentum Piszkozat, utána nem szerkeszthető', async () => {
    const id = standardSpace({ type: 'project' });
    const pending = newDoc(id, mgr.userId, {
      reviewState: 'pending',
      pending: { id: randomUUID(), initiatorId: anna.userId, reviewers: [mgr.userId, bela.userId] },
    });
    const plain = newDoc(id, mgr.userId);
    expect((await call(admin, 'POST', `/spaces/${id}/close`)).statusCode).toBe(200);

    const withdrawn = events('review_withdrawn');
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toMatchObject({
      actorId: null,
      documentId: pending,
      details: { reason: 'space_closed' },
    });
    expect(events('space_closed')[0]).toMatchObject({ details: { withdrawnRequests: 1 } });
    expect(ctx.collab.access.documents.get(pending)?.reviewState).toBe('draft');
    expect(ctx.collab.access.documents.get(pending)?.pending).toBeUndefined();

    for (const documentId of [pending, plain]) {
      const target = await ctx.collab.access.documentTarget(anna.userId, documentId);
      expect(
        can({ userId: anna.userId, systemRole: 'user' }, 'document.edit', target as never),
      ).toEqual({
        ok: false,
        code: 'space_closed',
      });
      // olvasás és kedvenc megy (D56)
      expect(
        can({ userId: anna.userId, systemRole: 'user' }, 'document.read', target as never).ok,
      ).toBe(true);
      expect(
        can({ userId: anna.userId, systemRole: 'user' }, 'document.favorite', target as never).ok,
      ).toBe(true);
    }
  });
});

describe('GET /spaces/:id/members', () => {
  it('401, 404, 200 tagnak és nem tag Rendszeradminnak, 403 not_space_member', async () => {
    const id = standardSpace();
    expect((await call(undefined, 'GET', `/spaces/${id}/members`)).statusCode).toBe(401);
    expectProblem(await call(anna, 'GET', `/spaces/${randomUUID()}/members`), 404, 'not_found');
    const list = (await call(anna, 'GET', `/spaces/${id}/members`)).json<SpaceMember[]>();
    expect(list.map((m) => [m.user.displayName, m.role])).toEqual([
      ['anna', 'author'],
      ['bela', 'author'],
      ['mgr', 'space_manager'],
    ]);
    expect(JSON.stringify(list)).not.toContain('@');
    expect((await call(admin, 'GET', `/spaces/${id}/members`)).statusCode).toBe(200);
    expectProblem(await call(out, 'GET', `/spaces/${id}/members`), 403, 'not_space_member');
  });
});

describe('POST /spaces/:id/members', () => {
  it('401, 404, 403 (Szerző forbidden, nem tag not_space_member)', async () => {
    const id = standardSpace();
    const body = { userId: out.userId, role: 'author' };
    expect((await call(undefined, 'POST', `/spaces/${id}/members`, body)).statusCode).toBe(401);
    expectProblem(
      await call(admin, 'POST', `/spaces/${randomUUID()}/members`, body),
      404,
      'not_found',
    );
    expectProblem(await call(anna, 'POST', `/spaces/${id}/members`, body), 403, 'forbidden');
    expectProblem(await call(out, 'POST', `/spaces/${id}/members`, body), 403, 'not_space_member');
  });

  it('a Színtérgazda felvesz (201, member_added); újrapróbálva ugyanazzal a szereppel nem ír; másik szerep 400', async () => {
    const id = standardSpace();
    const body = { userId: out.userId, role: 'author' };
    const res = await call(mgr, 'POST', `/spaces/${id}/members`, body);
    expect(res.statusCode).toBe(201);
    expect(res.json<SpaceMember>()).toMatchObject({ user: { id: out.userId }, role: 'author' });
    expect(events('member_added')).toHaveLength(1);
    expect((await call(mgr, 'POST', `/spaces/${id}/members`, body)).statusCode).toBe(201);
    expect(events('member_added')).toHaveLength(1);
    expectProblem(
      await call(mgr, 'POST', `/spaces/${id}/members`, { ...body, role: 'space_manager' }),
      400,
      'validation_error',
    );
  });

  it('ismeretlen vagy nem allowlistes felhasználó: 400', async () => {
    const id = standardSpace();
    expectProblem(
      await call(mgr, 'POST', `/spaces/${id}/members`, { userId: randomUUID(), role: 'author' }),
      400,
      'validation_error',
    );
    ctx.store.disallow('out@example.test');
    expectProblem(
      await call(mgr, 'POST', `/spaces/${id}/members`, { userId: out.userId, role: 'author' }),
      400,
      'validation_error',
    );
  });

  it('önfelvétel: a Rendszeradmin a kért szerepbe veszi fel magát (self_assigned), értesítés nélkül', async () => {
    const id = standardSpace();
    const res = await call(admin, 'POST', `/spaces/${id}/members`, {
      userId: admin.userId,
      role: 'space_manager',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<SpaceMember>().role).toBe('space_manager');
    expect(events('member_added')[0]).toMatchObject({
      details: { userId: admin.userId, self_assigned: true },
    });
    // más felvétele nem önfelvétel
    await call(admin, 'POST', `/spaces/${id}/members`, { userId: out.userId, role: 'author' });
    expect(events('member_added')[1]?.details).not.toHaveProperty('self_assigned');
  });

  it('lezárt térben a Színtérgazda 403 space_closed, a Rendszeradmin felvehet', async () => {
    const id = standardSpace({ closed: true });
    const body = { userId: out.userId, role: 'author' };
    expectProblem(await call(mgr, 'POST', `/spaces/${id}/members`, body), 403, 'space_closed');
    expect((await call(admin, 'POST', `/spaces/${id}/members`, body)).statusCode).toBe(201);
  });
});

describe('PATCH /spaces/:id/members/:userId', () => {
  const patch = (who: TestSession | undefined, id: string, user: string, role: SpaceRole) =>
    call(who, 'PATCH', `/spaces/${id}/members/${user}`, { role });

  it('401, 404, 403', async () => {
    const id = standardSpace();
    expect((await patch(undefined, id, anna.userId, 'space_manager')).statusCode).toBe(401);
    expectProblem(await patch(mgr, randomUUID(), anna.userId, 'space_manager'), 404, 'not_found');
    expectProblem(await patch(mgr, id, out.userId, 'space_manager'), 404, 'not_found'); // nem tag a célpont
    expectProblem(await patch(anna, id, bela.userId, 'space_manager'), 403, 'forbidden');
    expectProblem(await patch(out, id, bela.userId, 'space_manager'), 403, 'not_space_member');
  });

  it('előléptetés és visszaminősítés (role_changed); két gazdánál az egyik visszaminősíthető', async () => {
    const id = standardSpace();
    const up = await patch(mgr, id, anna.userId, 'space_manager');
    expect(up.json<SpaceMember>().role).toBe('space_manager');
    expect(events('role_changed')[0]).toMatchObject({
      details: { userId: anna.userId, from: 'author', to: 'space_manager' },
    });
    expect((await patch(anna, id, mgr.userId, 'author')).statusCode).toBe(200);
  });

  it('409 last_space_manager: az utolsó gazda nem minősíthető vissza (más által és önmaga által sem)', async () => {
    const id = standardSpace();
    expectProblem(await patch(mgr, id, mgr.userId, 'author'), 409, 'last_space_manager');
    expectProblem(await patch(admin, id, mgr.userId, 'author'), 409, 'last_space_manager');
  });

  it('az utolsó gazda védelmében az aktív allowlistes gazda számít: a kizárt címűt nem számoljuk', async () => {
    const id = standardSpace();
    join(id, out, 'space_manager');
    ctx.store.disallow('out@example.test');
    expectProblem(await patch(mgr, id, mgr.userId, 'author'), 409, 'last_space_manager');
  });

  it('lezárt térben a Színtérgazda 403 space_closed, a Rendszeradmin módosíthat', async () => {
    const id = standardSpace({ closed: true });
    expectProblem(await patch(mgr, id, anna.userId, 'space_manager'), 403, 'space_closed');
    expect((await patch(admin, id, anna.userId, 'space_manager')).statusCode).toBe(200);
  });
});

describe('DELETE /spaces/:id/members/:userId', () => {
  const remove = (who: TestSession | undefined, id: string, user: string) =>
    call(who, 'DELETE', `/spaces/${id}/members/${user}`);

  it('401, 404, 403', async () => {
    const id = standardSpace();
    expect((await remove(undefined, id, anna.userId)).statusCode).toBe(401);
    expectProblem(await remove(mgr, randomUUID(), anna.userId), 404, 'not_found');
    expectProblem(await remove(mgr, id, out.userId), 404, 'not_found');
    expectProblem(await remove(anna, id, bela.userId), 403, 'forbidden');
    expectProblem(await remove(out, id, bela.userId), 403, 'not_space_member');
  });

  it('204: a tag eltávolítva (member_removed), és már nem tag', async () => {
    const id = standardSpace();
    expect((await remove(mgr, id, anna.userId)).statusCode).toBe(204);
    expect(events('member_removed')[0]).toMatchObject({
      actorId: mgr.userId,
      details: { userId: anna.userId },
    });
    expectProblem(await call(anna, 'GET', `/spaces/${id}`), 403, 'not_space_member');
  });

  it('409 last_space_manager: az utolsó gazda nem távolítható el (önmaga sem)', async () => {
    const id = standardSpace();
    expectProblem(await remove(mgr, id, mgr.userId), 409, 'last_space_manager');
    expectProblem(await remove(admin, id, mgr.userId), 409, 'last_space_manager');
  });

  it('409 owner_handover_required az archiválatlan dokumentum tulajdonosára; az csak archivált dokumentumok tulajdonosa eltávolítható', async () => {
    const id = standardSpace();
    const live = newDoc(id, anna.userId);
    expectProblem(await remove(mgr, id, anna.userId), 409, 'owner_handover_required');
    expect(live).toBeDefined();
    newDoc(id, bela.userId, { deleted: true, everApproved: true }); // archivált
    expect((await remove(mgr, id, bela.userId)).statusCode).toBe(204);
  });

  it('az Általánosból nem távolítható el tag: 403 forbidden (Színtérgazda és Rendszeradmin is)', async () => {
    const id = standardSpace({ type: 'general' });
    expectProblem(await remove(mgr, id, anna.userId), 403, 'forbidden');
    expectProblem(await remove(admin, id, anna.userId), 403, 'forbidden');
  });

  it('lezárt térben a Színtérgazda 403 space_closed, a Rendszeradmin eltávolíthat', async () => {
    const id = standardSpace({ closed: true });
    expectProblem(await remove(mgr, id, anna.userId), 403, 'space_closed');
    expect((await remove(admin, id, anna.userId)).statusCode).toBe(204);
  });

  it('az eltávolított indítványozó függő kérése visszavonódik (member_removed, aktor az eltávolító), a dokumentum Piszkozat', async () => {
    const id = standardSpace();
    const doc = newDoc(id, mgr.userId, {
      reviewState: 'pending',
      pending: { id: randomUUID(), initiatorId: anna.userId, reviewers: [mgr.userId, bela.userId] },
    });
    expect((await remove(mgr, id, anna.userId)).statusCode).toBe(204);
    expect(events('review_withdrawn')).toEqual([
      expect.objectContaining({
        actorId: mgr.userId,
        documentId: doc,
        details: { reason: 'member_removed' },
      }),
    ]);
    expect(ctx.collab.access.documents.get(doc)).toMatchObject({ reviewState: 'draft' });
  });

  it('a függő review-er helye megszűnik (reviewer_removed), a másik review-er döntése megmarad', async () => {
    const id = standardSpace();
    const cecil = await ctx.signIn('cecil@example.test');
    join(id, cecil);
    const doc = newDoc(id, mgr.userId, {
      reviewState: 'pending',
      pending: {
        id: randomUUID(),
        initiatorId: anna.userId,
        reviewers: [bela.userId, cecil.userId],
        decided: [cecil.userId],
      },
    });
    expect((await remove(mgr, id, bela.userId)).statusCode).toBe(204);
    expect(events('reviewer_removed')).toEqual([
      expect.objectContaining({
        actorId: mgr.userId,
        documentId: doc,
        details: { reviewerId: bela.userId, reason: 'member_removed' },
      }),
    ]);
    const pending = ctx.collab.access.documents.get(doc)?.pending;
    expect(pending?.reviewers).toEqual([cecil.userId]);
    expect(pending?.decided).toEqual([cecil.userId]);
    expect(ctx.collab.access.documents.get(doc)?.reviewState).toBe('pending'); // a kérés él, pótlásra vár
  });

  it('a már döntött review-er helye és döntése megmarad, ha a tagot eltávolítják', async () => {
    const id = standardSpace();
    const doc = newDoc(id, mgr.userId, {
      reviewState: 'pending',
      pending: {
        id: randomUUID(),
        initiatorId: anna.userId,
        reviewers: [bela.userId, mgr.userId],
        decided: [bela.userId],
      },
    });
    expect((await remove(mgr, id, bela.userId)).statusCode).toBe(204);
    expect(events('reviewer_removed')).toHaveLength(0);
    expect(ctx.collab.access.documents.get(doc)?.pending?.reviewers).toContain(bela.userId);
  });
});

describe('GET /users', () => {
  it('401; 400 két karakter alatt; csak id, displayName, avatarUrl; legfeljebb 10 találat; nem allowlistes nem jelenik meg', async () => {
    expect((await call(undefined, 'GET', '/users?q=an')).statusCode).toBe(401);
    expectProblem(await call(anna, 'GET', '/users?q=a'), 400, 'validation_error');
    expectProblem(await call(anna, 'GET', '/users?q=%20a%20'), 400, 'validation_error');
    expectProblem(await call(anna, 'GET', '/users'), 400, 'validation_error');

    const found = (await call(anna, 'GET', '/users?q=ann')).json<UserRef[]>();
    expect(found.map((u) => u.displayName)).toEqual(['anna']);
    expect(Object.keys(found[0] ?? {}).sort()).toEqual(['avatarUrl', 'displayName', 'id']);

    for (let i = 0; i < 12; i += 1)
      await ctx.signIn(`zed${String(i).padStart(2, '0')}@example.test`);
    expect((await call(anna, 'GET', '/users?q=zed')).json<UserRef[]>()).toHaveLength(10);
    ctx.store.disallow('zed00@example.test');
    expect((await call(anna, 'GET', '/users?q=zed00')).json()).toEqual([]);
  });

  it('a LIKE-jokerek szó szerint értendők', async () => {
    expect((await call(anna, 'GET', '/users?q=%25%25')).json()).toEqual([]);
    expect((await call(anna, 'GET', '/users?q=__')).json()).toEqual([]);
  });
});

describe('GET /admin/users', () => {
  it('401, 403 forbidden nem adminnak, 200 adminnak (szerep, e-mail, utolsó belépés)', async () => {
    expect((await call(undefined, 'GET', '/admin/users')).statusCode).toBe(401);
    expectProblem(await call(anna, 'GET', '/admin/users'), 403, 'forbidden');
    const list = (await call(admin, 'GET', '/admin/users')).json<AdminUser[]>();
    expect(list.find((u) => u.id === admin.userId)).toMatchObject({
      systemRole: 'system_admin',
      email: 'admin@example.test',
      lastLoginAt: null,
    });
  });
});

describe('PUT /admin/users/:id/system-role', () => {
  const put = (who: TestSession | undefined, id: string, systemRole: string) =>
    call(who, 'PUT', `/admin/users/${id}/system-role`, { systemRole });

  it('401, 403, 404, 400', async () => {
    expect((await put(undefined, anna.userId, 'system_admin')).statusCode).toBe(401);
    expectProblem(await put(anna, anna.userId, 'system_admin'), 403, 'forbidden');
    expectProblem(await put(admin, randomUUID(), 'system_admin'), 404, 'not_found');
    expectProblem(await put(admin, anna.userId, 'root'), 400, 'validation_error');
  });

  it('kinevezés és lefokozás, naplózva; a lefokozott többé nem admin', async () => {
    const res = await put(admin, anna.userId, 'system_admin');
    expect(res.json<AdminUser>().systemRole).toBe('system_admin');
    expect(events('system_admin_granted')).toHaveLength(1);
    expect((await put(admin, anna.userId, 'user')).statusCode).toBe(200);
    expect(events('system_admin_revoked')).toHaveLength(1);
    expectProblem(await call(anna, 'GET', '/admin/users'), 403, 'forbidden');
  });

  it('409 last_admin: az utolsó Rendszeradmin nem fokozható le (önmaga sem)', async () => {
    expectProblem(await put(admin, admin.userId, 'user'), 409, 'last_admin');
  });

  it('az aktív allowlistes admin számít: a kizárt címűt nem számoljuk pótlónak', async () => {
    const second = await ctx.signIn('second@example.test', 'system_admin');
    ctx.store.disallow('second@example.test');
    expectProblem(await put(admin, admin.userId, 'user'), 409, 'last_admin');
    ctx.store.allow('second@example.test');
    expect((await put(admin, admin.userId, 'user')).statusCode).toBe(200);
    expect(second.userId).toBeDefined();
  });
});

describe('POST /admin/users/:id/handover (admin_handover, D56)', () => {
  const handover = (who: TestSession | undefined, userId: string, body: object) =>
    call(who, 'POST', `/admin/users/${userId}/handover`, body);

  it('401, 403 nem adminnak (Színtérgazdának is), 404 ismeretlen tér és felhasználó, 400', async () => {
    const id = standardSpace();
    const body = { spaceId: id, newOwnerId: bela.userId };
    expect((await handover(undefined, anna.userId, body)).statusCode).toBe(401);
    expectProblem(await handover(mgr, anna.userId, body), 403, 'forbidden');
    expectProblem(
      await handover(admin, anna.userId, { ...body, spaceId: randomUUID() }),
      404,
      'not_found',
    );
    expectProblem(await handover(admin, randomUUID(), body), 404, 'not_found');
    expectProblem(await handover(admin, anna.userId, { spaceId: id }), 400, 'validation_error');
  });

  it('a felhasználó adott színtérbeli összes (archivált is) dokumentuma az új tulajdonosra kerül, dokumentumonként egy owner_changed (admin_handover)', async () => {
    const id = standardSpace();
    const other = standardSpace();
    const a = newDoc(id, anna.userId);
    const b = newDoc(id, anna.userId, { deleted: true, everApproved: true });
    const elsewhere = newDoc(other, anna.userId);
    const res = await handover(admin, anna.userId, { spaceId: id, newOwnerId: bela.userId });
    expect(res.json<AdminHandoverResponse>()).toEqual({ movedDocuments: 2 });
    expect(ctx.collab.access.documents.get(a)?.ownerId).toBe(bela.userId);
    expect(ctx.collab.access.documents.get(b)?.ownerId).toBe(bela.userId);
    expect(ctx.collab.access.documents.get(elsewhere)?.ownerId).toBe(anna.userId);
    const changed = events('owner_changed');
    expect(changed.map((e) => 'documentId' in e && e.documentId).sort()).toEqual([a, b].sort());
    for (const e of changed) {
      expect(e).toMatchObject({
        actorId: admin.userId,
        details: { from: anna.userId, to: bela.userId, reason: 'admin_handover' },
      });
    }
  });

  it('lezárt térben is megy', async () => {
    const id = standardSpace({ closed: true });
    newDoc(id, anna.userId);
    const res = await handover(admin, anna.userId, { spaceId: id, newOwnerId: bela.userId });
    expect(res.json<AdminHandoverResponse>().movedDocuments).toBe(1);
  });

  it('422 invalid_new_owner: nem aktív tag, megszűnt tag, azonos felhasználó', async () => {
    const id = standardSpace();
    expectProblem(
      await handover(admin, anna.userId, { spaceId: id, newOwnerId: out.userId }),
      422,
      'invalid_new_owner',
    );
    ctx.collab.access.addMember(id, out.userId, 'author', true);
    expectProblem(
      await handover(admin, anna.userId, { spaceId: id, newOwnerId: out.userId }),
      422,
      'invalid_new_owner',
    );
    expectProblem(
      await handover(admin, anna.userId, { spaceId: id, newOwnerId: anna.userId }),
      422,
      'invalid_new_owner',
    );
    expect(events('owner_changed')).toHaveLength(0);
  });

  it('az átadás után a korábbi tulajdonos eltávolíthatóvá válik', async () => {
    const id = standardSpace();
    newDoc(id, anna.userId);
    expectProblem(
      await call(mgr, 'DELETE', `/spaces/${id}/members/${anna.userId}`),
      409,
      'owner_handover_required',
    );
    await handover(admin, anna.userId, { spaceId: id, newOwnerId: bela.userId });
    expect((await call(mgr, 'DELETE', `/spaces/${id}/members/${anna.userId}`)).statusCode).toBe(
      204,
    );
  });
});

describe('PUT /documents/:id/owner (D55)', () => {
  const put = (who: TestSession | undefined, doc: string, userId: string) =>
    call(who, 'PUT', `/documents/${doc}/owner`, { userId });

  it('401, 404', async () => {
    const id = standardSpace();
    const doc = newDoc(id, anna.userId);
    expect((await put(undefined, doc, bela.userId)).statusCode).toBe(401);
    expectProblem(await put(anna, randomUUID(), bela.userId), 404, 'not_found');
    ctx.collab.access.addDocument(randomUUID(), id, anna.userId); // az eldobott piszkozat sem létezik
    const dropped = newDoc(id, anna.userId, { deleted: true });
    expectProblem(await put(mgr, dropped, bela.userId), 404, 'not_found');
  });

  it('a tulajdonos (aki tag) review nélkül azonnal átadja: 204 + owner_changed (handover)', async () => {
    const id = standardSpace();
    const doc = newDoc(id, anna.userId);
    expect((await put(anna, doc, bela.userId)).statusCode).toBe(204);
    expect(ctx.collab.access.documents.get(doc)?.ownerId).toBe(bela.userId);
    expect(events('owner_changed')).toEqual([
      expect.objectContaining({
        actorId: anna.userId,
        documentId: doc,
        details: { from: anna.userId, to: bela.userId, reason: 'handover' },
      }),
    ]);
  });

  it('a Színtérgazda bármely dokumentumot átadhat, archiváltat is (D54)', async () => {
    const id = standardSpace();
    const doc = newDoc(id, anna.userId);
    const archived = newDoc(id, anna.userId, { deleted: true, everApproved: true });
    expect((await put(mgr, doc, bela.userId)).statusCode).toBe(204);
    expect((await put(mgr, archived, bela.userId)).statusCode).toBe(204);
  });

  it('a nem tulajdonos Szerző 403 forbidden; a nem tag 403 not_space_member (a Rendszeradmin is)', async () => {
    const id = standardSpace();
    const doc = newDoc(id, anna.userId);
    expectProblem(await put(bela, doc, bela.userId), 403, 'forbidden');
    const denied = await put(out, doc, bela.userId);
    expectProblem(denied, 403, 'not_space_member');
    expect(problem(denied).details).toMatchObject({ space: { id } });
    expectProblem(await put(admin, doc, bela.userId), 403, 'not_space_member');
  });

  it('422 invalid_new_owner: nem aktív tag, azonos a mostanival', async () => {
    const id = standardSpace();
    const doc = newDoc(id, anna.userId);
    expectProblem(await put(anna, doc, out.userId), 422, 'invalid_new_owner');
    expectProblem(await put(anna, doc, anna.userId), 422, 'invalid_new_owner');
    ctx.collab.access.addMember(id, bela.userId, 'author', true);
    expectProblem(await put(anna, doc, bela.userId), 422, 'invalid_new_owner');
  });

  it('lezárt projekt-térben 403 space_closed', async () => {
    const id = standardSpace({ closed: true });
    const doc = newDoc(id, anna.userId);
    expectProblem(await put(anna, doc, bela.userId), 403, 'space_closed');
    expectProblem(await put(mgr, doc, bela.userId), 403, 'space_closed');
  });
});
