import type { FastifyInstance } from 'fastify';
import { NOTIFICATIONS_PATH } from '@taltos/shared';
import { sessionUpgradeGuard } from '../auth/guard.js';
import { originGuard } from './origin.js';
import { trackSessionActivity, type RealtimeDependencies } from './session-activity.js';

/**
 * `/ws/notifications` — élő értesítés és dashboard-frissítés (D46, A12).
 *
 * Az upgrade kapuja (WP2, appsec C1): `Origin`, majd érvényes munkamenet és allowlist (401/403 az upgrade előtt).
 * WP0-váz: a csatorna fogad, de még nem küld semmit; az üzenetformátum és a címzett-szűrés a WP23 feladata.
 */
export function registerNotifications(app: FastifyInstance, deps: RealtimeDependencies): void {
  app.get(
    NOTIFICATIONS_PATH,
    {
      websocket: true,
      preValidation: [originGuard(deps.allowedOrigins), sessionUpgradeGuard(deps.context)],
    },
    (socket, request) => {
      if (request.auth !== null) {
        trackSessionActivity(socket, request.auth, deps, request.log);
      }
      // Kliensüzenetet ezen a csatornán nem várunk (a munkamenet-aktivitást a tracker számolja).
    },
  );
}
