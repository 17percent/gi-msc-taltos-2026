import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  SPACE_COLOR_PALETTE,
  SPACE_ROLES,
  SYSTEM_ROLES,
  type AddMemberRequest,
  type AdminHandoverRequest,
  type AdminHandoverResponse,
  type AdminUser,
  type ChangeRoleRequest,
  type ChangeSystemRoleRequest,
  type CreateSpaceRequest,
  type SpaceDetail,
  type SpaceMember,
  type SpaceSummary,
  type TransferOwnershipRequest,
  type UpdateSpaceRequest,
  type UserSearchResponse,
} from '@taltos/shared';
import type { Clock } from '../auth/types.js';
import { requireAuth } from '../http/api.js';
import { sendProblem } from '../http/problem.js';
import {
  authorizeDocument,
  authorizeLoadedSpace,
  authorizeSpace,
  authorizeSystem,
} from '../policy/authorize.js';
import type { AccessStore } from '../policy/access-store.js';
import { isSpaceManager } from '../policy/policy.js';
import type { Actor } from '../policy/targets.js';
import { registerRequestRoutes } from './request-routes.js';
import type { SpaceStore, StoreFailure } from './store.js';

export interface SpaceRouteDependencies {
  access: AccessStore;
  spaces: SpaceStore;
  clock: Clock;
}

/** A `GET /users?q=` alsó és felső korlátja (D56). */
export const USER_SEARCH_MIN_CHARS = 2;
export const USER_SEARCH_LIMIT = 10;

const uuid = { type: 'string', format: 'uuid' } as const;
const color = { enum: [...SPACE_COLOR_PALETTE] } as const;
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;
const memberParams = {
  type: 'object',
  required: ['id', 'userId'],
  properties: { id: uuid, userId: uuid },
} as const;

const actorOf = (request: Parameters<typeof requireAuth>[0]): Actor => {
  const session = requireAuth(request);
  return { userId: session.userId, systemRole: session.systemRole };
};

/** Az üzleti hiba Problem Details-szé fordítása (a kód és a státusz a B5 katalógus szerint párban jár). */
function sendFailure(reply: FastifyReply, failure: StoreFailure): FastifyReply {
  return sendProblem(
    reply,
    failure.code,
    failure.detail === undefined ? {} : { detail: failure.detail },
  );
}

/**
 * A színterek, a tagság, a felhasználókeresés, az adminisztráció és a tulajdonjog-átadás végpontjai (B5, D43, D55,
 * D56). Minden döntés az `authorize*` segédeken át a `can()`-hez megy; a kezelő a betöltött célponttal dolgozik.
 * A mutáló kérések az `/api/v1` kapu mögött futnak (munkamenet, Origin, CSRF).
 */
