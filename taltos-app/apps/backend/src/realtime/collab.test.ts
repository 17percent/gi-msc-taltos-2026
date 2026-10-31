import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { COLLAB_PATH, COLLAB_TEXT_FIELD } from '@taltos/shared';
import { createTestApp, TEST_ORIGIN, type TestContext } from '../testing/app.js';
import type { ReviewState } from './collab-store.js';

/**
 * A `/collab` hozzáférés-döntése és perzisztenciája, memóriabeli adattárral és valódi WebSocketen (WP3).
 * A kliens kézzel kódolja a Hocuspocus-üzeneteket (nincs új függőség): név + üzenettípus + tartalom.
 */
const SYNC = 0;
const AUTH = 2;
const SYNC_STATUS = 8;
const STEP1 = 0;
const STEP2 = 1;
const UPDATE = 2;

let ctx: TestContext | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await ctx?.app.close();
  ctx = undefined;
});

function varUint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 127) {
    bytes.push(0x80 | (rest & 0x7f));
    rest >>>= 7;
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

const varBytes = (bytes: Uint8Array) => Buffer.concat([varUint(bytes.length), bytes]);
const varString = (value: string) => varBytes(Buffer.from(value, 'utf8'));

/** A Hocuspocus-keret: varString(dokumentum) + üzenettípus + tartalom. */
const frame = (name: string, type: number, ...rest: Buffer[]) =>
  Buffer.concat([varString(name), varUint(type), ...rest]);

const authMessage = (name: string) => frame(name, AUTH, varUint(0), varString('token'));
const updateMessage = (name: string, update: Uint8Array) =>
  frame(name, SYNC, varUint(UPDATE), varBytes(update));
const step1Message = (name: string) =>
  frame(name, SYNC, varUint(STEP1), varBytes(Y.encodeStateVector(new Y.Doc())));

/** Az elutasítás/üzenet törzse a dokumentumnév nélkül (a név hossza az első bájt, a tesztnevek rövidek). */
const withoutName = (message: Buffer) => message.subarray(1 + (message[0] ?? 0));

function editFor(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText(COLLAB_TEXT_FIELD).insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

interface Client {
  socket: WebSocket;
  messages: Buffer[];
  /** Az első olyan üzenet, amelynek törzse megfelel a feltételnek. */
  next(match: (body: Buffer) => boolean): Promise<Buffer>;
}

async function listen(options = {}): Promise<{ base: string; userId: string; cookie: string }> {
  ctx = await createTestApp({}, { collabDebounceMs: 20, collabMaxDebounceMs: 100, ...options });
  const session = await ctx.signIn('anna@example.test');
  await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = ctx.app.server.address() as AddressInfo;
  return {
    base: `ws://127.0.0.1:${port}${COLLAB_PATH}`,
    userId: session.userId,
    cookie: session.cookie,
  };
}

async function connect(base: string, cookie: string): Promise<Client> {
  const socket = new WebSocket(base, { headers: { origin: TEST_ORIGIN, cookie } });
  sockets.push(socket);
  const messages: Buffer[] = [];
  socket.on('message', (data) => messages.push(data as Buffer));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return {
    socket,
    messages,
    next: (match) =>
      vi.waitFor(
        () => {
          const found = messages.find((message) => match(withoutName(message)));
          if (found === undefined) throw new Error('még nincs ilyen üzenet');
          return found;
        },
        { timeout: 2_000, interval: 10 },
      ),
  };
}

const textOf = (body: Buffer) => body.toString('latin1');
const isDenied = (body: Buffer) => textOf(body).includes('permission-denied');
const isAuthenticated = (body: Buffer) => body[0] === AUTH && body[1] === 2;
const isSyncStatus = (body: Buffer) => body[0] === SYNC_STATUS;

/** Hitelesít a dokumentumra, és visszaadja a választ (Authenticated vagy PermissionDenied). */
async function authenticate(client: Client, name: string): Promise<Buffer> {
  client.socket.send(authMessage(name));
  return client.next((body) => isDenied(body) || isAuthenticated(body));
}

/** A szerver SyncStep2 válaszában küldött teljes állapot (update). */
async function readState(client: Client, name: string): Promise<Uint8Array> {
  client.socket.send(step1Message(name));
  const reply = await client.next((body) => body[0] === SYNC && body[1] === STEP2);
  const body = withoutName(reply);
  // body: [Sync, Step2, hossz (varUint), update…]; a teszt-dokumentumok kicsik (hossz < 128)
  return new Uint8Array(body.subarray(3, 3 + (body[2] ?? 0)));
}

/** A kliens oldalán újraépített Y.Text tartalma a szerver SyncStep2 válaszából. */
async function readText(client: Client, name: string): Promise<string> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, await readState(client, name));
  return doc.getText(COLLAB_TEXT_FIELD).toJSON();
}

