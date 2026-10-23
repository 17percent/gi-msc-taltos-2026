import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AUTH_CALLBACK_PATH,
  AUTH_LOGIN_PATH,
  AUTH_LOGOUT_PATH,
  type LoginError,
} from '@taltos/shared';
import { sendProblem } from '../http/problem.js';
import { clearSessionCookie, setSessionCookie, verifyMutation, type AuthContext } from './guard.js';
import { LoginRejected, type LoginTransaction, type OidcFlow } from './oidc.js';
import type { AuthStore, Clock } from './types.js';

export interface AuthRouteDependencies {
  context: AuthContext;
  store: AuthStore;
  oidc: OidcFlow;
  clock: Clock;
  /** A callback-URL origin-je: a konfigurált publikus origin, nem a kérés `Host` fejléce. */
  publicOrigin: string;
}

/**
 * A bejelentkezési kísérlet ellenőrző értékei (state, nonce, PKCE-verifier) a böngészőnél élnek egy rövid életű,
 * httpOnly, HMAC-aláírt sütiben (a kulcs a kliens-secretből származik). Szerveroldali tár helyett azért, mert
 * nincs hozzá séma (a B4-ben nincs ilyen tábla), a memóriabeli tár pedig újraindításkor elveszne; az aláírás
 * megakadályozza, hogy idegen kísérlet értékeit tolják a böngészőbe (login CSRF). A süti csak az `/auth` útvonalra
 * megy, a kísérlet végén törlődik.
 */
const TX_COOKIE = 'taltos_login';
const TX_PATH = '/auth';
const TX_MAX_AGE_SECONDS = 10 * 60;

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDependencies): void {
  const { context, store, oidc, clock, publicOrigin } = deps;
  const txCookieOptions = {
    path: TX_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: context.cookieSecure,
  } as const;

  const failLogin = (reply: FastifyReply, error: LoginError): FastifyReply =>
    reply.header('cache-control', 'no-store').redirect(`/?error=${error}`);

  app.get(AUTH_LOGIN_PATH, async (request, reply) => {
    try {
      const { url, tx } = await oidc.start();
      void reply.setCookie(TX_COOKIE, JSON.stringify(tx), {
        ...txCookieOptions,
        maxAge: TX_MAX_AGE_SECONDS,
        signed: true,
      });
      return reply.header('cache-control', 'no-store').redirect(url.href);
    } catch (error) {
      request.log.error({ err: error }, 'az OIDC-bejelentkezés nem indítható');
      return failLogin(reply, 'login_failed');
    }
  });

  app.get(AUTH_CALLBACK_PATH, async (request, reply) => {
    const tx = readTransaction(request);
    void reply.clearCookie(TX_COOKIE, txCookieOptions);
    if (tx === undefined) {
      request.log.warn('bejelentkezési visszahívás érvényes kísérlet-süti nélkül');
      return failLogin(reply, 'login_failed');
    }

    let identity;
    try {
      identity = await oidc.finish(new URL(request.url, publicOrigin), tx);
    } catch (error) {
      if (error instanceof LoginRejected) {
        request.log.warn({ reason: error.reason }, 'bejelentkezés elutasítva');
      } else {
        request.log.warn({ err: error }, 'az OIDC-visszahívás érvénytelen');
      }
      return failLogin(reply, 'login_failed');
    }

    const outcome = await store.login(identity, clock());
    if (outcome.status === 'not_on_allowlist') {
      request.log.info('belépés elutasítva: az e-mail nincs az allowlisten');
      return failLogin(reply, 'not_on_allowlist');
    }
    if (outcome.status === 'identity_conflict') {
      request.log.warn('belépés elutasítva: az e-mail másik OIDC-azonosítóhoz tartozik');
      return failLogin(reply, 'login_failed');
    }

    const { token, expiresAt } = await context.sessions.issue(outcome.userId);
    setSessionCookie(context, reply, token, expiresAt);
    request.log.info({ userId: outcome.userId }, 'bejelentkezés');
    return reply.header('cache-control', 'no-store').redirect('/');
  });

  app.post(
    AUTH_LOGOUT_PATH,
    {
      // A kijelentkezés az allowlistről levett munkamenetnek is működik, ezért itt nincs allowlist-kapu.
      onRequest: async (request, reply) => {
        const session = await context.sessions.authenticate(request.cookies[context.cookieName]);
        if (session === undefined) {
          await sendProblem(reply, 'unauthenticated');
          return;
        }
        if (await verifyMutation(context, request, reply, session)) request.auth = session;
      },
    },
    async (request, reply) => {
      if (request.auth !== null) await context.sessions.revoke(request.auth.id);
      clearSessionCookie(context, reply);
      return reply.header('cache-control', 'no-store').code(204).send();
    },
  );

  function readTransaction(request: FastifyRequest): LoginTransaction | undefined {
    const raw = request.cookies[TX_COOKIE];
    if (raw === undefined) return undefined;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid) return undefined;
    try {
      const value: unknown = JSON.parse(unsigned.value);
      if (typeof value !== 'object' || value === null) return undefined;
      const { state, nonce, codeVerifier } = value as Record<string, unknown>;
      if (
        typeof state === 'string' &&
        typeof nonce === 'string' &&
        typeof codeVerifier === 'string'
      ) {
        return { state, nonce, codeVerifier };
      }
    } catch {
      // A hibás JSON egyszerűen érvénytelen kísérlet.
    }
    return undefined;
  }
}