export function registerSpaceRoutes(api: FastifyInstance, deps: SpaceRouteDependencies): void {
  const { access, spaces, clock } = deps;

  // ── színterek ────────────────────────────────────────────────────────────────
  api.get('/spaces', async (request): Promise<SpaceSummary[]> => {
    return spaces.listSpaces(actorOf(request));
  });

  api.post<{ Body: CreateSpaceRequest }>(
    '/spaces',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'type', 'description', 'color', 'initialManagerId'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80, pattern: '\\S' },
            type: { enum: ['team', 'project'] },
            description: { type: 'string', maxLength: 2000 },
            color,
            initialManagerId: uuid,
          },
        },
      },
    },
    async (request, reply) => {
      if (!(await authorizeSystem(request, reply, 'space.create'))) return reply;
      const result = await spaces.createSpace(actorOf(request), request.body, clock());
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(201).send(result.value satisfies SpaceDetail);
    },
  );

  api.get<{ Params: { id: string } }>(
    '/spaces/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      if (!(await authorizeSpace(access, request, reply, 'space.view', request.params.id)))
        return reply;
      const detail = await spaces.getSpace(request.params.id);
      return detail === undefined ? sendProblem(reply, 'not_found') : detail;
    },
  );

  api.patch<{ Params: { id: string }; Body: UpdateSpaceRequest }>(
    '/spaces/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80, pattern: '\\S' },
            description: { type: 'string', maxLength: 2000 },
            color,
          },
        },
      },
    },
    async (request, reply) => {
      const target = await authorizeSpace(
        access,
        request,
        reply,
        'space.update',
        request.params.id,
      );
      if (target === undefined) return reply;
      // A nevet csak a Rendszeradmin módosíthatja (D56); a típus nem változtatható (nincs a törzsben).
      if (
        request.body.name !== undefined &&
        !(await authorizeLoadedSpace(access, request, reply, 'space.rename', target))
      ) {
        return reply;
      }
      const result = await spaces.updateSpace(
        actorOf(request),
        request.params.id,
        request.body,
        clock(),
      );
      return result.ok ? result.value : sendFailure(reply, result);
    },
  );

  api.post<{ Params: { id: string } }>(
    '/spaces/:id/close',
    { schema: { params: idParams } },
    async (request, reply) => {
      if (!(await authorizeSpace(access, request, reply, 'space.close', request.params.id)))
        return reply;
      const result = await spaces.closeSpace(actorOf(request), request.params.id, clock());
      if (!result.ok) return sendFailure(reply, result);
      // Már lezárt tér újbóli lezárása is 200 (idempotens, D56).
      const detail = await spaces.getSpace(request.params.id);
      return detail === undefined ? sendProblem(reply, 'not_found') : detail;
    },
  );

  // ── tagság ───────────────────────────────────────────────────────────────────
  api.get<{ Params: { id: string } }>(
    '/spaces/:id/members',
    { schema: { params: idParams } },
    async (request, reply): Promise<SpaceMember[] | FastifyReply> => {
      if (
        !(await authorizeSpace(access, request, reply, 'space.members.view', request.params.id))
      ) {
        return reply;
      }
      return spaces.listMembers(request.params.id);
    },
  );

  const roleEnum = { enum: [...SPACE_ROLES] } as const;

  api.post<{ Params: { id: string }; Body: AddMemberRequest }>(
    '/spaces/:id/members',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['userId', 'role'],
          additionalProperties: false,
          properties: { userId: uuid, role: roleEnum },
        },
      },
    },
    async (request, reply) => {
      if (!(await authorizeSpace(access, request, reply, 'space.members.add', request.params.id))) {
        return reply;
      }
      const result = await spaces.addMember(
        actorOf(request),
        request.params.id,
        request.body,
        clock(),
      );
      return result.ok ? reply.code(201).send(result.value) : sendFailure(reply, result);
    },
  );

  api.patch<{ Params: { id: string; userId: string }; Body: ChangeRoleRequest }>(
    '/spaces/:id/members/:userId',
    {
      schema: {
        params: memberParams,
        body: {
          type: 'object',
          required: ['role'],
          additionalProperties: false,
          properties: { role: roleEnum },
        },
      },
    },
    async (request, reply) => {
      if (
        !(await authorizeSpace(access, request, reply, 'space.members.role', request.params.id))
      ) {
        return reply;
      }
      const result = await spaces.changeRole(
        actorOf(request),
        request.params.id,
        request.params.userId,
        request.body.role,
        clock(),
      );
      return result.ok ? result.value : sendFailure(reply, result);
    },
  );

  api.delete<{ Params: { id: string; userId: string } }>(
    '/spaces/:id/members/:userId',
    { schema: { params: memberParams } },
    async (request, reply) => {
      if (
        !(await authorizeSpace(access, request, reply, 'space.members.remove', request.params.id))
      ) {
        return reply;
      }
      const result = await spaces.removeMember(
        actorOf(request),
        request.params.id,
        request.params.userId,
        clock(),
      );
      return result.ok ? reply.code(204).send() : sendFailure(reply, result);
    },
  );

  // ── felhasználókeresés ───────────────────────────────────────────────────────
  api.get<{ Querystring: { q: string } }>(
    '/users',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: { q: { type: 'string', minLength: USER_SEARCH_MIN_CHARS, maxLength: 100 } },
        },
      },
    },
    async (request, reply): Promise<UserSearchResponse | FastifyReply> => {
      if (!(await authorizeSystem(request, reply, 'users.search'))) return reply;
      const q = request.query.q.trim();
      if (q.length < USER_SEARCH_MIN_CHARS) {
        return sendProblem(reply, 'validation_error', {
          details: {
            errors: [
              {
                path: '/querystring/q',
                message: `legalább ${USER_SEARCH_MIN_CHARS} karakter kell`,
              },
            ],
          },
        });
      }
      return spaces.searchUsers(q, USER_SEARCH_LIMIT);
    },
  );

  // ── adminisztráció ───────────────────────────────────────────────────────────
  api.get('/admin/users', async (request, reply): Promise<AdminUser[] | FastifyReply> => {
    if (!(await authorizeSystem(request, reply, 'system.users.view'))) return reply;
    return spaces.listAdminUsers();
  });

  api.put<{ Params: { id: string }; Body: ChangeSystemRoleRequest }>(
    '/admin/users/:id/system-role',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['systemRole'],
          additionalProperties: false,
          properties: { systemRole: { enum: [...SYSTEM_ROLES] } },
        },
      },
    },
    async (request, reply) => {
      if (!(await authorizeSystem(request, reply, 'system.role.change'))) return reply;
      const result = await spaces.changeSystemRole(
        actorOf(request),
        request.params.id,
        request.body.systemRole,
        clock(),
      );
      return result.ok ? result.value : sendFailure(reply, result);
    },
  );

  api.post<{ Params: { id: string }; Body: AdminHandoverRequest }>(
    '/admin/users/:id/handover',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['spaceId', 'newOwnerId'],
          additionalProperties: false,
          properties: { spaceId: uuid, newOwnerId: uuid },
        },
      },
    },
    async (request, reply): Promise<AdminHandoverResponse | FastifyReply> => {
      if (!(await authorizeSystem(request, reply, 'system.users.handover'))) return reply;
      const result = await spaces.adminHandover(
        actorOf(request),
        { userId: request.params.id, ...request.body },
        clock(),
      );
      return result.ok ? result.value : sendFailure(reply, result);
    },
  );

  // ── tulajdonjog-átadás (D55) ─────────────────────────────────────────────────
  api.put<{ Params: { id: string }; Body: TransferOwnershipRequest }>(
    '/documents/:id/owner',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['userId'],
          additionalProperties: false,
          properties: { userId: uuid },
        },
      },
    },
    async (request, reply) => {
      const target = await authorizeDocument(
        access,
        request,
        reply,
        'document.owner.transfer',
        request.params.id,
      );
      if (target === undefined) return reply;
      const result = await spaces.transferOwnership(
        actorOf(request),
        {
          documentId: request.params.id,
          newOwnerId: request.body.userId,
          actorIsManager: isSpaceManager(target.space),
        },
        clock(),
      );
      return result.ok ? reply.code(204).send() : sendFailure(reply, result);
    },
  );

  // ── felvételi és projekt-tér kérések (D44, D56) ──────────────────────────────
  registerRequestRoutes(api, deps);
}
