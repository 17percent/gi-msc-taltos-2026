import type { FastifyReply, FastifyRequest } from 'fastify';
import { CSRF_HEADER } from '@taltos/shared';
import { sendProblem } from '../http/problem.js';
import { csrfTokenMatches } from './csrf.js';
import type { AuthSession, SessionService } from './session-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** A hitelesített munkamenet; az auth-kapu (API onRequest, WS preValidation) állítja be. */
    auth: AuthSession | null;
  }
}

export interface AuthContext {
  sessions: SessionService;
  allowedOrigins: ReadonlySet<string>;
  cookieName: string;
  cookieSecure: boolean;
}

/**
 * A sütinevek egyetlen helyen (appsec W-2): Secure módban a böngésző az előtagok alapján kényszeríti a Secure-t
 * (és a `__Host-` a Path=/ + Domain nélküliséget is), így altartományról nem írható felül. A fejlesztői http-n
 * az előtagos süti nem működne, ott az egyszerű név marad.
 */
export const sessionCookieName = (secure: boolean): string =>
  secure ? '__Host-taltos_sid' : 'taltos_sid';
export const loginCookieName = (secure: boolean): string =>
  secure ? '__Secure-taltos_login' : 'taltos_login';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isMutating(method: string): boolean {
  return !SAFE_METHODS.has(method);
}

export function setSessionCookie(
  ctx: AuthContext,
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(ctx.cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.cookieSecure,
    expires: expiresAt,
  });
}

export function clearSessionCookie(ctx: AuthContext, reply: FastifyReply): void {
  reply.clearCookie(ctx.cookieName, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.cookieSecure,
  });
}

/**
 * Globális `onRequest` kapu (appsec W-5): minden mutáló metódusú (POST/PUT/PATCH/DELETE) kéréshez engedélyezett
 * `Origin` kell, bármely útvonalon (az útvonalankénti CSRF-token-ellenőrzés mellett, nem helyette). A 403 itt is
 * `csrf_failed`; az Origin nélküli (nem böngészős) mutáló kérés is elutasul.
 */
export function mutationOriginGate(allowedOrigins: ReadonlySet<string>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!isMutating(request.method)) return;
    const origin = request.headers.origin;
    if (origin === undefined || !allowedOrigins.has(origin)) {
      request.log.warn({ origin }, 'mutáló kérés elutasítva: nem engedélyezett origin');
      await sendProblem(reply, 'csrf_failed', { detail: 'Nem engedélyezett origin.' });
    }
  };
}

/**
 * A kérés munkamenetének ellenőrzése (D5, B5 A1). `true`: a kérés mehet tovább, `request.auth` be van állítva;
 * `false`: a hibaválasz már elment.
 *  - nincs, lejárt vagy visszavont munkamenet: 401 `unauthenticated` (a süti törlődik, ha volt);
 *  - érvényes munkamenet, de a cím már nincs az allowlisten: a munkamenet visszavonódik, 403 `not_on_allowlist`.
 * Hiba (pl. elérhetetlen adatbázis) esetén a kérés elutasul (a hibakezelő 500-at ad): az ellenőrzés nem engedhet át.
 */
export async function authenticateRequest(
  ctx: AuthContext,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const token = request.cookies[ctx.cookieName];
  const session = await ctx.sessions.authenticate(token);
  if (session === undefined) {
    if (token !== undefined) clearSessionCookie(ctx, reply);
    await sendProblem(reply, 'unauthenticated');
    return false;
  }
  if (!session.onAllowlist) {
    await ctx.sessions.revoke(session.id);
    clearSessionCookie(ctx, reply);
    request.log.warn({ userId: session.userId }, 'munkamenet visszavonva: nincs az allowlisten');
    await sendProblem(reply, 'not_on_allowlist');
    return false;
  }
  request.auth = session;
  return true;
}

/**
 * Mutáló kérés védelme (D26, B5 A1): engedélyezett `Origin` ÉS a munkamenethez kötött CSRF-token az
 * `X-CSRF-Token` fejlécben. Mindkettő hiánya vagy hibája 403 `csrf_failed`. A böngésző a mutáló kéréshez
 * mindig küld `Origin`-t; a hiánya (nem böngészős kliens) elutasítás oka, mert az SPA-n kívüli hívónak itt nincs helye.
 */
export async function verifyMutation(
  ctx: AuthContext,
  request: FastifyRequest,
  reply: FastifyReply,
  session: AuthSession,
): Promise<boolean> {
  const origin = request.headers.origin;
  if (origin === undefined || !ctx.allowedOrigins.has(origin)) {
    request.log.warn({ origin }, 'mutáló kérés elutasítva: nem engedélyezett origin');
    await sendProblem(reply, 'csrf_failed', { detail: 'Nem engedélyezett origin.' });
    return false;
  }
  if (!csrfTokenMatches(session.csrfToken, request.headers[CSRF_HEADER])) {
    await sendProblem(reply, 'csrf_failed', { detail: 'Hiányzó vagy érvénytelen CSRF-token.' });
    return false;
  }
  return true;
}

/** A WebSocket-upgrade kapuja (appsec C1): munkamenet és allowlist az upgrade ELŐTT, 401/403 válasszal. */
export function sessionUpgradeGuard(ctx: AuthContext) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticateRequest(ctx, request, reply);
  };
}
