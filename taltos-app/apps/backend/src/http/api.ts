import type { FastifyInstance, FastifyRequest } from 'fastify';
import { API_PREFIX, type MeResponse } from '@taltos/shared';
import {
  authenticateRequest,
  isMutating,
  verifyMutation,
  type AuthContext,
} from '../auth/guard.js';
import type { AuthSession } from '../auth/session-service.js';
import type { AuthStore } from '../auth/types.js';
import { sendProblem } from './problem.js';

export interface ApiDependencies {
  context: AuthContext;
  store: AuthStore;
}

/** A kapu után a kérésnek van munkamenete; hiánya programozási hiba (a kapu nélküli útvonal), nem kliens-hiba. */
export function requireAuth(request: FastifyRequest): AuthSession {
  if (request.auth === null) throw new Error('Az útvonal az auth-kapun kívül fut.');
  return request.auth;
}

const ME_SCHEMA = {
  response: {
    200: {
      type: 'object',
      required: ['id', 'displayName', 'email', 'avatarUrl', 'systemRole', 'spaces', 'csrfToken'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        displayName: { type: 'string' },
        email: { type: 'string' },
        avatarUrl: { type: ['string', 'null'] },
        systemRole: { enum: ['user', 'system_admin'] },
        csrfToken: { type: 'string' },
        spaces: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'type', 'role'],
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { enum: ['general', 'team', 'project'] },
              role: { enum: ['author', 'space_manager'] },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * A `/api/v1` hatókör: minden kérés (az ismeretlen útvonalak is) átmegy az auth-kapun (munkamenet, allowlist,
 * mutáló kérésen Origin + CSRF), a válaszok `no-store`-ok. A későbbi csomagok az itt kapott példányra
 * regisztrálják az útvonalaikat, így a kapu alól nem lehet kibújni.
 */
export function registerApi(app: FastifyInstance, deps: ApiDependencies): void {
  const { context, store } = deps;

  void app.register(
    (api, _options, done) => {
      api.addHook('onRequest', async (request, reply) => {
        void reply.header('cache-control', 'no-store');
        if (!(await authenticateRequest(context, request, reply))) return;
        const session = requireAuth(request);
        if (isMutating(request.method)) await verifyMutation(context, request, reply, session);
      });

      // A hatókör saját 404-kezelője, hogy a kapu a nem létező /api/v1 útvonalakra is lefusson.
      api.setNotFoundHandler((_request, reply) => sendProblem(reply, 'not_found'));

      api.get('/me', { schema: ME_SCHEMA }, async (request): Promise<MeResponse> => {
        const session = requireAuth(request);
        return {
          id: session.userId,
          displayName: session.displayName,
          email: session.email ?? '',
          avatarUrl: session.avatarUrl,
          systemRole: session.systemRole,
          spaces: await store.spacesOf(session.userId),
          csrfToken: session.csrfToken,
        };
      });
      done();
    },
    { prefix: API_PREFIX },
  );
}
