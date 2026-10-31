import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  SPACE_COLOR_PALETTE,
  SPACE_ROLES,
  type CreateMembershipRequest,
  type CreateSpaceRequestRequest,
  type MembershipDecisionResult,
  type MembershipRequestDecision,
  type RequestCreated,
  type SpaceRequestDecision,
  type SpaceRequestDecisionResult,
} from '@taltos/shared';
import { requireAuth } from '../http/api.js';
import { sendProblem } from '../http/problem.js';
import { authorizeSpace, authorizeSystem } from '../policy/authorize.js';
import type { Actor } from '../policy/targets.js';
import type { SpaceRouteDependencies } from './routes.js';

const uuid = { type: 'string', format: 'uuid' } as const;
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;

const actorOf = (request: Parameters<typeof requireAuth>[0]): Actor => {
  const session = requireAuth(request);
  return { userId: session.userId, systemRole: session.systemRole };
};

const invalid = (reply: FastifyReply, path: string, message: string): FastifyReply =>
  sendProblem(reply, 'validation_error', { details: { errors: [{ path, message }] } });

/**
 * A felvételi és a projekt-tér kérésének végpontjai (B5 „Színterek és tagság”, D43, D44, D56). A jogosultság a `can()`-en
 * át megy (`space.membership.request|decide`, `space_request.create|decide`); a tár a zár alatt újraellenőrzi a
 * versenyérzékeny feltételeket. Értesítés nincs (WP10), a listanézet a WP23.
 */
export function registerRequestRoutes(api: FastifyInstance, deps: SpaceRouteDependencies): void {
  const { access, spaces, clock } = deps;

  // ── felvételi kérés ──────────────────────────────────────────────────────────
  api.post<{ Params: { id: string }; Body: CreateMembershipRequest }>(
    '/spaces/:id/membership-requests',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            viaDocumentId: uuid,
            message: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply): Promise<RequestCreated | FastifyReply> => {
      if (
        !(await authorizeSpace(
          access,
          request,
          reply,
          'space.membership.request',
          request.params.id,
        ))
      ) {
        return reply;
      }
      const result = await spaces.createMembershipRequest(
        actorOf(request),
        request.params.id,
        request.body,
        clock(),
      );
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(201).send(result.value);
    },
  );

  api.post<{ Params: { id: string }; Body: MembershipRequestDecision }>(
    '/membership-requests/:id/decision',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['approve'],
          additionalProperties: false,
          properties: { approve: { type: 'boolean' }, role: { enum: [...SPACE_ROLES] } },
        },
      },
    },
    async (request, reply): Promise<MembershipDecisionResult | FastifyReply> => {
      const found = await spaces.getMembershipRequest(request.params.id);
      if (found === undefined) return sendProblem(reply, 'not_found');
      if (
        !(await authorizeSpace(access, request, reply, 'space.membership.decide', found.spaceId))
      ) {
        return reply;
      }
      if (!request.body.approve && request.body.role !== undefined) {
        return invalid(reply, '/body/role', 'elutasításnál a szerep nem adható meg');
      }
      const result = await spaces.decideMembershipRequest(
        actorOf(request),
        request.params.id,
        request.body,
        clock(),
      );
      return result.ok ? result.value : sendFailure(reply, result);
    },
  );

  // ── projekt-tér kérése ───────────────────────────────────────────────────────
  api.post<{ Body: CreateSpaceRequestRequest }>(
    '/space-requests',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'purpose', 'proposedManagerId'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80, pattern: '\\S' },
            purpose: { type: 'string', maxLength: 2000 },
            proposedManagerId: uuid,
          },
        },
      },
    },
    async (request, reply): Promise<RequestCreated | FastifyReply> => {
      if (!(await authorizeSystem(request, reply, 'space_request.create'))) return reply;
      const result = await spaces.createSpaceRequest(actorOf(request), request.body, clock());
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(201).send(result.value);
    },
  );

  api.post<{ Params: { id: string }; Body: { approve: boolean; color?: string } }>(
    '/space-requests/:id/decision',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['approve'],
          additionalProperties: false,
          properties: {
            approve: { type: 'boolean' },
            color: { enum: [...SPACE_COLOR_PALETTE] },
          },
        },
      },
    },
    async (request, reply): Promise<SpaceRequestDecisionResult | FastifyReply> => {
      if (!(await authorizeSystem(request, reply, 'space_request.decide'))) return reply;
      const { approve, color } = request.body;
      // Jóváhagyáskor a szín kötelező (a palettát a séma őrzi); elutasításnál nincs indoklás és szín (D56).
      let decision: SpaceRequestDecision;
      if (approve) {
        if (color === undefined) return invalid(reply, '/body/color', 'jóváhagyáskor kötelező');
        decision = { approve: true, color: color as (typeof SPACE_COLOR_PALETTE)[number] };
      } else {
        if (color !== undefined) {
          return invalid(reply, '/body/color', 'elutasításnál nem adható meg');
        }
        decision = { approve: false };
      }
      const result = await spaces.decideSpaceRequest(
        actorOf(request),
        request.params.id,
        decision,
        clock(),
      );
      return result.ok ? result.value : sendFailure(reply, result);
    },
  );
}

function sendFailure(
  reply: FastifyReply,
  failure: { code: Parameters<typeof sendProblem>[1]; detail?: string },
): FastifyReply {
  return sendProblem(
    reply,
    failure.code,
    failure.detail === undefined ? {} : { detail: failure.detail },
  );
}
