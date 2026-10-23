import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import {
  PROBLEM_CONTENT_TYPE,
  statusOf,
  type ErrorCode,
  type ProblemDetails,
} from '@taltos/shared';

const TITLES: Partial<Record<ErrorCode, string>> = {
  validation_error: 'A kérés nem felel meg a sémának',
  unauthenticated: 'Bejelentkezés szükséges',
  forbidden: 'Ehhez nincs jogosultságod',
  not_found: 'Nem található',
  internal_error: 'Váratlan hiba történt',
};

export function sendProblem(
  reply: FastifyReply,
  code: ErrorCode,
  extra: Partial<Pick<ProblemDetails, 'title' | 'detail' | 'details' | 'status'>> = {},
): FastifyReply {
  const status = extra.status ?? statusOf(code);
  const body: ProblemDetails = {
    title: extra.title ?? TITLES[code] ?? code,
    status,
    code,
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    ...(extra.details === undefined ? {} : { details: extra.details }),
  };
  return reply.code(status).type(PROBLEM_CONTENT_TYPE).send(body);
}

/** Minden hiba Problem Details-ként megy ki (B5 A2); belső részlet nem szivárog. */
export function registerProblemHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => sendProblem(reply, 'not_found'));

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return sendProblem(reply, 'validation_error', {
        details: {
          errors: error.validation.map((issue) => ({
            path: issue.instancePath || `/${error.validationContext ?? 'request'}`,
            message: issue.message ?? 'érvénytelen érték',
          })),
        },
      });
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'kezeletlen hiba');
      return sendProblem(reply, 'internal_error');
    }

    // A kód és a státusz mindig a B5 katalógus szerint párban jár. Amire nincs saját kód
    // (pl. a Fastify 413/415-ös kérésformátum-hibái), az 400-as validation_error.
    const code = STATUS_CODES[status] ?? 'validation_error';
    // Szöveges részletet csak a Fastify saját (FST_ERR_*) hibáiból adunk ki; az alkalmazáskód
    // hibaüzenete belső szöveg lehet.
    const detail = error.code?.startsWith('FST_') ? error.message : undefined;
    return sendProblem(reply, code, detail === undefined ? {} : { detail });
  });
}

/** 4xx státusz → katalóguskód, ahol a megfeleltetés egyértelmű (B5 3. szakasz). */
const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: 'validation_error',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
};
