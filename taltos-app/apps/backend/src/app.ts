import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { HEALTH_PATH, type HealthResponse } from '@taltos/shared';
import type { AppConfig } from './config.js';
import { registerProblemHandlers } from './http/problem.js';
import { trustImmediateProxy } from './http/trust-proxy.js';
import { registerCollab } from './realtime/collab.js';
import { startHeartbeat } from './realtime/heartbeat.js';
import { registerNotifications } from './realtime/notifications.js';

/** Egy WebSocket-üzenet felső korlátja (a `ws` alapértéke 100 MiB). */
const WS_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

/** A WebSocket-ping gyakorisága; jóval az nginx 1 órás és a Hocuspocus tétlenségi ideje alatt. */
const WS_HEARTBEAT_INTERVAL_MS = 30_000;

export interface BuildOptions {
  heartbeatIntervalMs?: number;
}

export async function buildApp(
  config: AppConfig,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
    },
    trustProxy: config.trustProxy === false ? false : trustImmediateProxy(config.trustProxy),
  });

  registerProblemHandlers(app);
  await app.register(websocket, { options: { maxPayload: WS_MAX_PAYLOAD_BYTES } });
  startHeartbeat(app, options.heartbeatIntervalMs ?? WS_HEARTBEAT_INTERVAL_MS);

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

  const hocuspocus = registerCollab(app, config.allowedOrigins);
  registerNotifications(app, config.allowedOrigins);

  app.addHook('onClose', () => {
    hocuspocus.closeConnections();
  });

  return app;
}
