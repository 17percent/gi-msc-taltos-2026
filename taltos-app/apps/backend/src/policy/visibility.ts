import { sql, type Column, type SQL } from 'drizzle-orm';
import * as t from '../db/schema.js';

/**
 * A „látható dokumentumok” lekérdezés-építő (D44): minden olvasó lekérdezés (lista, keresés, facet, összeg,
 * Atlasz, kapcsolatok, értesítések) EZT a feltételt teszi a `where`-be. Szándékosan feltétel, nem teljes lekérdezés,
 * hogy a lista, az összeg és a facetek ugyanazt használják, és más illesztésekkel is összeépíthető legyen.
 *
 * Tartalom:
 *  - a láthatóság a hívó AKTÍV tagsága az élő (nem törölt) színtérben; a Rendszeradmin nem kivétel (D43: tartalom
 *    csak tagként); a lezárt tér látható (csak olvasható);
 *  - a `documents.deleted_at` (archívum, eldobott piszkozat) szűrése a hívó dolga (az `archived=true` lista ezt fordítja).
 * Idő: korrelált `EXISTS` félillesztés (nincs `JOIN … DISTINCT`, nincs `NOT IN`), amely a `space_members_active_idx`
 * (user_id, space_id) részleges indexen és a `spaces` PK-n fut; sorok szorzódása nincs.
 */
export function visibleDocumentsWhere(
  viewerId: string,
  doc: { spaceId: Column } = t.documents,
): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${t.spaceMembers}
      JOIN ${t.spaces} ON ${t.spaces.id} = ${t.spaceMembers.spaceId}
     WHERE ${t.spaceMembers.spaceId} = ${doc.spaceId}
       AND ${t.spaceMembers.userId} = ${viewerId}
       AND ${t.spaceMembers.removedAt} IS NULL
       AND ${t.spaces.deletedAt} IS NULL)`;
}

/**
 * A hívó színterei: aktív tag, élő színtér (a lezárt is). A Rendszeradmin teljes listája (`GET /spaces`, csak
 * metaadat) NEM ez: az külön, a szolgáltatásban a `can('space.view')` szabálya szerinti lekérdezés.
 */
export function visibleSpacesWhere(
  viewerId: string,
  space: { id: Column; deletedAt: Column } = t.spaces,
): SQL {
  return sql`(${space.deletedAt} IS NULL AND EXISTS (
    SELECT 1 FROM ${t.spaceMembers}
     WHERE ${t.spaceMembers.spaceId} = ${space.id}
       AND ${t.spaceMembers.userId} = ${viewerId}
       AND ${t.spaceMembers.removedAt} IS NULL))`;
}
