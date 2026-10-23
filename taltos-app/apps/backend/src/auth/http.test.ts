import { afterEach, describe, expect, it } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type MeResponse } from '@taltos/shared';
import { createTestApp, TEST_ORIGIN, type TestContext } from '../testing/app.js';
import { LoginRejected } from './oidc.js';

let ctx: TestContext;

afterEach(async () => {
  await ctx.app.close();
});

const ME = '/api/v1/me';

describe('munkamenet és allowlist-kapu (/api/v1)', () => {
  it('session nélkül 401 unauthenticated, ismeretlen útvonalra is', async () => {
    ctx = await createTestApp();
    for (const url of [ME, '/api/v1/nincs-ilyen']) {
      const response = await ctx.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
      expect(response.json()).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('a /me a B5 szerinti alakot adja a CSRF-tokennel, no-store fejléccel', async () => {
    ctx = await createTestApp();
    const session = await ctx.signIn('anna@example.test');
    ctx.store.addMembership(session.userId, {
      id: 'sp1',
      name: 'Általános',
      type: 'general',
      role: 'author',
    });
    const response = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<MeResponse>();
    expect(Object.keys(body).sort()).toEqual(
      ['avatarUrl', 'csrfToken', 'displayName', 'email', 'id', 'spaces', 'systemRole'].sort(),
    );
    expect(body).toMatchObject({
      id: session.userId,
      email: 'anna@example.test',
      avatarUrl: null,
      systemRole: 'user',
      csrfToken: session.csrf,
      spaces: [{ id: 'sp1', name: 'Általános', type: 'general', role: 'author' }],
    });
  });

  it('az allowlistről levett felhasználó következő kérése 403, a munkamenet visszavonódik', async () => {
    ctx = await createTestApp();
    const session = await ctx.signIn('anna@example.test');
    const get = () =>
      ctx.app.inject({ method: 'GET', url: ME, headers: { cookie: session.cookie } });
    expect((await get()).statusCode).toBe(200);
    ctx.store.disallow('anna@example.test');
    const denied = await get();
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'not_on_allowlist' });
    // Újra felvéve sem él a visszavont munkamenet: új belépés kell.
    ctx.store.allow('anna@example.test');
    expect((await get()).statusCode).toBe(401);
  });

  it('abszolút lejárat (8 óra) után 401, időutazással', async () => {
    ctx = await createTestApp();
    const session = await ctx.signIn('anna@example.test');
    const get = () =>
      ctx.app.inject({ method: 'GET', url: ME, headers: { cookie: session.cookie } });
    // Óránként aktív, így a tétlenség nem érvényesül, csak az abszolút lejárat.
    for (let hour = 0; hour < 8; hour += 1) {
      ctx.clock.advance(55 * 60_000);
      expect((await get()).statusCode).toBe(200);
    }
    ctx.clock.advance(25 * 60_000); // 7 óra 45 perc
    expect((await get()).statusCode).toBe(200);
    ctx.clock.advance(20 * 60_000); // 8 óra 5 perc
    expect((await get()).statusCode).toBe(401);
  });

  it('60 perc tétlenség után 401; az aktivitás meghosszabbítja, az írás ritkított', async () => {
    ctx = await createTestApp();
    const session = await ctx.signIn('anna@example.test');
    const get = () =>
      ctx.app.inject({ method: 'GET', url: ME, headers: { cookie: session.cookie } });
    ctx.clock.advance(30_000);
    await get();
    expect(ctx.store.touchWrites).toBe(0); // percen belül nincs írás
    ctx.clock.advance(31_000);
    await get();
    expect(ctx.store.touchWrites).toBe(1);
    ctx.clock.advance(59 * 60_000);
    expect((await get()).statusCode).toBe(200); // 59 perc tétlenség: él
    ctx.clock.advance(61 * 60_000);
    expect((await get()).statusCode).toBe(401); // 61 perc tétlenség: lejárt
  });

  it('hibás formátumú session-süti 401', async () => {
    ctx = await createTestApp();
    const response = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { cookie: 'taltos_sid=nem-token' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('CSRF és Origin (D26, B5 A1)', () => {
  const post = (headers: Record<string, string>) =>
    ctx.app.inject({ method: 'POST', url: '/api/v1/nincs-ilyen', headers, payload: {} });

  it('érvényes Origin + CSRF-token átmegy a kapun (a 404 az útvonalé)', async () => {
    ctx = await createTestApp();
    const session = await ctx.signIn('anna@example.test');
    expect((await post(session.headers)).statusCode).toBe(404);
  });

  it('CSRF-token nélkül 403 csrf_failed', async () => {
    ctx = await createTestApp();
    const session = await ctx.signIn('anna@example.test');
    const headers = { ...session.headers };
    delete headers['x-csrf-token'];
    const response = await post(headers);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'csrf_failed' });
  });

  it('másik munkamenet CSRF-tokenjével 403 csrf_failed', async () => {
    ctx = await createTestApp();
    const anna = await ctx.signIn('anna@example.test');
    const bela = await ctx.signIn('bela@example.test');
    const response = await post({ ...anna.headers, 'x-csrf-token': bela.csrf });
    expect(response.json()).toMatchObject({ code: 'csrf_failed' });
  });

  it('idegen vagy hiányzó Origin 403 csrf_failed', async () => {
    ctx = await createTestApp();
    const session = await ctx.signIn('anna@example.test');
    const foreign = await post({ ...session.headers, origin: 'https://tamado.example' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ code: 'csrf_failed' });
    const headers = { ...session.headers };
    delete headers.origin;
    expect((await post(headers)).statusCode).toBe(403);
  });

  it('session nélküli mutáló kérés 401 (előbb a hitelesítés)', async () => {
    ctx = await createTestApp();
    expect((await post({ origin: TEST_ORIGIN })).statusCode).toBe(401);
  });
});

describe('/auth útvonalak', () => {
  it('a login az IdP-re irányít, és aláírt, httpOnly kísérlet-sütit állít', async () => {
    ctx = await createTestApp();
    const response = await ctx.app.inject({ method: 'GET', url: '/auth/login' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('https://idp.example/authorize');
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/taltos_login=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  async function startLogin(): Promise<string> {
    const login = await ctx.app.inject({ method: 'GET', url: '/auth/login' });
    return String(login.headers['set-cookie']).split(';')[0] ?? '';
  }

  const callback = (cookie: string) =>
    ctx.app.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-1',
      headers: { cookie, host: 'tamado.example' },
    });

  it('a bootstrap e-mail belép: session-süti, átirányítás /-re, Általános gazda (D54)', async () => {
    ctx = await createTestApp();
    ctx.store.allow('owner@example.test');
    ctx.oidc.result = { sub: 's1', email: 'owner@example.test', name: 'Owner', picture: null };
    const response = await callback(await startLogin());
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    const session = cookies.find((c) => c.startsWith('taltos_sid='));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Path=\//);
    expect(session).not.toMatch(/Secure/i);
    // A callback-URL origin-je a konfigból jön, nem a Host fejlécből; az ellenőrző értékek a sütiből.
    expect(ctx.oidc.finished?.url.origin).toBe('http://localhost:8080');
    expect(ctx.oidc.finished?.tx.state).toBe('state-1');
    // A kapott süti érvényes munkamenet.
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: (session ?? '').split(';')[0] ?? '' },
    });
    expect(me.json<MeResponse>().spaces).toMatchObject([
      { type: 'general', role: 'space_manager' },
    ]);
  });

  it('nem allowlistes, de hitelesített felhasználó: /?error=not_on_allowlist, session nélkül', async () => {
    ctx = await createTestApp();
    ctx.oidc.result = { sub: 's2', email: 'kivul@example.test', name: null, picture: null };
    const response = await callback(await startLogin());
    expect(response.headers.location).toBe('/?error=not_on_allowlist');
    expect(String(response.headers['set-cookie'] ?? '')).not.toContain('taltos_sid=');
  });

  it('nem megerősített e-mail vagy IdP-hiba: /?error=login_failed', async () => {
    ctx = await createTestApp();
    ctx.oidc.result = new LoginRejected('email_not_verified');
    expect((await callback(await startLogin())).headers.location).toBe('/?error=login_failed');
    ctx.oidc.result = new Error('invalid_grant');
    expect((await callback(await startLogin())).headers.location).toBe('/?error=login_failed');
  });

  it('kísérlet-süti nélkül vagy hamisított sütivel a callback elutasít', async () => {
    ctx = await createTestApp();
    ctx.oidc.result = { sub: 's1', email: 'anna@example.test', name: null, picture: null };
    ctx.store.allow('anna@example.test');
    expect((await callback('')).headers.location).toBe('/?error=login_failed');
    const forged = `taltos_login=${encodeURIComponent('{"state":"x","nonce":"y","codeVerifier":"z"}.hamis')}`;
    expect((await callback(forged)).headers.location).toBe('/?error=login_failed');
    expect(ctx.oidc.finished).toBeUndefined();
  });

  it('a Secure jelző a konfigból jön, az X-Forwarded-Proto-ból soha', async () => {
    for (const secure of [false, true]) {
      ctx = await createTestApp({ cookieSecure: secure });
      ctx.store.allow('owner@example.test');
      ctx.oidc.result = { sub: 's1', email: 'owner@example.test', name: null, picture: null };
      const cookie = await startLogin();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/auth/callback?code=abc&state=state-1',
        headers: { cookie, 'x-forwarded-proto': secure ? 'http' : 'https' },
      });
      const session = ([] as string[])
        .concat(response.headers['set-cookie'] ?? [])
        .find((c) => c.startsWith(secure ? '__Host-taltos_sid=' : 'taltos_sid='));
      expect(session, `cookieSecure=${secure}`).toBeDefined();
      expect(/;\s*Secure/i.test(session ?? ''), `cookieSecure=${secure}`).toBe(secure);
      // __Host-: Path=/ és nincs Domain.
      if (secure) expect(session).not.toMatch(/Domain=/i);
      await ctx.app.close();
    }
    ctx = await createTestApp();
  });

  it('a kijelentkezés CSRF-et kér, visszavonja a munkamenetet és törli a sütit', async () => {
    ctx = await createTestApp();
    const session = await ctx.signIn('anna@example.test');
    const noCsrf = await ctx.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: session.cookie, origin: TEST_ORIGIN },
    });
    expect(noCsrf.statusCode).toBe(403);
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: session.headers,
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/taltos_sid=;/);
    const me = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { cookie: session.cookie },
    });
    expect(me.statusCode).toBe(401);
  });

  it('a kijelentkezés session nélkül 401, de az elavult session-sütit törli', async () => {
    ctx = await createTestApp();
    const bare = await ctx.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: TEST_ORIGIN },
    });
    expect(bare.statusCode).toBe(401);
    const stale = await ctx.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: TEST_ORIGIN, cookie: `taltos_sid=${'A'.repeat(43)}` },
    });
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toMatchObject({ code: 'unauthenticated' });
    expect(String(stale.headers['set-cookie'])).toMatch(/taltos_sid=;/);
  });

  it('Secure módban a sütinevek előtagosak (__Host- a sessionön, __Secure- a kísérleten), Path változatlan', async () => {
    ctx = await createTestApp({ cookieSecure: true });
    const login = await ctx.app.inject({ method: 'GET', url: '/auth/login' });
    const tx = String(login.headers['set-cookie']);
    expect(tx).toMatch(/^__Secure-taltos_login=/);
    expect(tx).toMatch(/Path=\/auth/);
    expect(tx).toMatch(/;\s*Secure/i);
    const session = await ctx.signIn('anna@example.test');
    expect(session.cookie).toMatch(/^__Host-taltos_sid=/);
    const me = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { cookie: session.cookie },
    });
    expect(me.statusCode).toBe(200);
    // Az előtag nélküli név Secure módban nem hitelesít.
    const plain = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { cookie: session.cookie.replace('__Host-', '') },
    });
    expect(plain.statusCode).toBe(401);
  });

  it('nem Secure módban az egyszerű sütinevek maradnak', async () => {
    ctx = await createTestApp();
    const session = await ctx.signIn('anna@example.test');
    expect(session.cookie).toMatch(/^taltos_sid=/);
  });

  it('rendszerindítás előtt más allowlistes felhasználó /?error=setup_pending, session nélkül (D54)', async () => {
    ctx = await createTestApp();
    ctx.store.allow('anna@example.test');
    ctx.oidc.result = { sub: 's1', email: 'anna@example.test', name: 'Anna', picture: null };
    const response = await callback(await startLogin());
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/?error=setup_pending');
    expect(String(response.headers['set-cookie'] ?? '')).not.toContain('taltos_sid=');
    expect(ctx.store.users.size).toBe(0);
  });

  it('a rendszerindítás után a második felhasználó Szerző az Általánosban (D54)', async () => {
    ctx = await createTestApp();
    ctx.store.allow('owner@example.test');
    ctx.store.allow('anna@example.test');
    ctx.oidc.result = { sub: 's0', email: 'owner@example.test', name: null, picture: null };
    expect((await callback(await startLogin())).headers.location).toBe('/');
    ctx.oidc.result = { sub: 's1', email: 'anna@example.test', name: null, picture: null };
    const response = await callback(await startLogin());
    expect(response.headers.location).toBe('/');
    const session = ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('taltos_sid='));
    const me = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { cookie: (session ?? '').split(';')[0] ?? '' },
    });
    expect(me.json<MeResponse>()).toMatchObject({
      systemRole: 'user',
      spaces: [{ type: 'general', role: 'author' }],
    });
  });

  it('a sikeres belépés visszavonja a kérés korábbi munkamenetét (session-fixation ellen)', async () => {
    ctx = await createTestApp();
    ctx.store.allow('owner@example.test');
    ctx.oidc.result = { sub: 's1', email: 'owner@example.test', name: null, picture: null };
    const old = await ctx.signIn('owner@example.test', 'system_admin');
    const response = await callback(`${await startLogin()}; ${old.cookie}`);
    expect(response.headers.location).toBe('/');
    const oldMe = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { cookie: old.cookie },
    });
    expect(oldMe.statusCode).toBe(401);
  });

  it('a store.login hibája login_failed átirányítás, nem 500', async () => {
    ctx = await createTestApp();
    ctx.oidc.result = { sub: 's1', email: 'owner@example.test', name: null, picture: null };
    ctx.store.login = () => Promise.reject(new Error('connection terminated'));
    const response = await callback(await startLogin());
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/?error=login_failed');
    expect(String(response.headers['set-cookie'] ?? '')).not.toContain('taltos_sid=');
  });
});

describe('globális Origin-kapu mutáló kérésekre (appsec W-5)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    '%s idegen vagy hiányzó Origin-nel 403 csrf_failed, bármely útvonalon',
    async (method) => {
      ctx = await createTestApp();
      for (const url of ['/nincs-ilyen', '/auth/login', '/healthz']) {
        const missing = await ctx.app.inject({ method, url });
        expect(missing.statusCode, `${method} ${url}`).toBe(403);
        expect(missing.json()).toMatchObject({ code: 'csrf_failed' });
        const foreign = await ctx.app.inject({
          method,
          url,
          headers: { origin: 'https://tamado.example' },
        });
        expect(foreign.statusCode).toBe(403);
      }
    },
  );

  it('engedélyezett Origin-nel a kérés az útvonalig jut (404), a biztonságos metódusok Origin nélkül is', async () => {
    ctx = await createTestApp();
    const post = await ctx.app.inject({
      method: 'POST',
      url: '/nincs-ilyen',
      headers: { origin: TEST_ORIGIN },
    });
    expect(post.statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });
});
