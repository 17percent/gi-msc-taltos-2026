/**
 * RFC 9457 Problem Details + stabil `code` mező (B5 A2, 3. szakasz).
 * A `code` kontraktus; a `title` és a `detail` szövege szabadon változhat.
 */

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** A B5 hibakód-katalógusa (10. verzió), a HTTP-státusszal együtt. */
export const ERROR_CODES = {
  validation_error: 400,
  unauthenticated: 401,
  not_on_allowlist: 403,
  csrf_failed: 403,
  forbidden: 403,
  not_space_member: 403,
  space_closed: 403,
  not_found: 404,
  request_pending: 409,
  request_closed: 409,
  not_enough_reviewers: 409,
  last_space_manager: 409,
  last_admin: 409,
  owner_handover_required: 409,
  has_approved_revision: 409,
  tag_exists: 409,
  stale_base_revision: 412,
  invalid_reviewers: 422,
  reason_required: 422,
  export_failed: 502,
  internal_error: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  code: ErrorCode;
  details?: Record<string, unknown>;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value);
}

export function statusOf(code: ErrorCode): number {
  return ERROR_CODES[code];
}
