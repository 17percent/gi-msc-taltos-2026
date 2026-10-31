import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { MeResponse, ProblemDetails, SpaceSummary, UserRef } from '@taltos/shared';
import type { TestContext, TestSession } from '../testing/app.js';
import { can } from './policy.js';
import type { DocumentTarget } from './targets.js';

/**
 * Láthatósági esetek: minden `/api/v1` GET végponthoz tartozik egy eset, amely bizonyítja, hogy a nem jogosult nem
 * lát adatot (D44). A `read-endpoints.test.ts` az útvonal-leltárat ezzel veti össze: új olvasó végpont eset nélkül
 * piros. Az új csomagok ide veszik fel a saját végpontjuk esetét.
 *
 * `how` jelöli az elvet: `self_only` (csak a hívó saját adatát adja), `can_guard` (az `authorize*` segéden át, a
 * célponton), `visible_builder` (a `visibleDocumentsWhere` / `visibleSpacesWhere` feltételén át), `admin_only`
 * (rendszerszintű művelet a `can()`-en át).
 */
export interface VisibilityCase {
  how: 'self_only' | 'can_guard' | 'visible_builder' | 'admin_only';
  /** Futtatható bizonyíték: a nem jogosult hívó nem kap adatot. */
  run(ctx: TestContext): Promise<void>;
}

const get = (ctx: TestContext, url: string, session: Pick<TestSession, 'cookie'>) =>
  ctx.app.inject({ method: 'GET', url, headers: { cookie: session.cookie } });

/** Egy tér (alice tag, bob nem tag) és egy Rendszeradmin; az e-mailek a `tag`-gel egyediek (a ctx megosztott). */
async function spaceFixture(ctx: TestContext, tag: string) {
  const alice = await ctx.signIn(`alice-${tag}@example.test`);
  const bob = await ctx.signIn(`bob-${tag}@example.test`);
  const admin = await ctx.signIn(`admin-${tag}@example.test`, 'system_admin');
  const spaceId = randomUUID();
  ctx.collab.addSpace(spaceId);
  ctx.collab.addMember(spaceId, alice.userId, false, 'space_manager');
  return { alice, bob, admin, spaceId };
}

