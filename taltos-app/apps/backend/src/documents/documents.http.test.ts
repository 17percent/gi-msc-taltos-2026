import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentDetail, ProblemDetails } from '@taltos/shared';
import { createTestApp, TEST_ORIGIN, type TestContext, type TestSession } from '../testing/app.js';

/**
 * A WP5a dokumentum-végpontok HTTP-tesztjei a memóriabeli adapterekkel (a tényleges SQL-t, a zárakat és az atomicitást
 * a PostgreSQL elleni integrációs tesztek bizonyítják). Végpontonként: siker, 401, 400, 403 (`forbidden`,
 * `not_space_member`, `space_closed`), 404 és a 409-esek.
 */
let ctx: TestContext;
let alice: TestSession; // a tér Szerzője
let mgr: TestSession; // Színtérgazda
let bob: TestSession; // Szerző, nem tulajdonos
let out: TestSession; // nem tag
let space: string;

beforeEach(async () => {
  ctx = await createTestApp();
  alice = await ctx.signIn('alice@example.test');
  mgr = await ctx.signIn('mgr@example.test');
  bob = await ctx.signIn('bob@example.test');
  out = await ctx.signIn('out@example.test');
  space = newSpace();
  ctx.collab.addMember(space, alice.userId);
  ctx.collab.addMember(space, bob.userId);
  ctx.collab.addMember(space, mgr.userId, false, 'space_manager');
});

afterEach(async () => {
  await ctx.app.close();
});

function newSpace(closed = false): string {
  const id = randomUUID();
  ctx.collab.addSpace(id, { closed });
  return id;
}

const call = (session: TestSession | undefined, method: string, url: string, payload?: object) =>
  ctx.app.inject({
    method: method as 'GET',
    url: `/api/v1${url}`,
    headers: session?.headers ?? { origin: TEST_ORIGIN },
    ...(payload === undefined ? {} : { payload }),
  });

const problem = (res: LightMyRequestResponse) => res.json<ProblemDetails>();
const expectProblem = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(problem(res).code).toBe(code);
};
const events = (type: string) => ctx.documents.events.filter((e) => e.type === type);

async function create(session: TestSession, payload: object): Promise<DocumentDetail> {
  const res = await call(session, 'POST', '/documents', payload);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<DocumentDetail>();
}

/** Egy a világba felvett dokumentum (nem a végponton át), az élő tartalommal. */
function seeded(spaceId: string, ownerId: string, content = 'élő', title = 'Titkos forrás cím') {
  const id = randomUUID();
  ctx.collab.addDocument(id, spaceId, { content });
  const doc = ctx.collab.access.documents.get(id);
  if (doc) doc.ownerId = ownerId;
  ctx.documents.seed(id, { title });
  return id;
}

