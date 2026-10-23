import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as t from '../db/schema.js';
import { LOCK_ALLOWLIST_SYNC } from './locks.js';

type Db = NodePgDatabase;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Az allowlist-fájl feldolgozása (D53): soronként egy e-mail, `#` megjegyzés (sor elején vagy után).
 * Az e-mail kisbetűssé alakul, az ismétlődés összevonódik, a sorrend a fájl szerinti. Érvénytelen sor
 * esetén a hiba a sor számát adja (az értéket nem: személyes adat), az induláskor leállít.
 */
export function parseAllowlist(text: string): string[] {
  const emails = new Set<string>();
  (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) // BOM
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.replace(/#.*$/, '').trim();
      if (line === '') return;
      if (!EMAIL_PATTERN.test(line)) {
        throw new Error(`Érvénytelen e-mail az allowlist-fájl ${index + 1}. sorában.`);
      }
      emails.add(line.toLowerCase());
    });
  return [...emails];
}

export type KeepReason = 'owner_handover_required' | 'last_space_manager' | 'last_admin';

export interface AllowlistSyncResult {
  added: number;
  reactivated: number;
  removed: number;
  /** A konfigból eltávolított, de a 409-es védelem miatt aktív maradt felhasználók (azonosítóval, e-mail nélkül). */
  kept: { userId: string; reason: KeepReason }[];
}

/**
 * Induláskori allowlist-szinkron a konfigurációból (D53), egyetlen tranzakcióban, determinisztikusan
 * (rendezett sorrend) és idempotensen (a második futás nem ír):
 *  - új cím: beszúrás + `allowlist_added`;
 *  - újra felvett cím: ugyanaz a sor, `deleted_at = NULL` + `allowlist_added`;
 *  - eltávolított cím: soft delete + `allowlist_removed` + a felhasználó munkameneteinek visszavonása, DE csak ha
 *    a felhasználó nem dokumentum-tulajdonos, nem az utolsó Színtérgazda és nem az utolsó Rendszeradmin;
 *    különben aktív marad (a hívó figyelmeztetést naplóz).
 * Az események aktor nélküliek (D51d). A tanácsadó zár a párhuzamosan induló példányokat sorosítja.
 */
export async function syncAllowlist(
  db: Db,
  configured: readonly string[],
  now: Date = new Date(),
): Promise<AllowlistSyncResult> {
  const wanted = [...new Set(configured)].sort();
  const wantedSet = new Set(wanted);
  // Az üres lista szinte biztosan hiba (hibás mount, üres fájl): ne zárjunk ki mindenkit csendben.
  if (wanted.length === 0) {
    throw new Error('Az allowlist-fájl nem tartalmaz e-mail címet; az indulás megszakítva.');
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_ALLOWLIST_SYNC}::bigint)`);

    const rows = await tx
      .select({ email: t.allowlist.email, deletedAt: t.allowlist.deletedAt })
      .from(t.allowlist)
      .orderBy(t.allowlist.email);
    const known = new Map(rows.map((row) => [row.email, row.deletedAt !== null]));
    const result: AllowlistSyncResult = { added: 0, reactivated: 0, removed: 0, kept: [] };

    const toInsert = wanted.filter((email) => !known.has(email));
    if (toInsert.length > 0) {
      await tx
        .insert(t.allowlist)
        .values(toInsert.map((email) => ({ email, note: 'config', createdAt: now })));
      result.added = toInsert.length;
    }
    const toReactivate = wanted.filter((email) => known.get(email) === true);
    for (const email of toReactivate) {
      await tx
        .update(t.allowlist)
        .set({ deletedAt: null })
        .where(sql`${t.allowlist.email} = ${email}`);
    }
    result.reactivated = toReactivate.length;
    const additions = [
      ...toInsert.map(() => ({ source: 'config' })),
      ...toReactivate.map(() => ({ source: 'config', reactivated: true })),
    ];
    if (additions.length > 0) {
      await tx.insert(t.events).values(
        additions.map((details) => ({
          type: 'allowlist_added',
          actorId: null,
          details,
          createdAt: now,
        })),
      );
    }

    const toRemove = rows
      .filter((row) => row.deletedAt === null && !wantedSet.has(row.email))
      .map((row) => row.email);
    for (const email of toRemove) {
      const user = await userIdOf(tx, email);
      const reason = user === undefined ? undefined : await blockedBy(tx, user);
      if (user !== undefined && reason !== undefined) {
        result.kept.push({ userId: user, reason });
        continue;
      }
      await tx
        .update(t.allowlist)
        .set({ deletedAt: now })
        .where(sql`${t.allowlist.email} = ${email}`);
      await tx.insert(t.events).values({
        type: 'allowlist_removed',
        actorId: null,
        details: { source: 'config' },
        createdAt: now,
      });
      if (user !== undefined) {
        await tx.execute(sql`UPDATE sessions SET expires_at = ${now}::timestamptz
                               WHERE user_id = ${user} AND expires_at > ${now}::timestamptz`);
      }
      result.removed += 1;
    }
    return result;
  });
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function userIdOf(tx: Tx, email: string): Promise<string | undefined> {
  const { rows } = await tx.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`,
  );
  return rows[0]?.id;
}

