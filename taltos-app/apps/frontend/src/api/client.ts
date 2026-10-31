import { isErrorCode, type ErrorCode } from '@taltos/shared';

/** Egy sikertelen API-hívás: a stabil `code` (B5) vagy `network` (nincs válasz / időtúllépés). */
export class ApiError extends Error {
  readonly code: ErrorCode | 'network';
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode | 'network', status: number, details?: Record<string, unknown>) {
    // A szerver `title`/`detail` szövegére nem építünk (B5): az üzenetet a `code` alapján választjuk.
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export type ApiRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** A `/me` által adott token; minden nem-GET kérésben `X-CSRF-Token` fejlécként megy. */
  csrfToken?: string | null;
  signal?: AbortSignal;
};

const SAFE_METHODS = new Set(['GET', 'HEAD']);

function codeFromStatus(status: number): ErrorCode {
  return status === 401 ? 'unauthenticated' : 'internal_error';
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const problem =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  // Ismeretlen vagy hiányzó kód: a státuszból következtetünk, belső részletet nem mutatunk.
  const code = isErrorCode(problem.code) ? problem.code : codeFromStatus(response.status);
  const details =
    typeof problem.details === 'object' && problem.details !== null
      ? (problem.details as Record<string, unknown>)
      : undefined;
  return new ApiError(code, response.status, details);
}

/** Közös `fetch`-burkoló: JSON, same-origin süti, CSRF-fejléc, RFC 9457 hiba → `ApiError`. */
export async function apiFetch<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const method = request.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!SAFE_METHODS.has(method) && request.csrfToken) headers['X-CSRF-Token'] = request.csrfToken;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    throw new ApiError('network', 0);
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('internal_error', response.status);
  }
}
