import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { COLLAB_PATH, type DocumentDetail } from '@taltos/shared';
import { createTestApp, TEST_ORIGIN, type TestContext } from '../testing/app.js';

/**
 * A piszkozat eldobása után a dokumentum nyitott `/collab`-kapcsolatai azonnal bomlanak (D59), a többi dokumentumé
 * érintetlen marad. Valódi WebSocketen, a Hocuspocus kézzel kódolt hitelesítő üzenetével (mint a `collab.test.ts`).
 */
let ctx: TestContext | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await ctx?.app.close();
  ctx = undefined;
});

const varUint = (value: number) => Buffer.from([value]); // a tesztnevek és értékek 128 alattiak
const varString = (value: string) => {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([varUint(bytes.length), bytes]);
};
const authMessage = (name: string) =>
  Buffer.concat([varString(name), varUint(2), varUint(0), varString('token')]);

interface Client {
  socket: WebSocket;
  messages: Buffer[];
}

/** A Hocuspocus üzenet törzse a dokumentumnév után: az első bájt az üzenettípus (Auth=2, Close=7). */
const bodies = (client: Client, name: string) =>
  client.messages
    .filter((m) => m.subarray(1, 1 + (m[0] ?? 0)).toString('utf8') === name)
    .map((m) => m.subarray(1 + (m[0] ?? 0)));

async function open(base: string, cookie: string, name: string): Promise<Client> {
  const socket = new WebSocket(base, { headers: { origin: TEST_ORIGIN, cookie } });
  sockets.push(socket);
  const client: Client = { socket, messages: [] };
  socket.on('message', (data) => client.messages.push(data as Buffer));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.send(authMessage(name));
  await vi.waitFor(
    () => {
      // az Authenticated válasz: Auth (2), Authenticated (2)
      if (!bodies(client, name).some((b) => b[0] === 2 && b[1] === 2)) {
        throw new Error('még nincs hitelesítve');
      }
    },
    { timeout: 3_000, interval: 10 },
  );
  return client;
}

describe('piszkozat-eldobás és a /collab', () => {
  it('az eldobott dokumentum kapcsolata bomlik, egy másik dokumentumé nem', async () => {
    ctx = await createTestApp({}, { collabDebounceMs: 20, collabMaxDebounceMs: 100 });
    const alice = await ctx.signIn('alice@example.test');
    const spaceId = crypto.randomUUID();
    ctx.collab.addSpace(spaceId);
    ctx.collab.addMember(spaceId, alice.userId);
    await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = ctx.app.server.address() as AddressInfo;
    const base = `ws://127.0.0.1:${String(port)}${COLLAB_PATH}`;

    const make = async (title: string) =>
      (
        await ctx!.app.inject({
          method: 'POST',
          url: '/api/v1/documents',
          headers: alice.headers,
          payload: { spaceId, title, kind: 'prompt' },
        })
      ).json<DocumentDetail>().id;
    const [doomed, kept] = [await make('Eldobott'), await make('Megmarad')];

    const doomedClient = await open(base, alice.cookie, doomed);
    const keptClient = await open(base, alice.cookie, kept);
    const res = await ctx.app.inject({
      method: 'DELETE',
      // nagybetűs azonosító: az Ajv `uuid` formátuma és a Postgres `uuid` kis/nagybetű-független, a /collab névre
      // viszont a Hocuspocus szigorúan hasonlít (D59: a bontás ettől még megtörténik)
      url: `/api/v1/documents/${doomed.toUpperCase()}/draft`,
      headers: alice.headers,
    });
    expect(res.statusCode).toBe(204);
    // A Hocuspocus a dokumentum-kapcsolatot bontja (Close üzenet a kliensnek, a szerver leveszi a dokumentumról);
    // a socket multiplexelt, ezért a másik dokumentum kapcsolata érintetlen.
    await vi.waitFor(
      () => {
        if (!bodies(doomedClient, doomed).some((b) => b[0] === 7)) throw new Error('nincs Close');
      },
      { timeout: 3_000, interval: 10 },
    );
    expect(bodies(keptClient, kept).some((b) => b[0] === 7)).toBe(false);
    expect(keptClient.socket.readyState).toBe(WebSocket.OPEN);
  });
});
