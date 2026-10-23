import { Hocuspocus } from '@hocuspocus/server';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData } from 'ws';
import { COLLAB_PATH } from '@taltos/shared';
import { sessionUpgradeGuard } from '../auth/guard.js';
import { originGuard } from './origin.js';
import { trackSessionActivity, type RealtimeDependencies } from './session-activity.js';

/**
 * `/collab` — Hocuspocus a Fastify-jal közös Node-folyamatban és HTTP-szerveren (D29, A12).
 *
 * Az upgrade kapuja (WP2, appsec C1): `Origin`, majd érvényes munkamenet és allowlist; a hiányuk 403/401
 * válasz az upgrade előtt. Dokumentumot a csatorna még nem ad ki: az `onAuthenticate` alapból elutasít,
 * a tagság-ellenőrzés (a `can()` policy-n át) a WP3/WP6 feladata; a perzisztencia a WP3-é.
 */
export function registerCollab(app: FastifyInstance, deps: RealtimeDependencies): Hocuspocus {
  const hocuspocus = new Hocuspocus({
    quiet: true,
    onAuthenticate: () =>
      Promise.reject(new Error('A közös szerkesztés hitelesítése még nincs bekötve (WP3/WP6).')),
  });

  app.get(
    COLLAB_PATH,
    {
      websocket: true,
      preValidation: [originGuard(deps.allowedOrigins), sessionUpgradeGuard(deps.context)],
    },
    (socket, request) => {
      if (request.auth !== null) {
        trackSessionActivity(socket, request.auth, deps.context.sessions, deps.clock, request.log);
      }
      const connection = hocuspocus.handleConnection(socket, toWebRequest(request));
      socket.on('message', (data: RawData) => connection.handleMessage(toUint8Array(data)));
      socket.on('pong', () => connection.touch());
      socket.on('close', (code: number, reason: Buffer) => {
        connection.handleClose({ code, reason: reason.toString() });
      });
    },
  );

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
