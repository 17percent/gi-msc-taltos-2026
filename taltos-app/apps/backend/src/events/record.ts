import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as t from '../db/schema.js';
import type { AppEvent } from './types.js';

/** A `db` vagy egy tranzakció: az esemény ugyanabban a tranzakcióban íródik, mint az üzleti változás. */
export type EventWriter = Pick<NodePgDatabase, 'insert'>;

/** A `details` tiltott kulcsai (D48): név, e-mail, cím és szöveg nem kerülhet az eseménybe. */
const FORBIDDEN_DETAIL_KEYS = new Set([
  'name',
  'displayName',
  'email',
  'title',
  'text',
  'message',
  'purpose',
  'description',
]);

/** Az aktor nélküli (rendszer-)események szűk halmaza, amelyet ez a író kiadhat (D51 d, D56). */
function actorlessAllowed(event: AppEvent): boolean {
  if (event.actorId !== null) return true;
  return (
    (event.type === 'review_withdrawn' && event.details.reason === 'space_closed') ||
    (event.type === 'reviewer_removed' && event.details.reason === 'allowlist_removed')
  );
}

/** A futásidejű eseményszabályok (a memóriabeli tár is ezt használja). */
export function validateEvent(event: AppEvent): void {
  if (!actorlessAllowed(event)) {
    throw new Error(`Aktor nélküli esemény nem engedélyezett: ${event.type}`);
  }
  for (const key of Object.keys(event.details)) {
    if (FORBIDDEN_DETAIL_KEYS.has(key)) {
      throw new Error(`Az esemény részletei nem tartalmazhatnak személyes adatot: ${key}`);
    }
  }
}

/**
 * Az egyetlen eseményíró: minden WP4a esemény ezen megy át (a WP10 az értesítéseket ide köti). Az `events` tábla
 * append-only (csak INSERT). A típus szűkít, a futásidejű ellenőrzés pedig védi a JS-hívót is: aktor nélkül csak a
 * felsorolt esetek, a `details`-ben pedig nincs név vagy e-mail jellegű kulcs. Hibát dob (nem nyel el), így a hívó
 * tranzakciója visszagördül. Több eseményt egyetlen többsoros INSERT ír (set-alapú műveleteknél nincs soronkénti
 * oda-vissza); az `at` a rögzítés ideje (alap: az adatbázis `now()`-ja).
 */
export async function recordEvents(
  tx: EventWriter,
  events: readonly AppEvent[],
  at?: Date,
): Promise<void> {
  if (events.length === 0) return;
  events.forEach(validateEvent);
  await tx.insert(t.events).values(
    events.map((event) => ({
      type: event.type,
      spaceId: 'spaceId' in event ? event.spaceId : null,
      documentId: 'documentId' in event ? event.documentId : null,
      changeRequestId: 'changeRequestId' in event ? event.changeRequestId : null,
      actorId: event.actorId,
      details: event.details,
      ...(at === undefined ? {} : { createdAt: at }),
    })),
  );
}

export function recordEvent(tx: EventWriter, event: AppEvent, at?: Date): Promise<void> {
  return recordEvents(tx, [event], at);
}
