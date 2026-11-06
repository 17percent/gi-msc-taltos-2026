import type { FastifyInstance } from 'fastify';
import {
  KIND_KEY_PATTERN,
  KIND_LABEL_MAX,
  TAG_NAME_MAX,
  TAG_NAME_MIN,
  displayTagName,
  normalizeTagName,
  type CreateKindRequest,
  type CreateTagRequest,
  type KindRef,
  type TagRef,
} from '@taltos/shared';
import type { Clock } from '../auth/types.js';
import { sendProblem } from '../http/problem.js';
import { authorizeSystem } from '../policy/authorize.js';
import { actorOf, sendFailure } from '../spaces/routes.js';
import type { TagStore } from './store.js';

export interface TagRouteDependencies {
  tags: TagStore;
  clock: Clock;
}

/**
 * A címkék és a fajták végpontjai (WP5a, B5 „Címkék, fajta, kapcsolatok”, D34, D58, D59). A címkelista és a javaslat
 * a hívó számára látható dokumentumokra szűrt (a tár a „látható dokumentumok” feltételén át, D44); a `POST /tags`
 * mindkét ágon (új és már létező címke) 200 `{ id, name }`, így nem árul el idegen színtérben használt címkét.
 */
export function registerTagRoutes(api: FastifyInstance, deps: TagRouteDependencies): void {
  const { tags, clock } = deps;

  api.get<{ Querystring: { q?: string } }>(
    '/tags',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { q: { type: 'string', maxLength: 256 } },
        },
      },
    },
    async (request, reply) => {
      if (!(await authorizeSystem(request, reply, 'tags.list'))) return reply;
      const { userId } = actorOf(request);
      const { q } = request.query;
      return q === undefined ? tags.listTags(userId) : tags.searchTags(userId, normalizeTagName(q));
    },
  );

  api.post<{ Body: CreateTagRequest }>(
    '/tags',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: {
              type: 'string',
              minLength: TAG_NAME_MIN,
              maxLength: TAG_NAME_MAX,
              pattern: '\\S',
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!(await authorizeSystem(request, reply, 'tag.create'))) return reply;
      const { name } = request.body;
      // Pl. csak összetett jelekből álló név: a normalizált alak üres, ilyen címke nem lehet.
      if (normalizeTagName(name) === '' || displayTagName(name) === '') {
        return sendProblem(reply, 'validation_error', { detail: 'A címkenév nem lehet üres.' });
      }
      const tag = await tags.createTag(actorOf(request), name, clock());
      return reply.code(200).send({ id: tag.id, name: tag.name } satisfies TagRef);
    },
  );

  api.get('/kinds', async (request, reply): Promise<KindRef[] | typeof reply> => {
    if (!(await authorizeSystem(request, reply, 'kinds.list'))) return reply;
    return tags.listKinds();
  });

  api.post<{ Body: CreateKindRequest }>(
    '/kinds',
    {
      schema: {
        body: {
          type: 'object',
          required: ['key', 'label'],
          additionalProperties: false,
          properties: {
            key: { type: 'string', pattern: KIND_KEY_PATTERN },
            label: { type: 'string', minLength: 1, maxLength: KIND_LABEL_MAX, pattern: '\\S' },
          },
        },
      },
    },
    async (request, reply) => {
      if (!(await authorizeSystem(request, reply, 'system.kinds.manage'))) return reply;
      const result = await tags.createKind(
        actorOf(request),
        { key: request.body.key, label: request.body.label.trim() },
        clock(),
      );
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(201).send(result.value satisfies KindRef);
    },
  );
}
