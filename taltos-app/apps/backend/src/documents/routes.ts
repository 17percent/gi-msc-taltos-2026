import type { FastifyInstance } from 'fastify';
import {
  DOCUMENT_TITLE_MAX,
  NON_BLANK_NO_NUL_PATTERN,
  NO_NUL_PATTERN,
  type CreateDocumentRequest,
  type DocumentDetail,
} from '@taltos/shared';
import type { Clock } from '../auth/types.js';
import { sendProblem } from '../http/problem.js';
import type { AccessStore } from '../policy/access-store.js';
import { authorizeDocument, authorizeSpace } from '../policy/authorize.js';
import { actorOf, sendFailure } from '../spaces/routes.js';
import type { DocumentStore } from './store.js';

export interface DocumentRouteDependencies {
  access: AccessStore;
  documents: DocumentStore;
  clock: Clock;
  /** Egy dokumentum nyitott `/collab`-kapcsolatainak azonnali bontása (a piszkozat eldobása után, D59). */
  closeCollabDocument: (documentId: string) => void;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;

/** A címkék száma egy kérésben: védőkorlát a túlméretes kérések ellen (a WP5a feltevése, a napló nem rögzít). */
const TAG_IDS_MAX = 50;

/**
 * A dokumentum-mag végpontjai (WP5a, B5 „Dokumentumok”): létrehozás üresen és duplikálással, a minimális olvasás és a
 * piszkozat-eldobás. Minden döntés az `authorize*` segédeken át a `can()`-hez megy; az olvasás a láthatósági
 * feltételen át (a `DocumentStore.getDocument`). A mutáló kérések az `/api/v1` kapu mögött futnak (munkamenet, Origin, CSRF).
 */
export function registerDocumentRoutes(
  api: FastifyInstance,
  deps: DocumentRouteDependencies,
): void {
  const { access, documents, clock } = deps;

  api.post<{ Body: CreateDocumentRequest }>(
    '/documents',
    {
      schema: {
        body: {
          type: 'object',
          required: ['spaceId', 'title', 'kind'],
          additionalProperties: false,
          properties: {
            spaceId: uuid,
            title: {
              type: 'string',
              minLength: 1,
              maxLength: DOCUMENT_TITLE_MAX,
              pattern: NON_BLANK_NO_NUL_PATTERN,
            },
            kind: { type: 'string', minLength: 1, maxLength: 64, pattern: NO_NUL_PATTERN },
            tagIds: { type: 'array', items: uuid, maxItems: TAG_IDS_MAX, uniqueItems: true },
            sourceDocumentId: uuid,
          },
        },
      },
    },
    async (request, reply) => {
      const { kind, tagIds } = request.body;
      // Kanonikus (kisbetűs) azonosítók: az Ajv `uuid` formátuma és a Postgres `uuid` kis/nagybetű-független.
      const spaceId = request.body.spaceId.toLowerCase();
      const sourceDocumentId = request.body.sourceDocumentId?.toLowerCase();
      // A célszínterében tagság (nem tagnak `not_space_member`), lezárt térben `space_closed`.
      if (!(await authorizeSpace(access, request, reply, 'document.create', spaceId))) return reply;
      // Duplikálásnál a forráshoz is `document.read` kell: nem tag forrásra `not_space_member` a forrás címe nélkül (D44).
      if (
        sourceDocumentId !== undefined &&
        !(await authorizeDocument(access, request, reply, 'document.read', sourceDocumentId))
      ) {
        return reply;
      }
      const result = await documents.createDocument(
        actorOf(request),
        {
          spaceId,
          title: request.body.title.trim(),
          kind,
          tagIds: tagIds ?? [],
          ...(sourceDocumentId === undefined ? {} : { sourceDocumentId }),
        },
        clock(),
      );
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(201).send(result.value satisfies DocumentDetail);
    },
  );

  api.get<{ Params: { id: string } }>(
    '/documents/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      // Nem létező vagy eldobott dokumentum: 404; nem tag: 403 `not_space_member`, a cím nélkül (A10).
      const id = request.params.id.toLowerCase();
      if (!(await authorizeDocument(access, request, reply, 'document.read', id))) return reply;
      const detail = await documents.getDocument(actorOf(request).userId, id);
      return detail === undefined ? sendProblem(reply, 'not_found') : detail;
    },
  );

  api.delete<{ Params: { id: string } }>(
    '/documents/:id/draft',
    { schema: { params: idParams } },
    async (request, reply) => {
      // Kanonikus (kisbetűs) azonosító: a /collab dokumentumnevek kisbetűsek, a Hocuspocus szigorúan hasonlít, ezért a
      // nagybetűs kérés nem kerülheti meg a nyitott kapcsolatok bontását (D59).
      const id = request.params.id.toLowerCase();
      if (!(await authorizeDocument(access, request, reply, 'document.draft.discard', id))) {
        return reply;
      }
      const result = await documents.discardDraft(actorOf(request), id, clock());
      if (!result.ok) return sendFailure(reply, result);
      // A commit után: a már megnyitott szerkesztőkapcsolatok azonnal bomlanak (D59). A bontás hibája nem teszi
      // hibássá az (már véglegesült) eldobást: naplózzuk, és a kapcsolat legkésőbb az újracsatlakozáskor elutasítódik.
      try {
        deps.closeCollabDocument(id);
      } catch (error) {
        request.log.error(
          { err: error, documentId: id },
          'a /collab kapcsolatok bontása nem sikerült',
        );
      }
      return reply.code(204).send();
    },
  );
}
