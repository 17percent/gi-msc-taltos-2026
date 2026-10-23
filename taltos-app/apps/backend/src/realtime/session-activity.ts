import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import type { AuthContext } from '../auth/guard.js';
import {
  TOUCH_INTERVAL_MS,
  type AuthSession,
  type SessionService,
} from '../auth/session-service.js';
import type { Clock } from '../auth/types.js';

/** A WebSocket-csatornák közös függőségei: origin-lista, auth-kapu és idő. */
export interface RealtimeDependencies {
  allowedOrigins: readonly string[];
  context: AuthContext;
  clock: Clock;
}

/** A WebSocket záráskódja, ha a munkamenet lejárt vagy visszavonódott (policy violation). */
export const WS_SESSION_ENDED = 1008;

/**
 * A WebSocket-forgalom a munkamenet aktivitása (NY10, B5 A1): a kliens üzenete ritkítva (legfeljebb percenként
 * egyszer) újraérvényesíti a munkamenetet és frissíti a `last_seen_at`-et. Ha közben lejárt, visszavonták vagy
 * az allowlistről levették, a kapcsolat bezárul. Az upgrade maga már hitelesített (az auth-kapu), ezért az első
 * ellenőrzés egy intervallummal később esedékes. A pong és a szerver pingje nem felhasználói aktivitás.
 * Korlát: a csendes (üzenetet nem küldő) kapcsolatot ez nem zárja be a lejáratkor, csak a következő üzenetnél.
 */
export function trackSessionActivity(
  socket: WebSocket,
  session: AuthSession,
  sessions: SessionService,
  clock: Clock,
  log: FastifyBaseLogger,
  intervalMs: number = TOUCH_INTERVAL_MS,
): void {
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