describe('POST /documents', () => {
  it('üres létrehozás: 201, Piszkozat, a létrehozó a tulajdonos, első revízió, created esemény', async () => {
    const detail = await create(alice, { spaceId: space, title: '  Új prompt  ', kind: 'prompt' });
    expect(detail).toMatchObject({
      spaceId: space,
      title: 'Új prompt',
      slug: 'uj-prompt',
      kind: 'prompt',
      reviewState: 'draft',
      approvedRevisionId: null,
      iteration: 0,
      archived: false,
      tags: [],
      approvedMetadata: null,
    });
    expect(detail.owner.id).toBe(alice.userId);
    expect(ctx.documents.revisions.filter((r) => r.documentId === detail.id)).toHaveLength(1);
    expect(events('created')).toHaveLength(1);
    expect(ctx.collab.document(detail.id)?.content).toBe('');
  });

  it('címkékkel: a tagIds bekerül a válaszba és a pillanatképbe', async () => {
    const tag = ctx.tags.addTag('címke');
    const detail = await create(alice, {
      spaceId: space,
      title: 'C',
      kind: 'prompt',
      tagIds: [tag.id],
    });
    expect(detail.tags).toEqual([{ id: tag.id, name: 'címke' }]);
    expect(ctx.documents.revisions[0]?.metadata.tagIds).toEqual([tag.id]);
  });

  it('munkamenet nélkül 401', async () => {
    expectProblem(
      await call(undefined, 'POST', '/documents', { spaceId: space, title: 'x', kind: 'prompt' }),
      401,
      'unauthenticated',
    );
  });

  it.each([
    ['kind nélkül', { title: 'x' }],
    ['üres cím', { title: '', kind: 'prompt' }],
    ['csak szóköz cím', { title: '   ', kind: 'prompt' }],
    ['túl hosszú cím', { title: 'x'.repeat(201), kind: 'prompt' }],
    ['rossz tagId', { title: 'x', kind: 'prompt', tagIds: ['nem-uuid'] }],
    [
      'ismétlődő tagId',
      { title: 'x', kind: 'prompt', tagIds: [randomUUID(), randomUUID()].fill(randomUUID()) },
    ],
  ])('séma: %s → 400 validation_error', async (_name, body) => {
    expectProblem(
      await call(alice, 'POST', '/documents', { spaceId: space, ...body }),
      400,
      'validation_error',
    );
  });

  it('ismeretlen vagy törölt fajta, ismeretlen címke: 400 validation_error, nyom nélkül', async () => {
    ctx.tags.deleteKind('skill');
    for (const body of [
      { kind: 'nincs-ilyen' },
      { kind: 'skill' },
      { kind: 'prompt', tagIds: [randomUUID()] },
    ]) {
      expectProblem(
        await call(alice, 'POST', '/documents', { spaceId: space, title: 'x', ...body }),
        400,
        'validation_error',
      );
    }
    expect(ctx.documents.records.size).toBe(0);
  });

  it('nem tag a célszínterében: 403 not_space_member a színtér nevével, a Rendszeradmin is', async () => {
    const admin = await ctx.signIn('admin@example.test', 'system_admin');
    for (const session of [out, admin]) {
      const res = await call(session, 'POST', '/documents', {
        spaceId: space,
        title: 'x',
        kind: 'prompt',
      });
      expectProblem(res, 403, 'not_space_member');
      expect(problem(res).details).toMatchObject({ space: { id: space } });
    }
    expect(ctx.documents.records.size).toBe(0);
  });

  it('lezárt térben 403 space_closed; nem létező tér 404', async () => {
    const closed = newSpace(true);
    ctx.collab.addMember(closed, alice.userId);
    expectProblem(
      await call(alice, 'POST', '/documents', { spaceId: closed, title: 'x', kind: 'prompt' }),
      403,
      'space_closed',
    );
    expectProblem(
      await call(alice, 'POST', '/documents', {
        spaceId: randomUUID(),
        title: 'x',
        kind: 'prompt',
      }),
      404,
      'not_found',
    );
  });

  describe('duplikálás', () => {
    it('a Jóváhagyott revízió tartalmát másolja eltérő élő tartalom mellett, külön színtérbe is', async () => {
      const other = newSpace();
      ctx.collab.addMember(other, alice.userId);
      const source = seeded(other, alice.userId, 'ÉLŐ módosítás');
      ctx.documents.seed(source, { title: 'Forrás', approved: { content: 'jóváhagyott szöveg' } });
      const copy = await create(alice, {
        spaceId: space,
        title: 'Másolat',
        kind: 'prompt',
        sourceDocumentId: source,
      });
      expect(ctx.collab.document(copy.id)?.content).toBe('jóváhagyott szöveg');
      expect(ctx.documents.links).toMatchObject([
        { fromId: copy.id, toId: source, type: 'szarmazik' },
      ]);
      expect(ctx.documents.revisions.at(-1)?.metadata.links).toEqual([
        { toId: source, type: 'szarmazik', anchor: null },
      ]);
      expect(events('duplicated_from')).toHaveLength(2);
    });

    it('Jóváhagyott revízió nélkül az élő tartalmat másolja', async () => {
      const source = seeded(space, bob.userId, 'élő szöveg');
      const copy = await create(alice, {
        spaceId: space,
        title: 'Másolat',
        kind: 'prompt',
        sourceDocumentId: source,
      });
      expect(ctx.collab.document(copy.id)?.content).toBe('élő szöveg');
    });

    it('nem tag színtérbe 403 not_space_member (a forrás tagja is)', async () => {
      const foreign = newSpace();
      ctx.collab.addMember(foreign, out.userId);
      const source = seeded(space, alice.userId);
      expectProblem(
        await call(alice, 'POST', '/documents', {
          spaceId: foreign,
          title: 'x',
          kind: 'prompt',
          sourceDocumentId: source,
        }),
        403,
        'not_space_member',
      );
    });

    it('nem tag forrásból 403 not_space_member, a forrás címe nélkül; nem létező forrás 404', async () => {
      const foreign = newSpace();
      ctx.collab.addMember(foreign, out.userId);
      const source = seeded(foreign, out.userId, 'titok', 'Titkos forrás cím');
      const res = await call(alice, 'POST', '/documents', {
        spaceId: space,
        title: 'x',
        kind: 'prompt',
        sourceDocumentId: source,
      });
      expectProblem(res, 403, 'not_space_member');
      expect(res.body).not.toMatch(/Titkos forrás cím|titok/);
      expectProblem(
        await call(alice, 'POST', '/documents', {
          spaceId: space,
          title: 'x',
          kind: 'prompt',
          sourceDocumentId: randomUUID(),
        }),
        404,
        'not_found',
      );
      expect(ctx.documents.records.has(source)).toBe(true);
      expect(events('duplicated_from')).toHaveLength(0);
    });

    it('eldobott forrás 404; archivált forrás duplikálható', async () => {
      const dropped = seeded(space, alice.userId);
      ctx.collab.markDeleted(dropped);
      expectProblem(
        await call(alice, 'POST', '/documents', {
          spaceId: space,
          title: 'x',
          kind: 'prompt',
          sourceDocumentId: dropped,
        }),
        404,
        'not_found',
      );
      const archived = seeded(space, alice.userId, 'élő');
      ctx.documents.seed(archived, { approved: { content: 'archivált' } });
      ctx.collab.markDeleted(archived);
      const copy = await create(alice, {
        spaceId: space,
        title: 'x',
        kind: 'prompt',
        sourceDocumentId: archived,
      });
      expect(ctx.collab.document(copy.id)?.content).toBe('archivált');
    });
  });
});

