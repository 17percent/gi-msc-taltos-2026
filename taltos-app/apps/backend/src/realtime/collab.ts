import { Hocuspocus } from '@hocuspocus/server';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData } from 'ws';
import * as Y from 'yjs';
import { COLLAB_DOCUMENT_NAME_PATTERN, COLLAB_PATH, COLLAB_TEXT_FIELD } from '@taltos/shared';
import { sessionUpgradeGuard } from '../auth/guard.js';
import { isWritable, type CollabStore } from './collab-store.js';
import { originGuard } from './origin.js';
import { trackSessionActivity, type RealtimeDependencies } from './session-activity.js';

/** A Hocuspocus-debounce alapja (D29 „1. szintű mentés”): 2 mp csend után ment, de legfeljebb 10 mp-enként. */
const STORE_DEBOUNCE_MS = 2_000;
const STORE_MAX_DEBOUNCE_MS = 10_000;

/** Minden elutasítás ugyanez: a kliens nem tudhatja, hogy a dokumentum nem létezik vagy csak nem tagja (nincs szivárgás). */
const DENIED = 'permission-denied';

/** A kapcsolat környezete: az upgrade-nél hitelesített felhasználó (a sütit nem elemezzük újra). */
interface CollabContext {
  userId: string;
}

export interface CollabOptions {
  store: CollabStore;
  /** A mentés debounce-a (alap: 2 mp / 10 mp); a tesztek rövidítik. */
  debounceMs?: number;
  maxDebounceMs?: number;
}

/**
 * `/collab` — Hocuspocus a Fastify-jal közös Node-folyamatban és HTTP-szerveren (D29, A12).
 *
 * Az upgrade kapuja (WP2, appsec C1): `Origin`, majd érvényes munkamenet és allowlist; a hiányuk 403/401
 * válasz az upgrade előtt. Az `onAuthenticate` ezen felül aktív színtér-tagságot kér.
 * IDEIGLENES (WP3 spike): a tagság- és állapot-ellenőrzés közvetlen lekérdezés; a WP4 `can(user, action, resource)`
 * policy-ja váltja le, és a „látható dokumentumok” lekérdezés-építőre kerül át.
 * Perzisztencia: betöltés a `document_collab_state`-ből (nincs sor: a `documents.content`-ből seedelünk), mentés
 * debounce-szal egy tranzakcióban; revízió, checkpoint és esemény a WP6-é.
 */
export function registerCollab(
  app: FastifyInstance,
  deps: RealtimeDependencies,
  options: CollabOptions,
): Hocuspocus<CollabContext> {
  const { store } = options;
  /** A futó mentések: leálláskor megvárjuk őket, mielőtt az adatbázis-kapcsolat bezárul. */
  const inflight = new Set<Promise<void>>();

  const hocuspocus = new Hocuspocus<CollabContext>({
    quiet: true,
    debounce: options.debounceMs ?? STORE_DEBOUNCE_MS,
    maxDebounce: options.maxDebounceMs ?? STORE_MAX_DEBOUNCE_MS,

    async onAuthenticate({ documentName, context, connectionConfig }) {
      // A név alakját a lekérdezés előtt ellenőrizzük (UUID): idegen név az adatbázist sem éri el.
      if (!COLLAB_DOCUMENT_NAME_PATTERN.test(documentName)) throw new Error(DENIED);
      const userId = (context as Partial<CollabContext>).userId;
      if (userId === undefined) throw new Error(DENIED);
      const access = await store.findAccess(userId, documentName);
      if (access === undefined) throw new Error(DENIED);
      // Nem írható (review-ra vár, jóváhagyott, lezárt színtér): a kapcsolat csak olvasó, a Hocuspocus eldobja a módosításait.
      connectionConfig.readOnly = !isWritable(access);
    },

    async onLoadDocument({ documentName }) {
      const content = await store.loadContent(documentName);
      if (content === undefined) throw new Error(DENIED); // a hitelesítés óta törölték
      if (content.state !== null) return content.state;
      // Még nincs Yjs-állapot: a Y.Text a dokumentum szövegéből indul.
      const seeded = new Y.Doc();
      if (content.seed) seeded.getText(COLLAB_TEXT_FIELD).insert(0, content.seed);
      return Y.encodeStateAsUpdate(seeded);
    },

    onStoreDocument({ documentName, document }) {
      const run = (async () => {
        try {
          const saved = await store.saveContent(
            documentName,
            Y.encodeStateAsUpdate(document),
            document.getText(COLLAB_TEXT_FIELD).toJSON(),
            deps.clock(),
          );
          if (!saved) {
            app.log.warn(
              { documentId: documentName },
              'a dokumentum már nem írható: a mentés elmarad',
            );
          }
        } catch (error) {
          // Az újradobás miatt a dokumentum a memóriában marad (a Hocuspocus nem dobja el mentetlenül).
          app.log.error(
            { err: error, documentId: documentName },
            'a dokumentum mentése nem sikerült',
          );
          throw error;
        }
      })();
      inflight.add(run);
      const done = () => inflight.delete(run);
      run.then(done, done);
      return run;
    },
  });

  app.get(
    COLLAB_PATH,
    {
      websocket: true,
      preValidation: [originGuard(deps.allowedOrigins), sessionUpgradeGuard(deps.context)],
    },
    (socket, request) => {
      const auth = request.auth;
      if (auth === null) {
        socket.close(1008, 'unauthenticated'); // a kapu ezt kizárja; védőháló
        return;
      }
      trackSessionActivity(socket, auth, deps, request.log);
      const connection = hocuspocus.handleConnection(socket, toWebRequest(request), {
        userId: auth.userId,
      });
      socket.on('message', (data: RawData) => connection.handleMessage(toUint8Array(data)));
      socket.on('pong', () => connection.touch());
      socket.on('close', (code: number, reason: Buffer) => {
        connection.handleClose({ code, reason: reason.toString() });
      });
    },
  );

  // Az onClose hookok fordított sorrendben futnak (main.ts: előbb pool.end), ezért a flush a preClose-ban van.
  app.addHook('preClose', async () => {
    hocuspocus.flushPendingStores();
    await new Promise<void>((resolve) => setImmediate(resolve)); // a flush hookjai elindulhassanak
    await Promise.allSettled([...inflight]);
  });

  return hocuspocus;
}

/** A Hocuspocus Fetch API `Request`-et vár; a fejlécek és a query a Node-kérésből jönnek. */
function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return new Request(new URL(request.url, 'http://localhost'), { headers });
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
