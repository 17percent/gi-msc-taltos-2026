import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { HEALTH_PATH, type HealthResponse } from '@taltos/shared';
import { mutationOriginGate, sessionCookieName, type AuthContext } from './auth/guard.js';
import type { OidcFlow } from './auth/oidc.js';
import { registerAuthRoutes } from './auth/routes.js';
import { SessionService, TOUCH_INTERVAL_MS } from './auth/session-service.js';
import { systemClock, type AuthStore, type Clock } from './auth/types.js';
import type { AppConfig } from './config.js';
import { registerApi } from './http/api.js';
import { registerProblemHandlers } from './http/problem.js';
import { serializeError, serializeRequest } from './http/redact.js';
import { trustImmediateProxy } from './http/trust-proxy.js';
import { registerCollab } from './realtime/collab.js';
import { startHeartbeat } from './realtime/heartbeat.js';
import { registerNotifications } from './realtime/notifications.js';
import { SocketRegistry } from './realtime/socket-registry.js';

/** Egy WebSocket-üzenet felső korlátja (a `ws` alapértéke 100 MiB). */
const WS_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

/** A WebSocket-ping gyakorisága; jóval az nginx 1 órás és a Hocuspocus tétlenségi ideje alatt. */
const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** A nyitott WebSocketek munkamenet-újraellenőrzésének köze (a 60 mp-es felső korlát alatt). */
const WS_SESSION_RECHECK_INTERVAL_MS = 30_000;

/** A hitelesítés külső függőségei: adattár, OIDC-szolgáltató, aláíró kulcs és óra. */
export interface AuthDependencies {
  store: AuthStore;
  oidc: OidcFlow;
  /** A bejelentkezési kísérlet-süti HMAC-kulcsa (a kliens-secretből származtatva; lásd main.ts). */
  cookieSecret: string;
  clock?: Clock;
}

export interface BuildOptions {
  heartbeatIntervalMs?: number;
  /** A nyitott WebSocketek munkamenet-újraellenőrzésének köze (alap: 30 mp). */
  sessionRecheckIntervalMs?: number;
}

export async function buildApp(
  config: AppConfig,
  auth: AuthDependencies,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const clock = auth.clock ?? systemClock;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
      // Adatbázis-hibáról és /auth/ URL-ről nem kerül paraméter vagy kód a naplóba (appsec F-8).
      serializers: { err: serializeError, req: serializeRequest },
    },
    trustProxy: config.trustProxy === false ? false : trustImmediateProxy(config.trustProxy),
  });

  registerProblemHandlers(app);
  await app.register(cookie, { secret: auth.cookieSecret });
  await app.register(websocket, { options: { maxPayload: WS_MAX_PAYLOAD_BYTES } });
  app.decorateRequest('auth', null);
  startHeartbeat(app, options.heartbeatIntervalMs ?? WS_HEARTBEAT_INTERVAL_MS);

  const registry = new SocketRegistry();
  const context: AuthContext = {
    sessions: new SessionService(
      auth.store,
      {
        absoluteMs: config.sessionAbsoluteMs,
        idleMs: config.sessionIdleMs,
        touchIntervalMs: TOUCH_INTERVAL_MS,
      },
      clock,
      (id) => {
        registry.closeSession(id);
      },
    ),
    allowedOrigins: new Set(config.allowedOrigins),
    cookieName: sessionCookieName(config.cookieSecure),
    cookieSecure: config.cookieSecure,
  };
  registry.start(
    app,
    context.sessions,
    options.sessionRecheckIntervalMs ?? WS_SESSION_RECHECK_INTERVAL_MS,
  );
  // Minden mutáló kérés Origin-kapuja, az ezután regisztrált minden útvonalra (a hook öröklődik).
  app.addHook('onRequest', mutationOriginGate(context.allowedOrigins));

  app.get(
    HEALTH_PATH,
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['status', 'version'],
            properties: { status: { const: 'ok' }, version: { type: 'string' } },
          },
        },
      },
    },
    (): HealthResponse => ({ status: 'ok', version: config.version }),
  );

  registerAuthRoutes(app, {
    context,
    store: auth.store,
    oidc: auth.oidc,
    clock,
    publicOrigin: config.publicOrigin,
  });
  registerApi(app, { context, store: auth.store });

  const realtime = { allowedOrigins: config.allowedOrigins, context, clock, registry };
  const hocuspocus = registerCollab(app, realtime);
  registerNotifications(app, realtime);

  app.addHook('onClose', () => {
    hocuspocus.closeConnections();
  });

  return app;
}