describe('GET /documents/:id', () => {
  it('a tag látja az élő metaadatot; 401; nem tag 403 cím nélkül; hiányzó 404', async () => {
    const doc = await create(alice, { spaceId: space, title: 'Látható cím', kind: 'prompt' });
    const ok = await call(bob, 'GET', `/documents/${doc.id}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<DocumentDetail>()).toMatchObject({ id: doc.id, title: 'Látható cím' });
    expectProblem(await call(undefined, 'GET', `/documents/${doc.id}`), 401, 'unauthenticated');
    const denied = await call(out, 'GET', `/documents/${doc.id}`);
    expectProblem(denied, 403, 'not_space_member');
    expect(denied.body).not.toContain('Látható cím');
    expectProblem(await call(bob, 'GET', `/documents/${randomUUID()}`), 404, 'not_found');
    expectProblem(await call(bob, 'GET', '/documents/nem-uuid'), 400, 'validation_error');
  });

  it('az approvedMetadata a Jóváhagyott revízió pillanatképe, vagy null', async () => {
    const id = seeded(space, alice.userId);
    const tag = ctx.tags.addTag('régi');
    ctx.documents.seed(id, {
      title: 'Élő',
      approved: { title: 'Jóváhagyott', content: 'x', tagIds: [tag.id] },
    });
    const body = (await call(alice, 'GET', `/documents/${id}`)).json<DocumentDetail>();
    expect(body.approvedMetadata).toMatchObject({
      title: 'Jóváhagyott',
      kind: 'prompt',
      tags: [{ id: tag.id, name: 'régi' }],
    });
    const fresh = await create(alice, { spaceId: space, title: 'Friss', kind: 'prompt' });
    expect(
      (await call(alice, 'GET', `/documents/${fresh.id}`)).json<DocumentDetail>().approvedMetadata,
    ).toBeNull();
  });
});

describe('DELETE /documents/:id/draft', () => {
  it('a tulajdonos eldobja: 204, utána 404, draft_discarded esemény', async () => {
    const doc = await create(alice, { spaceId: space, title: 'Eldobandó', kind: 'prompt' });
    expect((await call(alice, 'DELETE', `/documents/${doc.id}/draft`)).statusCode).toBe(204);
    expectProblem(await call(alice, 'GET', `/documents/${doc.id}`), 404, 'not_found');
    expectProblem(await call(alice, 'DELETE', `/documents/${doc.id}/draft`), 404, 'not_found');
    expect(events('draft_discarded')).toHaveLength(1);
  });

  it('nem tulajdonos Szerzőnek 403 forbidden; a Színtérgazdának engedett; nem tagnak 403 not_space_member', async () => {
    const doc = await create(alice, { spaceId: space, title: 'Védett', kind: 'prompt' });
    expectProblem(await call(bob, 'DELETE', `/documents/${doc.id}/draft`), 403, 'forbidden');
    expectProblem(await call(out, 'DELETE', `/documents/${doc.id}/draft`), 403, 'not_space_member');
    expectProblem(
      await call(undefined, 'DELETE', `/documents/${doc.id}/draft`),
      401,
      'unauthenticated',
    );
    expect((await call(mgr, 'DELETE', `/documents/${doc.id}/draft`)).statusCode).toBe(204);
  });

  it('lezárt térben 403 space_closed', async () => {
    const closed = newSpace(true);
    ctx.collab.addMember(closed, alice.userId);
    const id = seeded(closed, alice.userId);
    expectProblem(await call(alice, 'DELETE', `/documents/${id}/draft`), 403, 'space_closed');
  });

  it('409: függő kérésnél request_pending; Jóváhagyott revíziónál és lezárt kérésnél has_approved_revision', async () => {
    const pending = seeded(space, alice.userId);
    ctx.collab.access.documents.get(pending)!.pending = {
      initiatorId: alice.userId,
      reviewers: [],
    };
    ctx.collab.setReviewState(pending, 'pending');
    const approved = seeded(space, alice.userId);
    ctx.documents.seed(approved, { approved: { content: 'x' } });
    const rejected = seeded(space, alice.userId);
    ctx.documents.seed(rejected, { hasRequest: true });
    ctx.collab.setReviewState(rejected, 'changes_requested');
    expectProblem(
      await call(alice, 'DELETE', `/documents/${pending}/draft`),
      409,
      'request_pending',
    );
    expectProblem(
      await call(alice, 'DELETE', `/documents/${approved}/draft`),
      409,
      'has_approved_revision',
    );
    expectProblem(
      await call(alice, 'DELETE', `/documents/${rejected}/draft`),
      409,
      'has_approved_revision',
    );
  });
});
