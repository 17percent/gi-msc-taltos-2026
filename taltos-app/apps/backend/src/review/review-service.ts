import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { recordEvents, type EventWriter } from '../events/record.js';
import type { AppEvent } from '../events/types.js';

/**
 * A `ReviewService` MAG (WP4a): a Jóváhagyott/függő állapotot és a review-er helyeket kizárólag ez a modul írja
 * (D45, D56; az egyetlen-pont tesztje a `review/` könyvtárat engedi). A WP5 ide építi a beküldést és a döntést.
 *
 * Minden függvény a hívó tranzakciójában fut (`tx`), set-alapú: egy UPDATE ... RETURNING a sorokra, egy többsoros
 * esemény-INSERT, soronkénti oda-vissza nélkül. A DB-triggerek (`0003_review_invariants.sql`) érintetlenek; a halasztott
 * triggerek a COMMIT-kor futnak, a teszteknek ezt figyelembe kell venniük.
 */
export type ReviewTx = EventWriter & Pick<NodePgDatabase, 'execute'>;

interface WithdrawnRow extends Record<string, unknown> {
  id: string;
  document_id: string;
  space_id: string;
}

/**
 * A függő kérések visszavonása egy halmazra: kérés → `withdrawn` (`decided_at`), az aktív review-er sorok
 * `ended_at`/`end_reason = 'closed'`, a dokumentum `pending` → `draft` (csak olvasható marad, ha a tér lezárt).
 * Külön utasításokban fut (lásd a törzset), a visszavont kérések sorait adja vissza.
 */
async function withdraw(
  tx: ReviewTx,
  where: ReturnType<typeof sql>,
  now: Date,
): Promise<WithdrawnRow[]> {
  // Külön utasítások (nem egy adat-módosító CTE): egy CTE minden ága az utasítás kezdeti pillanatképét látja, így egy
  // közben commitolt cserélő review-er sor láthatatlan maradna a seprő UPDATE-nek. Az első UPDATE zárolja a kéréseket,
  // a következők már READ COMMITTED alatt, friss pillanatképpel futnak.
  const withdrawn = await tx.execute<WithdrawnRow>(sql`
    UPDATE change_requests c
       SET state = 'withdrawn', decided_at = ${now}::timestamptz
      FROM documents d
     WHERE d.id = c.document_id AND c.state = 'pending' AND ${where}
    RETURNING c.id, c.document_id, d.space_id`);
  if (withdrawn.rows.length === 0) return [];
  const ids = sql.join(
    withdrawn.rows.map((row) => sql`${row.id}::uuid`),
    sql`, `,
  );
  const documentIds = sql.join(
    withdrawn.rows.map((row) => sql`${row.document_id}::uuid`),
    sql`, `,
  );
  await tx.execute(sql`
    UPDATE change_request_reviewers
       SET ended_at = ${now}::timestamptz, end_reason = 'closed'
     WHERE change_request_id IN (${ids}) AND ended_at IS NULL`);
  await tx.execute(sql`
    UPDATE documents SET review_state = 'draft'
     WHERE id IN (${documentIds}) AND review_state = 'pending'`);
  return withdrawn.rows;
}

/**
 * A projekt-tér lezárásakor a tér összes függő kérése visszavonódik (D55): aktor nélküli `review_withdrawn`
 * (ok: `space_closed`), kérésenként egy. Visszaadja a visszavont kérések számát.
 */
export async function withdrawAllInSpace(
  tx: ReviewTx,
  spaceId: string,
  now: Date,
): Promise<number> {
  const rows = await withdraw(tx, sql`d.space_id = ${spaceId}`, now);
  await recordEvents(
    tx,
    rows.map((row): AppEvent => ({
      type: 'review_withdrawn',
      spaceId: row.space_id,
      documentId: row.document_id,
      changeRequestId: row.id,
      actorId: null,
      details: { reason: 'space_closed' },
    })),
    now,
  );
  return rows.length;
}

/**
 * A tagként eltávolított indítványozó függő kérései visszavonódnak (D56): `review_withdrawn` (ok: `member_removed`),
 * az aktor az eltávolító.
 */
export async function withdrawForInitiator(
  tx: ReviewTx,
  spaceId: string,
  initiatorId: string,
  actorId: string,
  now: Date,
): Promise<number> {
  const rows = await withdraw(
    tx,
    sql`d.space_id = ${spaceId} AND c.initiator_id = ${initiatorId}`,
    now,
  );
  await recordEvents(
    tx,
    rows.map((row): AppEvent => ({
      type: 'review_withdrawn',
      spaceId: row.space_id,
      documentId: row.document_id,
      changeRequestId: row.id,
      actorId,
      details: { reason: 'member_removed' },
    })),
    now,
  );
  return rows.length;
}

export type VacateInput =
  | { userId: string; spaceId?: string; actorId: string; reason: 'member_removed' }
  | { userId: string; spaceId?: string; actorId: null; reason: 'allowlist_removed' };

interface VacatedRow extends Record<string, unknown> {
  change_request_id: string;
  document_id: string;
  space_id: string;
}

/**
 * A kiesett felhasználó függő review-er helyei megszűnnek (D51 b): az aktív sor `ended_at` +
 * `end_reason = 'removed'` a döntéstől függetlenül (a távozó döntése elvész, így nem számít bele a két jóváhagyásba;
 * a másik review-er döntése érintetlen), `reviewer_removed` esemény. `spaceId`-val csak az adott tér, nélküle minden
 * tér (az allowlist-szinkron). Visszaadja az érintett kérések számát; a kérés a pótlásig nem dönthető el (`change_requests_guard`).
 */
export async function vacateReviewer(tx: ReviewTx, input: VacateInput, now: Date): Promise<number> {
  const spaceFilter = input.spaceId === undefined ? sql`TRUE` : sql`d.space_id = ${input.spaceId}`;
  const result = await tx.execute<VacatedRow>(sql`
    UPDATE change_request_reviewers r
       SET ended_at = ${now}::timestamptz, end_reason = 'removed'
      FROM change_requests c
      JOIN documents d ON d.id = c.document_id
     WHERE c.id = r.change_request_id AND c.state = 'pending'
       AND r.reviewer_id = ${input.userId} AND r.ended_at IS NULL
       AND ${spaceFilter}
    RETURNING c.id AS change_request_id, c.document_id, d.space_id`);
  const events: AppEvent[] = result.rows.map((row) =>
    input.actorId === null
      ? {
          type: 'reviewer_removed',
          spaceId: row.space_id,
          documentId: row.document_id,
          changeRequestId: row.change_request_id,
          actorId: null,
          details: { reviewerId: input.userId, reason: 'allowlist_removed' },
        }
      : {
          type: 'reviewer_removed',
          spaceId: row.space_id,
          documentId: row.document_id,
          changeRequestId: row.change_request_id,
          actorId: input.actorId,
          details: { reviewerId: input.userId, reason: 'member_removed' },
        },
  );
  await recordEvents(tx, events, now);
  return events.length;
}