/** Alaphelyzet: egy aktív tagság egy nyitott színtérben, benne egy dokumentum. */
function fixture(userId: string, options: { reviewState?: ReviewState; content?: string } = {}) {
  const collab = (ctx as TestContext).collab;
  const spaceId = randomUUID();
  const documentId = randomUUID();
  collab.addSpace(spaceId);
  collab.addMember(spaceId, userId);
  collab.addDocument(documentId, spaceId, options);
  return { collab, spaceId, documentId };
}

describe('/collab hozzáférés-döntés (onAuthenticate)', () => {
  it('az aktív tag írható dokumentumra read-write kapcsolatot kap', async () => {
    const { base, userId, cookie } = await listen();
    const { documentId } = fixture(userId);
    const reply = await authenticate(await connect(base, cookie), documentId);
    expect(textOf(withoutName(reply))).toContain('read-write');
  });

  // Az elutasított esetek törzse bájtra azonos: a kliens nem tudja megkülönböztetni az okot (nincs szivárgás).
  const rejectCases: [string, (userId: string, other: string) => string][] = [
    ['nem UUID alakú név', () => 'nem-uuid'],
    ['nagybetűs UUID', (u) => fixture(u).documentId.toUpperCase()],
    ['nem létező dokumentum', () => randomUUID()],
    [
      'törölt dokumentum',
      (u) => {
        const f = fixture(u);
        f.collab.addDocument(f.documentId, f.spaceId, { deleted: true });
        return f.documentId;
      },
    ],
    [
      'törölt színtér',
      (u) => {
        const f = fixture(u);
        f.collab.setSpace(f.spaceId, { deleted: true });
        return f.documentId;
      },
    ],
    [
      'nem tag',
      (_u, other) => {
        const f = fixture(other);
        return f.documentId;
      },
    ],
    [
      'megszűnt tagság',
      (u) => {
        const f = fixture(u);
        f.collab.addMember(f.spaceId, u, true);
        return f.documentId;
      },
    ],
  ];

  it('minden elutasítási ok ugyanazt a választ adja', async () => {
    const { base, userId, cookie } = await listen();
    const bodies: string[] = [];
    for (const [label, setup] of rejectCases) {
      const name = setup(userId, randomUUID());
      const reply = await authenticate(await connect(base, cookie), name);
      expect(isDenied(withoutName(reply)), label).toBe(true);
      bodies.push(withoutName(reply).toString('hex'));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('a nem tag Rendszeradmin is ugyanazt az elutasítást kapja (tartalmi jog csak tagként, D43)', async () => {
    const { base, userId } = await listen();
    const admin = await (ctx as TestContext).signIn('admin@example.test', 'system_admin');
    const { documentId } = fixture(userId); // az admin nem tagja
    const adminReply = await authenticate(await connect(base, admin.cookie), documentId);
    expect(isDenied(withoutName(adminReply))).toBe(true);
    // bájtra azonos a nem létező dokumentum elutasításával
    const missing = await authenticate(await connect(base, admin.cookie), randomUUID());
    expect(withoutName(adminReply).toString('hex')).toBe(withoutName(missing).toString('hex'));
  });

  it('a tag Rendszeradmin szerkeszthet (a tagság adja a jogot, nem a rendszerszerep)', async () => {
    const { base } = await listen();
    const admin = await (ctx as TestContext).signIn('admin@example.test', 'system_admin');
    const { documentId } = fixture(admin.userId);
    const reply = await authenticate(await connect(base, admin.cookie), documentId);
    expect(textOf(withoutName(reply))).toContain('read-write');
  });

  const states: ReviewState[] = ['draft', 'pending', 'changes_requested', 'approved'];
  const rows = states.flatMap((state) =>
    [false, true].map((closed) => ({
      state,
      closed,
      writable: (state === 'draft' || state === 'changes_requested') && !closed,
    })),
  );

  it.each(rows)(
    'review_state=$state, lezárt színtér=$closed: írható=$writable',
    async ({ state, closed, writable }) => {
      const { base, userId, cookie } = await listen();
      const f = fixture(userId, { reviewState: state });
      f.collab.setSpace(f.spaceId, { closed });
      const reply = await authenticate(await connect(base, cookie), f.documentId);
      expect(textOf(withoutName(reply))).toContain(writable ? 'read-write' : 'readonly');
    },
  );
});

describe('/collab perzisztencia', () => {
  it('állapot nélküli dokumentumot a documents.content-ből seedel', async () => {
    const { base, userId, cookie } = await listen();
    const { documentId } = fixture(userId, { content: 'régi szöveg' });
    const client = await connect(base, cookie);
    await authenticate(client, documentId);
    expect(await readText(client, documentId)).toBe('régi szöveg');
  });

  it('az újraseedelés nem kettőzi meg a szöveget, ha a kliens a régi seeddel csatlakozik vissza', async () => {
    const { base, userId, cookie } = await listen();
    const { collab, documentId } = fixture(userId, { content: 'régi szöveg' });
    // A kliens megkapja a seedet, majd a kapcsolat megszakad mentés nélkül: a szerver kiüríti a dokumentumot.
    const first = await connect(base, cookie);
    await authenticate(first, documentId);
    const kept = await readState(first, documentId);
    first.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(collab.saves).toHaveLength(0);

    // Újracsatlakozáskor a szerver újra seedel, a kliens elküldi a megtartott állapotát.
    const again = await connect(base, cookie);
    await authenticate(again, documentId);
    again.socket.send(updateMessage(documentId, kept));
    await again.next(isSyncStatus);
    expect(await readText(again, documentId)).toBe('régi szöveg');
  });

  it('a NUL karakter kimarad a materializált szövegből', async () => {
    const { base, userId, cookie } = await listen();
    const { collab, documentId } = fixture(userId);
    const writer = await connect(base, cookie);
    await authenticate(writer, documentId);
    writer.socket.send(updateMessage(documentId, editFor('a\u0000b')));
    await vi.waitFor(() => expect(collab.saves).toHaveLength(1), { timeout: 2_000 });
    expect(collab.document(documentId)?.content).toBe('ab');
  });

  it('a mentett Yjs-állapotot tölti be (a content nem számít)', async () => {
    const { base, userId, cookie } = await listen();
    const f = fixture(userId);
    f.collab.addDocument(f.documentId, f.spaceId, { content: 'régi', state: editFor('mentett') });
    const client = await connect(base, cookie);
    await authenticate(client, f.documentId);
    expect(await readText(client, f.documentId)).toBe('mentett');
  });

  it('a szerkesztést debounce után menti, és a friss betöltés ugyanazt a szöveget adja', async () => {
    const { base, userId, cookie } = await listen();
    const { collab, documentId } = fixture(userId);
    const writer = await connect(base, cookie);
    await authenticate(writer, documentId);
    writer.socket.send(updateMessage(documentId, editFor('szia')));
    await vi.waitFor(() => expect(collab.saves).toHaveLength(1), { timeout: 2_000 });
    expect(collab.document(documentId)?.content).toBe('szia');

    // Lezárt kapcsolat után a dokumentum kiürül a memóriából; az új kapcsolat az adattárból tölt.
    writer.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const reader = await connect(base, cookie);
    await authenticate(reader, documentId);
    expect(await readText(reader, documentId)).toBe('szia');
  });

  it('a csak olvasó kapcsolat módosítását nem alkalmazza és nem menti', async () => {
    const { base, userId, cookie } = await listen();
    const { collab, documentId } = fixture(userId, { reviewState: 'pending' });
    const client = await connect(base, cookie);
    await authenticate(client, documentId);
    client.socket.send(updateMessage(documentId, editFor('tiltott')));
    // A Hocuspocus SyncStatus(false)-szal nyugtáz: a módosítás nem került be.
    const ack = await client.next(isSyncStatus);
    expect([...withoutName(ack)]).toEqual([SYNC_STATUS, 0]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(collab.saves).toHaveLength(0);
    expect(collab.document(documentId)?.content).toBe('');
    expect(await readText(client, documentId)).toBe('');
  });

  it('a mentés pillanatában már nem írható dokumentumot nem írja (állapotváltás a szerkesztés alatt)', async () => {
    const { base, userId, cookie } = await listen({
      collabDebounceMs: 200,
      collabMaxDebounceMs: 400,
    });
    const { collab, documentId } = fixture(userId);
    const client = await connect(base, cookie);
    await authenticate(client, documentId);
    client.socket.send(updateMessage(documentId, editFor('elkésett')));
    await client.next(isSyncStatus); // a módosítás bekerült a memóriába
    collab.setReviewState(documentId, 'pending'); // review-ra küldték a debounce alatt
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(collab.saves).toHaveLength(0);
    expect(collab.document(documentId)?.content).toBe('');
  });
});