export const VISIBILITY_CASES: Record<string, VisibilityCase> = {
  // A /collab (WebSocket, GET upgrade) a dokumentum tartalmát adja: az onAuthenticate az AccessStore + can()
  // döntésére épül, minden elutasítás bájtra azonos. A kapcsolat szintű bizonyíték: realtime/collab.test.ts
  // („nem tag”, „nem tag Rendszeradmin”, azonos elutasítás); itt a döntés bemenete: a nem tag semmit nem olvashat.
  'GET /collab': {
    how: 'can_guard',
    async run(ctx) {
      ctx.collab.addSpace('s-collab');
      ctx.collab.addMember('s-collab', 'member');
      ctx.collab.addDocument('d-collab', 's-collab');
      for (const systemRole of ['user', 'system_admin'] as const) {
        const target = await ctx.collab.access.documentTarget('outsider', 'd-collab');
        expect(target?.space.membership).toBeNull();
        const actor = { userId: 'outsider', systemRole };
        expect(can(actor, 'document.read', target as DocumentTarget).ok).toBe(false);
        expect(can(actor, 'document.edit', target as DocumentTarget).ok).toBe(false);
      }
    },
  },

  // A saját színterek: a nem tag semmit nem lát, a Rendszeradmin csak metaadatot (tartalom nélkül) kap mindről.
  'GET /api/v1/spaces': {
    how: 'visible_builder',
    async run(ctx) {
      const { alice, bob, admin, spaceId } = await spaceFixture(ctx, 'spaces');
      const list = async (session: { cookie: string }) =>
        (await get(ctx, '/api/v1/spaces', session)).json<SpaceSummary[]>();
      expect(await list(bob)).toEqual([]);
      expect((await list(alice)).map((s) => s.id)).toEqual([spaceId]);
      expect((await list(admin)).map((s) => s.id)).toContain(spaceId);
    },
  },

  // Nem tagnak 403 not_space_member (cím, darabszám nélkül); a Rendszeradmin látja a tér adatait (D56).
  'GET /api/v1/spaces/:id': {
    how: 'can_guard',
    async run(ctx) {
      const { alice, bob, admin, spaceId } = await spaceFixture(ctx, 'detail');
      const denied = await get(ctx, `/api/v1/spaces/${spaceId}`, bob);
      expect(denied.statusCode).toBe(403);
      expect(denied.json<ProblemDetails>().code).toBe('not_space_member');
      expect(JSON.stringify(denied.json())).not.toMatch(/memberCount|"title"\s*:\s*"Titkos/);
      expect((await get(ctx, `/api/v1/spaces/${spaceId}`, alice)).statusCode).toBe(200);
      expect((await get(ctx, `/api/v1/spaces/${spaceId}`, admin)).statusCode).toBe(200);
    },
  },

  'GET /api/v1/spaces/:id/members': {
    how: 'can_guard',
    async run(ctx) {
      const { alice, bob, admin, spaceId } = await spaceFixture(ctx, 'members');
      const url = `/api/v1/spaces/${spaceId}/members`;
      expect((await get(ctx, url, bob)).json<ProblemDetails>().code).toBe('not_space_member');
      expect((await get(ctx, url, alice)).statusCode).toBe(200);
      expect((await get(ctx, url, admin)).statusCode).toBe(200);
    },
  },

  // Csak azonosító, név és avatar; e-mail soha, és a nem allowlistes felhasználó nem jelenik meg.
  'GET /api/v1/users': {
    how: 'self_only',
    async run(ctx) {
      const { alice } = await spaceFixture(ctx, 'users');
      ctx.store.addUser('ghost.person@example.test'); // nincs az allowlisten
      const res = await get(ctx, '/api/v1/users?q=alice-users', alice);
      const body = res.json<UserRef[]>();
      expect(body.map((u) => u.displayName)).toEqual(['alice-users']);
      expect(Object.keys(body[0] ?? {}).sort()).toEqual(['avatarUrl', 'displayName', 'id']);
      expect(JSON.stringify(body)).not.toContain('@');
      expect((await get(ctx, '/api/v1/users?q=ghost.person', alice)).json<UserRef[]>()).toEqual([]);
    },
  },

  'GET /api/v1/admin/users': {
    how: 'admin_only',
    async run(ctx) {
      const { alice, admin } = await spaceFixture(ctx, 'admin');
      const denied = await get(ctx, '/api/v1/admin/users', alice);
      expect(denied.statusCode).toBe(403);
      expect(denied.json<ProblemDetails>().code).toBe('forbidden');
      expect((await get(ctx, '/api/v1/admin/users', admin)).statusCode).toBe(200);
    },
  },

  // Csak a hívó saját munkamenetéből dolgozik: másnak a színterei, e-mailje nem jelenhet meg.
  'GET /api/v1/me': {
    how: 'self_only',
    async run(ctx) {
      const alice = await ctx.signIn('alice@example.test');
      const bob = await ctx.signIn('bob@example.test');
      ctx.store.addMembership(alice.userId, {
        id: 'space-a',
        name: 'Titkos tér',
        type: 'team',
        role: 'author',
      });
      const me = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { cookie: bob.cookie },
      });
      const body = me.json<MeResponse>();
      expect(body.id).toBe(bob.userId);
      expect(body.spaces).toEqual([]);
      // D57: a másik felhasználó mentett aktuális tere sem szivárog át (a tárolt érték a hívó saját sorából jön).
      await ctx.store.setCurrentSpace(alice.userId, 'space-a');
      const again = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { cookie: bob.cookie },
      });
      expect(again.json<MeResponse>().currentSpaceId).toBeNull();
      expect(JSON.stringify(body)).not.toMatch(/alice|Titkos tér/);
    },
  },
};
