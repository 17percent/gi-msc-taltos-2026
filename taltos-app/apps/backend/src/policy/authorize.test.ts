import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerProblemHandlers } from '../http/problem.js';
import type { AuthSession } from '../auth/session-service.js';
import { MemoryAccessStore } from '../testing/memory-access-store.js';
import { authorizeDocument, authorizeSpace, authorizeSystem } from './authorize.js';
import { seedMemory } from '../testing/access-fixture.js';
import type { ContractIds } from './access-store-contract.js';

/**
 * A segédek tesztje auth-kapu nélküli mini-alkalmazáson: a „munkamenetet” a fejlécek adják
 * (`x-user`, `x-admin`), a kezelők a visszaadott célpontot használják (nincs második lekérdezés).
 */
describe('authorize* útvonal-segédek', () => {
  let app: FastifyInstance;
  let store: MemoryAccessStore;
  let ids: ContractIds;

  beforeEach(async () => {
    ({ store, ids } = seedMemory());
    app = Fastify();
    registerProblemHandlers(app);
    app.decorateRequest('auth', null);
    app.addHook('onRequest', (request, _reply, done) => {
      const userId = request.headers['x-user'] as string;
      request.auth = {
        userId,
        systemRole: request.headers['x-admin'] === '1' ? 'system_admin' : 'user',
      } as AuthSession;
      done();
    });
    app.get<{ Params: { id: string } }>('/spaces/:id', async (request, reply) => {
      const target = await authorizeSpace(store, request, reply, 'space.view', request.params.id);
      return target === undefined ? reply : { membership: target.membership };
    });
    app.get<{ Params: { id: string } }>('/documents/:id', async (request, reply) => {
      const target = await authorizeDocument(
        store,
        request,
        reply,
        'document.read',
        request.params.id,
      );
      return target === undefined ? reply : { ownerId: target.ownerId };
    });
    app.get('/admin/users', async (request, reply) => {
      return (await authorizeSystem(request, reply, 'system.users.view')) ? { ok: true } : reply;
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (url: string, user: string, admin = false) =>
    app.inject({
      method: 'GET',
      url,
      headers: { 'x-user': user, ...(admin ? { 'x-admin': '1' } : {}) },
    });

  it('tag: 200, és a betöltött célpontot kapja a kezelő; denialDetails nem hívódik', async () => {
    const res = await get(`/spaces/${ids.space}`, ids.author);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ membership: 'author' });
    expect(store.calls).toEqual({ spaceTarget: 1, documentTarget: 0, denialDetails: 0 });
  });

  it('nem tag: 403 not_space_member a színtér nevével és gazdáival, cím és darabszám nélkül', async () => {
    const res = await get(`/documents/${ids.doc}`, ids.outsider);
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json();
    expect(body).toMatchObject({
      status: 403,
      code: 'not_space_member',
      details: {
        space: { id: ids.space, name: 'Adatplatform' },
        managers: [{ id: ids.manager, displayName: 'Kiss Anna' }],
        canRequestMembership: true,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/"title":"Teszt|count|memberCount/i);
    expect(store.calls.denialDetails).toBe(1);
  });

  it('nem tag Rendszeradmin dokumentumra: not_space_member, canRequestMembership false (önfelvétel)', async () => {
    const res = await get(`/documents/${ids.doc}`, ids.admin, true);
    expect(res.statusCode).toBe(403);
    expect(res.json().details.canRequestMembership).toBe(false);
  });

  it('nem tag Rendszeradmin a színtér adatait látja (kivétel)', async () => {
    const res = await get(`/spaces/${ids.space}`, ids.admin, true);
    expect(res.statusCode).toBe(200);
  });

  it('nem létező és törölt célpont: 404 not_found, a nem tagnak sem szivárog létezés-különbség', async () => {
    for (const id of [ids.missing, ids.deletedSpace]) {
      const res = await get(`/spaces/${id}`, ids.outsider);
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('not_found');
    }
    for (const id of [ids.missing, ids.droppedDraft, ids.docInDeletedSpace]) {
      expect((await get(`/documents/${id}`, ids.outsider)).statusCode).toBe(404);
    }
    expect(store.calls.denialDetails).toBe(0);
  });

  it('rendszerszintű művelet: nem admin 403 forbidden, admin 200; nincs betöltés', async () => {
    const denied = await get('/admin/users', ids.author);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('forbidden');
    expect((await get('/admin/users', ids.admin, true)).statusCode).toBe(200);
    expect(store.calls).toEqual({ spaceTarget: 0, documentTarget: 0, denialDetails: 0 });
  });
});
