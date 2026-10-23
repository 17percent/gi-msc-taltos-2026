import { DrizzleQueryError } from 'drizzle-orm/errors';
import type { FastifyError } from 'fastify';
import pg from 'pg';

/**
 * Hibanapló-redakció (appsec F-8): a Drizzle `Failed query: ... params: ...` üzenete és a Postgres
 * hibaüzenete (`invalid input syntax for type uuid: "<érték>"`, `Key (email)=(...) already exists`)
 * kötött paramétert, azaz felhasználói adatot (e-mail, azonosító) tartalmazhat. Adatbázis-hibáról ezért csak
 * a szerkezeti mezők kerülnek a naplóba (SQLSTATE, kényszer, tábla, oszlop), az üzenet, a `detail`, a lekérdezés,
 * a paraméterek és a stack soha. A HTTP-válasz eleve általános (`internal_error`), ez a naplót védi.
 */

export interface SerializedError {
  type: string;
  message: string;
  stack: string;
  [field: string]: unknown;
}

const MAX_CAUSE_DEPTH = 5;

export function findDatabaseError(error: unknown): pg.DatabaseError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current instanceof pg.DatabaseError) return current;
    current = current.cause;
  }
  return undefined;
}

function isDatabaseRelated(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current instanceof pg.DatabaseError || current instanceof DrizzleQueryError) return true;
    current = current.cause;
  }
  return false;
}

export function serializeError(error: FastifyError): SerializedError {
  if (isDatabaseRelated(error)) {
    const db = findDatabaseError(error);
    return {
      type: 'DatabaseError',
      message: db?.code === undefined ? 'adatbázis-hiba' : `adatbázis-hiba (SQLSTATE ${db.code})`,
      stack: '',
      ...(db?.code === undefined ? {} : { sqlState: db.code }),
      ...(db?.constraint === undefined ? {} : { constraint: db.constraint }),
      ...(db?.table === undefined ? {} : { table: db.table }),
      ...(db?.column === undefined ? {} : { column: db.column }),
    };
  }
  return {
    type: error.name,
    message: error.message,
    stack: error.stack ?? '',
    ...(error.code === undefined ? {} : { code: error.code }),
  };
}

/**
 * A kérés naplóbejegyzése. Az `/auth/` útvonalakon a query-string (OIDC `code`, `state`) nem kerül a naplóba;
 * a süti és a CSRF-fejléc a logger `redact` listáján van.
 */
export function serializeRequest(request: {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
}): Record<string, unknown> {
  const url = request.url ?? '';
  const path = url.split('?', 1)[0] ?? '';
  return {
    method: request.method,
    url: path.startsWith('/auth/') ? path : url,
    host: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}
