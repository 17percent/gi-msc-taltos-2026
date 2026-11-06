import type { FastifyInstance, FastifyRequest } from 'fastify';
import { API_PREFIX, type MeResponse, type SetCurrentSpaceRequest } from '@taltos/shared';
import {
  authenticateRequest,
  isMutating,
  verifyMutation,
  type AuthContext,
} from '../auth/guard.js';
import type { AuthSession } from '../auth/session-service.js';
import { resolveCurrentSpaceId } from '../auth/current-space.js';
import type { AuthStore } from '../auth/types.js';
import { authorizeSpace } from '../policy/authorize.js';
import { registerDocumentRoutes, type DocumentRouteDependencies } from '../documents/routes.js';
import { registerSpaceRoutes, type SpaceRouteDependencies } from '../spaces/routes.js';
import { registerTagRoutes, type TagRouteDependencies } from '../tags/routes.js';
import { sendProblem } from './problem.js';

export interface ApiDependencies {
  context: AuthContext;
  store: AuthStore;
  /** A színterek, a tagság és az adminisztráció végpontjainak függőségei (WP4a). */
  spaceRoutes: SpaceRouteDependencies;
  /** A dokumentum-mag végpontjainak függőségei (WP5a). */
  documentRoutes: DocumentRouteDependencies;
  /** A címkék és a fajták végpontjainak függőségei (WP5a). */
  tagRoutes: TagRouteDependencies;
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
      required: [
        'id',
        'displayName',
        'email',
        'avatarUrl',
        'systemRole',
        'spaces',
        'currentSpaceId',
        'csrfToken',
      ],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        displayName: { type: 'string' },
        email: { type: 'string' },
        avatarUrl: { type: ['string', 'null'] },
        systemRole: { enum: ['user', 'system_admin'] },
        csrfToken: { type: 'string' },
        currentSpaceId: { type: ['string', 'null'] },
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
        // A tárolt aktuális tér a munkamenet-sorral jön (nincs extra lekérdezés), az érvényesítés a tagságlistán.
        const spaces = await store.spacesOf(session.userId);
        return {
          id: session.userId,
          displayName: session.displayName,
          email: session.email ?? '',
          avatarUrl: session.avatarUrl,
          systemRole: session.systemRole,
          spaces,
          currentSpaceId: resolveCurrentSpaceId(session.currentSpaceId, spaces),
          csrfToken: session.csrfToken,
        };
      });

      // D57: privát beállítás (nem naplózott, mint a kedvenc). Csak aktív tagság; a Rendszeradmin tagság nélkül nem
      // választhat (a `space.content.read` a nem tag adminnak is `not_space_member`); lezárt tér választható (olvasás).
      api.put<{ Body: SetCurrentSpaceRequest }>(
        '/me/current-space',
        {
          schema: {
            body: {
              type: 'object',
              required: ['spaceId'],
              additionalProperties: false,
              properties: { spaceId: { type: 'string', format: 'uuid' } },
            },
          },
        },
        async (request, reply) => {
          const { spaceId } = request.body;
          const target = await authorizeSpace(
            deps.spaceRoutes.access,
            request,
            reply,
            'space.content.read',
            spaceId,
          );
          if (target === undefined) return reply;
          await store.setCurrentSpace(requireAuth(request).userId, spaceId);
          return reply.code(204).send();
        },
      );
      registerSpaceRoutes(api, deps.spaceRoutes);
      registerDocumentRoutes(api, deps.documentRoutes);
      registerTagRoutes(api, deps.tagRoutes);
      done();
    },
    { prefix: API_PREFIX },
  );
}
