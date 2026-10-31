import type { RouteOptions } from 'fastify';
import { API_PREFIX, COLLAB_PATH } from '@taltos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from '../testing/app.js';
import { VISIBILITY_CASES } from './visibility-cases.js';

/**
 * Útvonal-őr (D44, `Szerepkörök.md` „Tesztelés”): minden `/api/v1` olvasó (GET) végponthoz kell láthatósági eset.
 * Az útvonalakat egy `onRoute` hook gyűjti, így az új végpont nem kerülheti el az őrt. Eset nélkül piros.
 */
describe('olvasó végpontok láthatósági esetei', () => {
  const routes: string[] = [];
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp(
      {},
      {
        onRoute: (route: RouteOptions) => {
          const methods = Array.isArray(route.method) ? route.method : [route.method];
          const isRead = route.url.startsWith(`${API_PREFIX}/`) || route.url === COLLAB_PATH;
          if (methods.includes('GET') && isRead) {
            routes.push(`GET ${route.url}`);
          }
        },
      },
    );
    await ctx.app.ready();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('az útvonal-gyűjtő működik: a GET /me megtalálható', () => {
    expect(routes).toContain(`GET ${API_PREFIX}/me`);
    expect(routes).toContain(`GET ${COLLAB_PATH}`);
  });

  it('minden /api/v1 GET végponthoz van láthatósági eset (eset nélkül piros)', () => {
    const missing = routes.filter((route) => !(route in VISIBILITY_CASES));
    expect(missing, `Hiányzó VISIBILITY_CASES bejegyzés: ${missing.join(', ')}`).toEqual([]);
  });

  it('nincs elavult eset: minden bejegyzés valódi végpontra mutat', () => {
    const stale = Object.keys(VISIBILITY_CASES).filter((route) => !routes.includes(route));
    expect(stale, `Elavult VISIBILITY_CASES bejegyzés: ${stale.join(', ')}`).toEqual([]);
  });

  it('a GET /me és a GET /collab esete lefedett és fut', async () => {
    for (const key of [`GET ${API_PREFIX}/me`, `GET ${COLLAB_PATH}`]) {
      const entry = VISIBILITY_CASES[key];
      expect(entry, key).toBeDefined();
      await entry?.run(ctx);
    }
  });

  it('minden olvasó végpont bejelentkezés nélkül 401', async () => {
    for (const route of new Set(routes)) {
      if (!route.includes(API_PREFIX)) continue; // a /collab upgrade-kapuját a ws.test.ts fedi
      const url = route
        .slice('GET '.length)
        .replace(/:\w+/g, '00000000-0000-4000-8000-000000000000');
      const response = await ctx.app.inject({ method: 'GET', url });
      expect(response.statusCode, route).toBe(401);
    }
  });

  it('az őr tényleg pirosat ad: eset nélküli végpontot hiányolja', () => {
    const fake = [...routes, `GET ${API_PREFIX}/spaces/:id/members`];
    expect(fake.filter((route) => !(route in VISIBILITY_CASES))).toEqual([
      `GET ${API_PREFIX}/spaces/:id/members`,
    ]);
  });
});
