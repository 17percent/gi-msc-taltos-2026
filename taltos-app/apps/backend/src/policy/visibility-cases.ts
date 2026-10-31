import { expect } from 'vitest';
import type { MeResponse } from '@taltos/shared';
import type { TestContext } from '../testing/app.js';

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