/**
 * A 409-es védelmek (B5): az első, amely tiltja az eltávolítást. A „másik gazda / admin” csak akkor számít,
 * ha még be tud lépni (aktív allowlist-bejegyzése van): így egyetlen szinkronban két utolsó-pótló sem távolítható el
 * egyszerre (a korábban törölt cím ugyanabban a tranzakcióban már nem számít).
 */
async function blockedBy(tx: Tx, userId: string): Promise<KeepReason | undefined> {
  const owns = await tx.execute(
    sql`SELECT 1 FROM documents WHERE owner_id = ${userId} AND deleted_at IS NULL LIMIT 1`,
  );
  if (owns.rows.length > 0) return 'owner_handover_required';

  const lastManager = await tx.execute(sql`
    SELECT 1
      FROM space_members sm
      JOIN spaces s ON s.id = sm.space_id
     WHERE sm.user_id = ${userId} AND sm.role = 'space_manager' AND sm.removed_at IS NULL
       AND s.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM space_members o
           JOIN users ou ON ou.id = o.user_id
           JOIN allowlist oa ON oa.email = lower(ou.email) AND oa.deleted_at IS NULL
          WHERE o.space_id = sm.space_id AND o.role = 'space_manager' AND o.removed_at IS NULL
            AND o.user_id <> sm.user_id)
     LIMIT 1`);
  if (lastManager.rows.length > 0) return 'last_space_manager';

  const lastAdmin = await tx.execute(sql`
    SELECT 1
      FROM users u
     WHERE u.id = ${userId} AND u.system_role = 'system_admin'
       AND NOT EXISTS (
         SELECT 1
           FROM users o
           JOIN allowlist oa ON oa.email = lower(o.email) AND oa.deleted_at IS NULL
          WHERE o.system_role = 'system_admin' AND o.id <> u.id)
     LIMIT 1`);
  if (lastAdmin.rows.length > 0) return 'last_admin';
  return undefined;
}

/** A szinkron naplózója (a Fastify-logger egy részhalmaza). */
export interface SyncLog {
  info(object: object, message: string): void;
  warn(object: object, message: string): void;
}

/**
 * Az indulási lépés: a fájl beolvasása, szinkron, naplózás. A védelem miatt aktív maradt felhasználó nem hiba,
 * hanem figyelmeztetés (D53): addig marad, amíg a tulajdonjogot/gazdaságot át nem adják.
 */
export async function syncAllowlistFromFile(
  db: Db,
  file: string,
  log: SyncLog,
): Promise<AllowlistSyncResult> {
  const result = await syncAllowlist(db, parseAllowlist(readFileSync(file, 'utf8')));
  log.info(
    { added: result.added, reactivated: result.reactivated, removed: result.removed },
    'allowlist szinkronizálva a konfigurációból',
  );
  for (const kept of result.kept) {
    log.warn(
      kept,
      'a konfigból eltávolított felhasználó a védelem miatt aktív maradt (előbb át kell adni a tulajdonjogot / gazdaságot)',
    );
  }
  return result;
}
