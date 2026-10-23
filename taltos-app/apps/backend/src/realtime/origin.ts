import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendProblem } from '../http/problem.js';

/**
 * A WebSocket-upgrade kötelező `Origin`-ellenőrzése (B5 A1, D29): a böngésző a cookie-t
 * bármely oldalról küldött upgrade-hez csatolná, ezért idegen originről nem nyílik kapcsolat.
 */
export function originGuard(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const origin = request.headers.origin;
    if (origin === undefined || !allowed.has(origin)) {
      request.log.warn({ origin }, 'WebSocket-upgrade elutasítva: nem engedélyezett origin');
      await sendProblem(reply, 'forbidden', { detail: 'Nem engedélyezett origin.' });
    }
  };
}
