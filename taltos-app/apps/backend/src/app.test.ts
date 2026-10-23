import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { HEALTH_PATH, PROBLEM_CONTENT_TYPE } from '@taltos/shared';
import { loadConfig } from './config.js';
import { createTestApp, TEST_ORIGIN } from './testing/app.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('HTTP', () => {
  it('a /healthz élő', async () => {
    ({ app } = await createTestApp());
    const response = await app.inject({ method: 'GET', url: HEALTH_PATH });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: 'test' });
  });

  it('ismeretlen útvonalra not_found Problem Details-t ad (belépve)', async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    const session = await ctx.signIn('anna@example.test');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nincs-ilyen',
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ status: 404, code: 'not_found' });
  });

  it('sémasértő kérésre validation_error-t ad mezőnkénti részletekkel', async () => {
    ({ app } = await createTestApp());
    app.post(
      '/teszt/validacio',
      {
        schema: {
          body: { type: 'object', required: ['cim'], properties: { cim: { type: 'string' } } },
        },
      },
      () => ({ ok: true }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/teszt/validacio',
      headers: { origin: TEST_ORIGIN },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; details: { errors: unknown[] } }>();
    expect(body.code).toBe('validation_error');
    expect(body.details.errors.length).toBeGreaterThan(0);
  });

  it('4xx-es alkalmazáshibánál a státuszhoz tartozó katalóguskódot adja, a belső szöveg nélkül', async () => {
    ({ app } = await createTestApp());
    app.get('/teszt/tiltott', () => {
      throw Object.assign(new Error('belső részlet a jogosultságról'), { statusCode: 403 });
    });
    const response = await app.inject({ method: 'GET', url: '/teszt/tiltott' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ status: 403, code: 'forbidden' });
    expect(response.body).not.toContain('belső részlet');
  });

  it('katalógusban nem szereplő kérésformátum-hibára (415) validation_error-t ad 400-zal', async () => {
    ({ app } = await createTestApp());
    app.post('/teszt/json', { schema: { body: { type: 'object' } } }, () => ({ ok: true }));
    const response = await app.inject({
      method: 'POST',
      url: '/teszt/json',
      headers: { 'content-type': 'application/x-ismeretlen', origin: TEST_ORIGIN },
      payload: 'x',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: 400, code: 'validation_error' });
    expect(response.json<{ detail?: string }>().detail).toBeTruthy();
  });

  it('egyetlen proxy-hopot bízik meg: a kliens által hamisított X-Forwarded-For nem lesz IP', async () => {
    ({ app } = await createTestApp({
      trustProxy: loadConfig({
        OIDC_CLIENT_ID: 'x',
        ALLOWLIST_FILE: 'y',
        BOOTSTRAP_ADMIN_EMAIL: 'owner@example.test',
        TRUST_PROXY: 'uniquelocal',
      }).trustProxy,
    }));
    app.get('/teszt/ip', (request) => ({ ip: request.ip }));
    // Privát LAN-os kliens (10.0.0.7) hamis fejléccel; az nginx (10.0.0.2) hozzáfűzi a valódit.
    const response = await app.inject({
      method: 'GET',
      url: '/teszt/ip',
      remoteAddress: '10.0.0.2',
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.7' },
    });
    expect(response.json()).toEqual({ ip: '10.0.0.7' });
  });

  it('váratlan hibánál internal_error-t ad, belső részlet nélkül', async () => {
    ({ app } = await createTestApp());
    app.get('/teszt/hiba', () => {
      throw new Error('titkos belső részlet');
    });
    const response = await app.inject({ method: 'GET', url: '/teszt/hiba' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'internal_error' });
    expect(response.body).not.toContain('titkos');
  });
});
