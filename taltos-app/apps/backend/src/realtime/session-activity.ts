import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import type { AuthContext } from '../auth/guard.js';
import { TOUCH_INTERVAL_MS, type AuthSession } from '../auth/session-service.js';
import type { Clock } from '../auth/types.js';
import { WS_SESSION_ENDED, type SocketRegistry } from './socket-registry.js';

/** A WebSocket-csatornák közös függőségei: origin-lista, auth-kapu és idő. */
export interface RealtimeDependencies {
  allowedOrigins: readonly string[];
  context: AuthContext;
  clock: Clock;
  /** A nyitott kapcsolatok nyilvántartása: visszavonáskor és az időzített ellenőrzésnél ez zár (appsec W-1). */
  registry: SocketRegistry;
}

/**
 * A WebSocket-forgalom a munkamenet aktivitása (NY10, B5 A1): a kliens üzenete ritkítva (legfeljebb percenként
 * egyszer) újraérvényesíti a munkamenetet és frissíti a `last_seen_at`-et. Ha közben lejárt, visszavonták vagy
 * az allowlistről levették, a kapcsolat bezárul. Az upgrade maga már hitelesített (az auth-kapu), ezért az első
 * ellenőrzés egy intervallummal később esedékes. A pong és a szerver pingje nem felhasználói aktivitás.
 * A csendes (üzenetet nem küldő) kapcsolatot nem ez zárja: a kapcsolat a `SocketRegistry`-ben él, amely visszavonáskor
 * azonnal, egyébként időzítve (lejárat, másik folyamatban történt visszavonás) zár.
 */
export function trackSessionActivity(
  socket: WebSocket,
  session: AuthSession,
  deps: Pick<RealtimeDependencies, 'context' | 'clock' | 'registry'>,
  log: FastifyBaseLogger,
  intervalMs: number = TOUCH_INTERVAL_MS,
): void {
  const { clock } = deps;
  const sessions = deps.context.sessions;
  deps.registry.add(session.id, socket);
  let lastCheck = clock().getTime();
  let checking = false;

  socket.on('message', () => {
    const now = clock().getTime();
    if (checking || now - lastCheck < intervalMs) return;
    checking = true;
    lastCheck = now;
    sessions
      .recheck(session.id)
      .then((valid) => {
        if (!valid) socket.close(WS_SESSION_ENDED, 'session_ended');
      })
      .catch((error: unknown) => {
        log.error({ err: error }, 'a WebSocket-munkamenet ellenőrzése sikertelen');
        socket.close(1011, 'internal_error');
      })
      .finally(() => {
        checking = false;
      });
  });
}
