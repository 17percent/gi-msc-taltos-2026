import { sql, type SQL } from 'drizzle-orm';

/**
 * Az üzleti védelmek (B5 409-esek) közös SQL-feltételei: a WP2 allowlist-szinkron (`blockedBy`) és a WP4a tagkezelés
 * ugyanazt a „aktív” fogalmat használja, ezért egyetlen helyen élnek.
 *
 * „Aktív Színtérgazda / Rendszeradmin”: aki be tud lépni, azaz van aktív (nem törölt) allowlist-bejegyzése. Így az
 * utolsó, még belépni képes gazda/admin védett; a már kizárt címek nem számítanak pótlónak.
 */

/**
 * Van-e a színtérnek a `excludeUserId`-n kívül aktív Színtérgazdája (aktív tagság + aktív allowlist-bejegyzés).
 * A paraméterek SQL-kifejezések (korrelálhatók külső sorra): `sql\`sm.space_id\``, vagy kötött érték.
 */
export function otherActiveManagerExists(spaceId: SQL, excludeUserId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1
      FROM space_members o
      JOIN users ou ON ou.id = o.user_id
      JOIN allowlist oa ON oa.email = lower(ou.email) AND oa.deleted_at IS NULL
     WHERE o.space_id = ${spaceId} AND o.role = 'space_manager' AND o.removed_at IS NULL
       AND o.user_id <> ${excludeUserId})`;
}

/** Van-e a `excludeUserId`-n kívül aktív Rendszeradmin (aktív allowlist-bejegyzéssel). */
export function otherActiveAdminExists(excludeUserId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1
      FROM users o
      JOIN allowlist oa ON oa.email = lower(o.email) AND oa.deleted_at IS NULL
     WHERE o.system_role = 'system_admin' AND o.id <> ${excludeUserId})`;
}
