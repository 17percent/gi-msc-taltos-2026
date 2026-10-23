import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { COLLAB_PATH, HEALTH_PATH, NOTIFICATIONS_PATH, PROBLEM_CONTENT_TYPE } from '@taltos/shared';
import { buildApp, type BuildOptions } from './app.js';
import { loadConfig, type AppConfig } from './config.js';

const ORIGIN = 'http://localhost:5173';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  version: 'test',
  allowedOrigins: [ORIGIN],
  trustProxy: false,
};

let app: FastifyInstance | undefined;

/** Hocuspocus Auth-üzenet: varString(dokumentum), Auth (2), Token (0), varString(token). */
function hocuspocusAuthMessage(documentName: string, token: string): Buffer {
  const varString = (value: string) => {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > 127) throw new Error('a tesztkódoló csak rövid szöveget kezel');
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  };
  return Buffer.concat([varString(documentName), Buffer.from([2, 0]), varString(token)]);
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('HTTP', () => {
  it('a /healthz élő', async () => {
    app = await buildApp(config);
    const response = await app.inject({ method: 'GET', url: HEALTH_PATH });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: 'test' });
  });

  it('ismeretlen útvonalra not_found Problem Details-t ad', async () => {
    app = await buildApp(config);
    const response = await app.inject({ method: 'GET', url: '/api/v1/nincs-ilyen' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ status: 404, code: 'not_found' });
  });

  it('sémasértő kérésre validation_error-t ad mezőnkénti részletekkel', async () => {
    app = await buildApp(config);
    app.post(
      '/teszt/validacio',
      {
        schema: {
          body: { type: 'object', required: ['cim'], properties: { cim: { type: 'string' } } },
        },
      },
      () => ({ ok: true }),
    );
    const response = await app.inject({ method: 'POST', url: '/teszt/validacio', payload: {} });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; details: { errors: unknown[] } }>();
    expect(body.code).toBe('validation_error');
    expect(body.details.errors.length).toBeGreaterThan(0);
  });

  it('4xx-es alkalmazáshibánál a státuszhoz tartozó katalóguskódot adja, a belső szöveg nélkül', async () => {
    app = await buildApp(config);
    app.get('/teszt/tiltott', () => {
      throw Object.assign(new Error('belső részlet a jogosultságról'), { statusCode: 403 });
    });
    const response = await app.inject({ method: 'GET', url: '/teszt/tiltott' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ status: 403, code: 'forbidden' });
    expect(response.body).not.toContain('belső részlet');
  });

  it('katalógusban nem szereplő kérésformátum-hibára (415) validation_error-t ad 400-zal', async () => {
    app = await buildApp(config);
    app.post('/teszt/json', { schema: { body: { type: 'object' } } }, () => ({ ok: true }));
    const response = await app.inject({
      method: 'POST',
      url: '/teszt/json',
      headers: { 'content-type': 'application/x-ismeretlen' },
      payload: 'x',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: 400, code: 'validation_error' });
    expect(response.json<{ detail?: string }>().detail).toBeTruthy();
  });

  it('egyetlen proxy-hopot bízik meg: a kliens által hamisított X-Forwarded-For nem lesz IP', async () => {
    app = await buildApp({
      ...config,
      trustProxy: loadConfig({ TRUST_PROXY: 'uniquelocal' }).trustProxy,
    });
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
    app = await buildApp(config);
    app.get('/teszt/hiba', () => {
      throw new Error('titkos belső részlet');
    });
    const response = await app.inject({ method: 'GET', url: '/teszt/hiba' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'internal_error' });
    expect(response.body).not.toContain('titkos');
  });
});

describe('WebSocket-csatornák', () => {
  async function listen(options?: BuildOptions): Promise<string> {
    app = await buildApp(config, options);
    await app.listen({ host: config.host, port: 0 });
    const { port } = app.server.address() as AddressInfo;
    return `ws://127.0.0.1:${port}`;
  }

  function open(
    url: string,
    origin?: string,
    extra: WebSocket.ClientOptions = {},
  ): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { ...extra, ...(origin === undefined ? {} : { origin }) });
      socket.once('open', () => resolve(socket));
      socket.once('unexpected-response', (_request, response) => {
        reject(new Error(`HTTP ${response.statusCode}`));
      });
      socket.once('error', reject);
    });
  }

  it.each([COLLAB_PATH, NOTIFICATIONS_PATH])('a %s engedélyezett originről fogad', async (path) => {
    const base = await listen();
    const socket = await open(`${base}${path}`, ORIGIN);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it.each([COLLAB_PATH, NOTIFICATIONS_PATH])(
    'a %s idegen originről 403-mal elutasít',
    async (path) => {
      const base = await listen();
      await expect(open(`${base}${path}`, 'https://tamado.example')).rejects.toThrow('HTTP 403');
    },
  );

  it('a /collab Origin fejléc nélkül is elutasít', async () => {
    const base = await listen();
    await expect(open(`${base}${COLLAB_PATH}`)).rejects.toThrow('HTTP 403');
  });

  it('a /collab feldolgozza az üzenetet, és a hitelesítést alapból elutasítja', async () => {
    const base = await listen();
    const socket = await open(`${base}${COLLAB_PATH}`, ORIGIN);
    const reply = new Promise<Buffer>((resolve) =>
      socket.once('message', (data) => resolve(data as Buffer)),
    );
    socket.send(hocuspocusAuthMessage('teszt-dokumentum', 'token'));
    expect((await reply).toString('latin1')).toContain('permission-denied');
    socket.close();
  });

  it('a kliens zárása után a szerver leállása nem akad el', async () => {
    const base = await listen();
    const socket = await open(`${base}${COLLAB_PATH}`, ORIGIN);
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
    });
    await app?.close();
    app = undefined;
  });

  it.each([COLLAB_PATH, NOTIFICATIONS_PATH])(
    'a %s élő kliensét pinggel tartja életben',
    async (path) => {
      const base = await listen({ heartbeatIntervalMs: 50 });
      const socket = await open(`${base}${path}`, ORIGIN);
      await new Promise<void>((resolve) => socket.once('ping', () => resolve()));
      socket.close();
    },
  );

  it.each([COLLAB_PATH, NOTIFICATIONS_PATH])(
    'a %s pongra nem válaszoló kliensét bontja',
    async (path) => {
      const base = await listen({ heartbeatIntervalMs: 50 });
      const socket = await open(`${base}${path}`, ORIGIN, { autoPong: false });
      await new Promise<void>((resolve) => socket.once('close', () => resolve()));
      expect(socket.readyState).toBe(WebSocket.CLOSED);
    },
  );
});
