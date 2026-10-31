import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  MembershipDecisionResult,
  ProblemDetails,
  RequestCreated,
  SpaceDetail,
  SpaceMember,
  SpaceRequestDecisionResult,
} from '@taltos/shared';
import { createTestApp, TEST_ORIGIN, type TestContext, type TestSession } from '../testing/app.js';

/**
 * A WP4a S5 végpontok (felvételi és projekt-tér kérés + döntés) HTTP-tesztjei a memóriabeli adapterekkel. A tényleges
 * SQL-t, a zárakat, az egyedi indexet és a tranzakciós atomicitást a PostgreSQL elleni szerződés-teszt
 * (`space-store.int.test.ts`) bizonyítja.
 */
let ctx: TestContext;
let admin: TestSession;
let mgr: TestSession;
let anna: TestSession;
let out: TestSession;
let out2: TestSession;

beforeEach(async () => {
  ctx = await createTestApp();
  admin = await ctx.signIn('admin@example.test', 'system_admin');
  mgr = await ctx.signIn('mgr@example.test');
  anna = await ctx.signIn('anna@example.test');
  out = await ctx.signIn('out@example.test');
  out2 = await ctx.signIn('out2@example.test');
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
const events = (type: string) => ctx.spaces.events.filter((e) => e.type === type);

function newSpace(options: { closed?: boolean } = {}): string {
  const id = randomUUID();
  ctx.collab.access.addSpace(id, `tér-${id}`, {
    type: options.closed ? 'project' : 'team',
    closed: options.closed ?? false,
  });
  ctx.collab.access.addMember(id, mgr.userId, 'space_manager');
  ctx.collab.access.addMember(id, anna.userId, 'author');
  return id;
}

const isMember = (spaceId: string, session: TestSession) => {
  const m = ctx.collab.access.members.get(`${spaceId}:${session.userId}`);
  return m !== undefined && !m.removed;
};

describe('POST /spaces/:id/membership-requests', () => {
  it('401 munkamenet nélkül, 400 érvénytelen törzs, 404 ismeretlen tér', async () => {
    const space = newSpace();
    expect((await call(undefined, 'POST', `/spaces/${space}/membership-requests`, {})).statusCode).toBe(
      401,
    );
    expectProblem(
      await call(out, 'POST', `/spaces/${space}/membership-requests`, { viaDocumentId: 'nem-uuid' }),
      400,
      'validation_error',
    );
    expectProblem(
      await call(out, 'POST', `/spaces/${randomUUID()}/membership-requests`, {}),
      404,
      'not_found',
    );
  });

  it('201: függő kérés, membership_requested esemény (viaDocumentId azonosítóként, üzenet és cím nélkül)', async () => {
    const space = newSpace();
    const via = randomUUID();
    const res = await call(out, 'POST', `/spaces/${space}/membership-requests`, {
      viaDocumentId: via,
      message: 'Szeretnék csatlakozni',
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json<RequestCreated>();
    expect(created.state).toBe('pending');
    expect(events('membership_requested')).toEqual([
      {
        type: 'membership_requested',
        spaceId: space,
        actorId: out.userId,
        details: { requestId: created.id, viaDocumentId: via },
      },
    ]);
    expect(JSON.stringify(ctx.spaces.events)).not.toContain('csatlakozni');
  });

  it('403 forbidden: a tag nem kérhet, a nem tag Rendszeradmin sem (önfelvétel)', async () => {
    const space = newSpace();
    expectProblem(
      await call(anna, 'POST', `/spaces/${space}/membership-requests`, {}),
      403,
      'forbidden',
    );
    expectProblem(
      await call(admin, 'POST', `/spaces/${space}/membership-requests`, {}),
      403,
      'forbidden',
    );
    expect(ctx.spaces.membershipRequests.size).toBe(0);
  });

  it('409 request_pending: a második kérés ugyanabba a térbe', async () => {
    const space = newSpace();
    expect((await call(out, 'POST', `/spaces/${space}/membership-requests`, {})).statusCode).toBe(
      201,
    );
    expectProblem(
      await call(out, 'POST', `/spaces/${space}/membership-requests`, {}),
      409,
      'request_pending',
    );
    expect(events('membership_requested')).toHaveLength(1);
    // másik felhasználó kérhet
    expect((await call(out2, 'POST', `/spaces/${space}/membership-requests`, {})).statusCode).toBe(
      201,
    );
  });

  it('403 space_closed: lezárt projekt-térbe nincs új kérés', async () => {
    const space = newSpace({ closed: true });
    expectProblem(
      await call(out, 'POST', `/spaces/${space}/membership-requests`, {}),
      403,
      'space_closed',
    );
  });
});

describe('POST /membership-requests/:id/decision', () => {
  async function pending(space: string, who: TestSession = out): Promise<string> {
    const res = await call(who, 'POST', `/spaces/${space}/membership-requests`, {});
    expect(res.statusCode, res.body).toBe(201);
    return res.json<RequestCreated>().id;
  }

  it('401 / 404 / 400', async () => {
    const id = await pending(newSpace());
    expect((await call(undefined, 'POST', `/membership-requests/${id}/decision`, { approve: true })).statusCode).toBe(401);
    expectProblem(
      await call(mgr, 'POST', `/membership-requests/${randomUUID()}/decision`, { approve: true }),
      404,
      'not_found',
    );
    expectProblem(await call(mgr, 'POST', `/membership-requests/${id}/decision`, {}), 400, 'validation_error');
    expectProblem(
      await call(mgr, 'POST', `/membership-requests/${id}/decision`, { approve: true, role: 'owner' }),
      400,
      'validation_error',
    );
    expectProblem(
      await call(mgr, 'POST', `/membership-requests/${id}/decision`, { approve: false, role: 'author' }),
      400,
      'validation_error',
    );
  });

  it('403: nem tag (not_space_member) és sima szerző (forbidden) nem dönthet; a kérés függő marad', async () => {
    const space = newSpace();
    const id = await pending(space);
    expectProblem(
      await call(out2, 'POST', `/membership-requests/${id}/decision`, { approve: true }),
      403,
      'not_space_member',
    );
    expectProblem(
      await call(anna, 'POST', `/membership-requests/${id}/decision`, { approve: true }),
      403,
      'forbidden',
    );
    expect(ctx.spaces.membershipRequests.get(id)?.state).toBe('pending');
    expect(isMember(space, out)).toBe(false);
  });

  it('a Színtérgazda jóváhagyja: alapból Szerző, member_added + membership_request_decided esemény', async () => {
    const space = newSpace();
    const id = await pending(space);
    const res = await call(mgr, 'POST', `/membership-requests/${id}/decision`, { approve: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<MembershipDecisionResult>()).toEqual({
      id,
      state: 'approved',
      spaceId: space,
      role: 'author',
    });
    expect(isMember(space, out)).toBe(true);
    expect(events('member_added')).toEqual([
      {
        type: 'member_added',
        spaceId: space,
        actorId: mgr.userId,
        details: { userId: out.userId, role: 'author' },
      },
    ]);
    expect(events('membership_request_decided')).toEqual([
      {
        type: 'membership_request_decided',
        spaceId: space,
        actorId: mgr.userId,
        details: { requestId: id, approved: true, role: 'author' },
      },
    ]);
    const members = (await call(mgr, 'GET', `/spaces/${space}/members`)).json<SpaceMember[]>();
    expect(members.find((m) => m.user.id === out.userId)?.role).toBe('author');
  });

  it('a megadott szerep érvényesül (Színtérgazda)', async () => {
    const space = newSpace();
    const id = await pending(space);
    const res = await call(mgr, 'POST', `/membership-requests/${id}/decision`, {
      approve: true,
      role: 'space_manager',
    });
    expect(res.json<MembershipDecisionResult>().role).toBe('space_manager');
    expect(ctx.collab.access.members.get(`${space}:${out.userId}`)?.role).toBe('space_manager');
  });

  it('elutasítás: nem lesz tag, nincs member_added, a döntés naplózva; utána újra kérhet', async () => {
    const space = newSpace();
    const id = await pending(space);
    const res = await call(mgr, 'POST', `/membership-requests/${id}/decision`, { approve: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<MembershipDecisionResult>()).toEqual({ id, state: 'rejected', spaceId: space });
    expect(isMember(space, out)).toBe(false);
    expect(events('member_added')).toHaveLength(0);
    expect(events('membership_request_decided')[0]?.details).toEqual({
      requestId: id,
      approved: false,
    });
    await pending(space);
  });

  it('a Rendszeradmin is dönthet (nem tag)', async () => {
    const space = newSpace();
    const id = await pending(space);
    const res = await call(admin, 'POST', `/membership-requests/${id}/decision`, { approve: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(isMember(space, out)).toBe(true);
  });

  it('409 request_closed: a már eldöntött kérés nem dönthető újra', async () => {
    const space = newSpace();
    const id = await pending(space);
    await call(mgr, 'POST', `/membership-requests/${id}/decision`, { approve: false });
    expectProblem(
      await call(mgr, 'POST', `/membership-requests/${id}/decision`, { approve: true }),
      409,
      'request_closed',
    );
    expect(isMember(space, out)).toBe(false);
  });

  it('lezárt térben a függő kérésről csak a Rendszeradmin dönthet (a gazda: space_closed)', async () => {
    const space = newSpace();
    const id = await pending(space);
    ctx.collab.access.updateSpace(space, { type: 'project', closed: true });
    expectProblem(
      await call(mgr, 'POST', `/membership-requests/${id}/decision`, { approve: true }),
      403,
      'space_closed',
    );
    expect(ctx.spaces.membershipRequests.get(id)?.state).toBe('pending');
    const res = await call(admin, 'POST', `/membership-requests/${id}/decision`, { approve: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(isMember(space, out)).toBe(true);
  });
});

describe('POST /space-requests', () => {
  const body = (proposedManagerId: string, extra: object = {}) => ({
    name: 'Projekt Hold',
    purpose: 'Az új hold-projekt tudásbázisa',
    proposedManagerId,
    ...extra,
  });

  it('401 / 400', async () => {
    expect((await call(undefined, 'POST', '/space-requests', body(mgr.userId))).statusCode).toBe(401);
    expectProblem(await call(out, 'POST', '/space-requests', { name: 'x' }), 400, 'validation_error');
    expectProblem(
      await call(out, 'POST', '/space-requests', body(mgr.userId, { name: '   ' })),
      400,
      'validation_error',
    );
  });

  it('400: ismeretlen javasolt gazda', async () => {
    expectProblem(
      await call(out, 'POST', '/space-requests', body(randomUUID())),
      400,
      'validation_error',
    );
  });

  it('201: bármely belépett felhasználó, a Rendszeradmin is; space_requested esemény személyes adat nélkül', async () => {
    for (const who of [out, admin]) {
      const res = await call(who, 'POST', '/space-requests', body(mgr.userId, { name: who.userId }));
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json<RequestCreated>().state).toBe('pending');
    }
    expect(events('space_requested')).toHaveLength(2);
    expect(JSON.stringify(ctx.spaces.events)).not.toMatch(/Projekt Hold|hold-projekt/);
  });
});

describe('POST /space-requests/:id/decision', () => {
  async function request(name = 'Projekt Hold'): Promise<string> {
    const res = await call(out, 'POST', '/space-requests', {
      name,
      purpose: 'Cél',
      proposedManagerId: mgr.userId,
    });
    return res.json<RequestCreated>().id;
  }
  const palette = '#2E8B6F';

  it('401 / 403 / 404', async () => {
    const id = await request();
    expect(
      (await call(undefined, 'POST', `/space-requests/${id}/decision`, { approve: false })).statusCode,
    ).toBe(401);
    expectProblem(
      await call(out, 'POST', `/space-requests/${id}/decision`, { approve: false }),
      403,
      'forbidden',
    );
    expectProblem(
      await call(mgr, 'POST', `/space-requests/${id}/decision`, { approve: false }),
      403,
      'forbidden',
    );
    expectProblem(
      await call(admin, 'POST', `/space-requests/${randomUUID()}/decision`, { approve: false }),
      404,
      'not_found',
    );
  });

  it('400: jóváhagyás szín nélkül, a palettán kívüli szín, elutasítás színnel; a kérés függő marad', async () => {
    const id = await request();
    for (const bad of [{ approve: true }, { approve: true, color: '#000000' }, { approve: false, color: palette }, {}]) {
      expectProblem(
        await call(admin, 'POST', `/space-requests/${id}/decision`, bad),
        400,
        'validation_error',
      );
    }
    expect(ctx.spaces.spaceRequests.get(id)?.state).toBe('pending');
    expect(events('space_created')).toHaveLength(0);
  });

  it('jóváhagyás: project típusú tér, a cél a leírás, a javasolt gazda a Színtérgazda; események egy lépésben', async () => {
    const id = await request();
    const res = await call(admin, 'POST', `/space-requests/${id}/decision`, {
      approve: true,
      color: palette,
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json<SpaceRequestDecisionResult>();
    expect(result).toMatchObject({ id, state: 'approved' });
    const space = (await call(admin, 'GET', `/spaces/${result.spaceId}`)).json<SpaceDetail>();
    expect(space).toMatchObject({
      name: 'Projekt Hold',
      type: 'project',
      description: 'Cél',
      color: palette,
      closed: false,
      memberCount: 1,
    });
    expect(space.managers.map((m) => m.id)).toEqual([mgr.userId]);
    expect(ctx.spaces.events.map((e) => e.type)).toEqual([
      'space_requested',
      'space_created',
      'space_manager_assigned',
      'space_request_decided',
    ]);
    expect(events('space_request_decided')[0]?.details).toEqual({
      requestId: id,
      approved: true,
      spaceId: result.spaceId,
    });
    expect(events('space_created')[0]?.details).toEqual({
      type: 'project',
      initialManagerId: mgr.userId,
    });
  });

  it('elutasítás: nincs tér, a döntés naplózva, indoklás nélkül', async () => {
    const id = await request();
    const res = await call(admin, 'POST', `/space-requests/${id}/decision`, { approve: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<SpaceRequestDecisionResult>()).toEqual({ id, state: 'rejected' });
    expect(events('space_created')).toHaveLength(0);
    expect(events('space_request_decided')[0]?.details).toEqual({ requestId: id, approved: false });
  });

  it('409 request_closed: az eldöntött kérés nem dönthető újra, és nem jön létre második tér', async () => {
    const id = await request();
    await call(admin, 'POST', `/space-requests/${id}/decision`, { approve: true, color: palette });
    expectProblem(
      await call(admin, 'POST', `/space-requests/${id}/decision`, { approve: true, color: palette }),
      409,
      'request_closed',
    );
    expect(events('space_created')).toHaveLength(1);
  });

  it('atomi: foglalt névnél 400, semmi nem íródik, a kérés függő marad és elutasítható', async () => {
    const id = await request('Foglalt');
    ctx.collab.access.addSpace(randomUUID(), 'foglalt'); // kis-nagybetűtől független névütközés
    const before = ctx.spaces.events.length;
    expectProblem(
      await call(admin, 'POST', `/space-requests/${id}/decision`, { approve: true, color: palette }),
      400,
      'validation_error',
    );
    expect(ctx.spaces.events).toHaveLength(before);
    expect(ctx.spaces.spaceRequests.get(id)?.state).toBe('pending');
    expect(
      (await call(admin, 'POST', `/space-requests/${id}/decision`, { approve: false })).statusCode,
    ).toBe(200);
  });

  it('atomi: a javasolt gazda közben kikerült az allowlistről: 400, a kérés függő marad', async () => {
    const id = await request();
    ctx.store.allowlist.delete('mgr@example.test');
    expectProblem(
      await call(admin, 'POST', `/space-requests/${id}/decision`, { approve: true, color: palette }),
      400,
      'validation_error',
    );
    expect(ctx.spaces.spaceRequests.get(id)?.state).toBe('pending');
    expect(events('space_created')).toHaveLength(0);
  });
});
