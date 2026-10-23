import type { FastifyInstance } from 'fastify';
import { NOTIFICATIONS_PATH } from '@taltos/shared';
import { originGuard } from './origin.js';

/**
 * `/ws/notifications` — élő értesítés és dashboard-frissítés (D46, A12).
 *
 * WP0-váz: a csatorna fogad, de még nem küld semmit. Az üzenetformátum, a session-hitelesítés
 * és a címzett-szűrés a WP2 és a WP23 (dashboard) feladata.
 */
export function registerNotifications(
  app: FastifyInstance,
  allowedOrigins: readonly string[],
): void {
  app.get(
    NOTIFICATIONS_PATH,
    { websocket: true, preValidation: originGuard(allowedOrigins) },
    (socket) => {
      // Kliensüzenetet ezen a csatornán nem várunk; a kapcsolat élettartamát a kliens zárása adja.
      socket.on('message', () => undefined);
    },
  );
}
