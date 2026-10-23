import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { COLLAB_PATH, NOTIFICATIONS_PATH } from '@taltos/shared';
import type { BuildOptions } from '../app.js';
import { createTestApp, TEST_ORIGIN as ORIGIN, type TestContext } from '../testing/app.js';

let ctx: TestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

/** Hocuspocus Auth-üzenet: varString(dokumentum), Auth (2), Token (0), varString(token). */
function hocuspocusAuthMessage(documentName: string, token: string): Buffer {
  const varString = (value: string) => {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > 127) throw new Error('a tesztkódoló csak rövid szöveget kezel');
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  };
  return Buffer.concat([varString(documentName), Buffer.from([2, 0]), varString(token)]);
}

async function listen(options?: BuildOptions): Promise<{ base: string; cookie: string }> {
  ctx = await createTestApp({}, options);
  const session = await ctx.signIn('anna@example.test');
  await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = ctx.app.server.address() as AddressInfo;
  return { base: `ws://127.0.0.1:${port}`, cookie: session.cookie };
}

function open(
  url: string,
  headers: { origin?: string; cookie?: string } = {},
  extra: WebSocket.ClientOptions = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { ...extra, headers });
    socket.once('open', () => resolve(socket));
    socket.once('unexpected-response', (_request, response) => {
      reject(new Error(`HTTP ${response.statusCode}`));
    });
    socket.once('error', reject);
  });
}

const PATHS = [COLLAB_PATH, NOTIFICATIONS_PATH];

describe('WebSocket-csatornák: kapu (appsec C1)', () => {
  it.each(PATHS)('a %s érvényes munkamenettel és originnel fogad', async (path) => {
    const { base, cookie } = await listen();
    const socket = await open(`${base}${path}`, { origin: ORIGIN, cookie });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it.each(PATHS)('a %s munkamenet nélkül 401-gyel elutasít (upgrade előtt)', async (path) => {
    const { base } = await listen();
    await expect(open(`${base}${path}`, { origin: ORIGIN })).rejects.toThrow('HTTP 401');
  });

  it.each(PATHS)('a %s érvénytelen session-sütivel 401', async (path) => {
    const { base } = await listen();
    const cookie = `taltos_sid=${'A'.repeat(43)}`;
    await expect(open(`${base}${path}`, { origin: ORIGIN, cookie })).rejects.toThrow('HTTP 401');
  });

  it.each(PATHS)('a %s allowlistről levett felhasználót 403-mal elutasít', async (path) => {
    const { base, cookie } = await listen();
    ctx?.store.disallow('anna@example.test');
    await expect(open(`${base}${path}`, { origin: ORIGIN, cookie })).rejects.toThrow('HTTP 403');
  });

  it.each(PATHS)('a %s idegen originről 403, Origin nélkül 403', async (path) => {
    const { base, cookie } = await listen();
    await expect(
      open(`${base}${path}`, { origin: 'https://tamado.example', cookie }),
    ).rejects.toThrow('HTTP 403');
    await expect(open(`${base}${path}`, { cookie })).rejects.toThrow('HTTP 403');
  });

  it('a /collab feldolgozza az üzenetet, és a hitelesítést alapból elutasítja', async () => {
    const { base, cookie } = await listen();
    const socket = await open(`${base}${COLLAB_PATH}`, { origin: ORIGIN, cookie });
    const reply = new Promise<Buffer>((resolve) =>
      socket.once('message', (data) => resolve(data as Buffer)),
    );
    socket.send(hocuspocusAuthMessage('teszt-dokumentum', 'token'));
    expect((await reply).toString('latin1')).toContain('permission-denied');
    socket.close();
  });

  it('a kliens zárása után a szerver leállása nem akad el', async () => {
    const { base, cookie } = await listen();
    const socket = await open(`${base}${COLLAB_PATH}`, { origin: ORIGIN, cookie });
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
    });
    await ctx?.app.close();
    ctx = undefined;
  });
});

describe('WebSocket-csatornák: munkamenet-aktivitás', () => {
  it('az üzenet ritkítva aktivitásnak számít, a lejárt munkamenetet a következő üzenet zárja', async () => {
    const { base, cookie } = await listen();
    const socket = await open(`${base}${NOTIFICATIONS_PATH}`, { origin: ORIGIN, cookie });
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));

    // 30 mp: ritkítás, nincs írás.
    ctx?.clock.advance(30_000);
    socket.send('a');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ctx?.store.touchWrites).toBe(0);

    // 61 mp a belépés óta: az üzenet újraérvényesít és frissíti a last_seen_at-et.
    ctx?.clock.advance(31_000);
    socket.send('b');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ctx?.store.touchWrites).toBe(1);

    // Az abszolút lejárat után az üzenet zárja a kapcsolatot (1008).
    ctx?.clock.advance(9 * 60 * 60_000);
    socket.send('c');
    expect(await closed).toBe(1008);
  });

  it.each(PATHS)('a %s élő kliensét pinggel tartja életben', async (path) => {
    const { base, cookie } = await listen({ heartbeatIntervalMs: 50 });
    const socket = await open(`${base}${path}`, { origin: ORIGIN, cookie });
    await new Promise<void>((resolve) => socket.once('ping', () => resolve()));
    socket.close();
  });

  it.each(PATHS)('a %s pongra nem válaszoló kliensét bontja', async (path) => {
    const { base, cookie } = await listen({ heartbeatIntervalMs: 50 });
    const socket = await open(`${base}${path}`, { origin: ORIGIN, cookie }, { autoPong: false });
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
