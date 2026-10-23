import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

/**
 * Közös WebSocket-keepalive mindkét csatornára (a Hocuspocus saját szerverének 30 mp-es
 * ping-söprését pótolja): az élő kliens pongja frissíti a kapcsolatot (a `/collab`-on a
 * Hocuspocus tétlenségi idejét is), így a csendes kliens sem esik ki az nginx idle timeoutja
 * vagy a Hocuspocus miatt; a pongra nem válaszoló, félig nyitott kapcsolatot pedig bontja.
 */
export function startHeartbeat(app: FastifyInstance, intervalMs: number): void {
  const alive = new WeakMap<WebSocket, boolean>();

  const timer = setInterval(() => {
    for (const socket of app.websocketServer.clients) {
      if (!alive.has(socket)) {
        socket.on('pong', () => alive.set(socket, true));
      } else if (!alive.get(socket)) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, intervalMs);
  timer.unref();

  app.addHook('onClose', () => clearInterval(timer));
}
