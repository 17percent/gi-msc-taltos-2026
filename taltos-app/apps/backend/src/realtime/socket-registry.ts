import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { SessionService } from '../auth/session-service.js';

/** A WebSocket záráskódja, ha a munkamenet lejárt vagy visszavonódott (policy violation). */
export const WS_SESSION_ENDED = 1008;

interface Entry {
  id: Buffer;
  sockets: Set<WebSocket>;
}

/**
 * A nyitott WebSocketek nyilvántartása munkamenet szerint (folyamatonként). Két feladata van:
 *  - azonnali zárás, ha EZ a folyamat visszavon egy munkamenetet (kijelentkezés, allowlistről levétel);
 *  - időzített újraellenőrzés (`sweep`), hogy a lejárat és a másik folyamatban történt visszavonás a csendes,
 *    üzenetet nem küldő kapcsolatot is lezárja (appsec W-1).
 * A kulcs a session-id hex alakja; a nyers token itt soha nem jelenik meg.
 */
export class SocketRegistry {
  private readonly entries = new Map<string, Entry>();
  private sweeping = false;

  add(id: Buffer, socket: WebSocket): void {
    const key = id.toString('hex');
    const entry = this.entries.get(key) ?? { id, sockets: new Set() };
    entry.sockets.add(socket);
    this.entries.set(key, entry);
    socket.once('close', () => {
      entry.sockets.delete(socket);
      if (entry.sockets.size === 0 && this.entries.get(key) === entry) this.entries.delete(key);
    });
  }

  closeSession(id: Buffer): void {
    const entry = this.entries.get(id.toString('hex'));
    if (entry === undefined) return;
    for (const socket of entry.sockets) socket.close(WS_SESSION_ENDED, 'session_ended');
  }

  /**
   * Minden nyitott kapcsolat munkamenetét újraellenőrzi (munkamenetenként egyszer). Átmeneti hiba (pl. az
   * adatbázis nem elérhető) esetén a kapcsolat nyitva marad, és a következő kör újra próbálja; a nyugtázott
   * érvénytelenség viszont zár. A körök nem fedik egymást.
   */
  async sweep(sessions: SessionService, log: FastifyBaseLogger): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const entry of [...this.entries.values()]) {
        try {
          if (!(await sessions.isActive(entry.id))) this.closeSession(entry.id);
        } catch (error) {
          log.error({ err: error }, 'a nyitott WebSocket munkamenetének ellenőrzése sikertelen');
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  start(app: FastifyInstance, sessions: SessionService, intervalMs: number): void {
    const timer = setInterval(() => {
      void this.sweep(sessions, app.log);
    }, intervalMs);
    timer.unref();
    app.addHook('onClose', () => clearInterval(timer));
  }
}
