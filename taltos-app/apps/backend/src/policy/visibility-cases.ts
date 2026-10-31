import { expect } from 'vitest';
import type { MeResponse } from '@taltos/shared';
import type { TestContext } from '../testing/app.js';
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
      expect(JSON.stringify(body)).not.toMatch(/alice|Titkos tér/);
    },
  },
};
