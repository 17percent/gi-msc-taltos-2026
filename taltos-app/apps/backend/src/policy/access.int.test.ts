import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '../db/schema.js';
import { createTestDb, type TestDb } from '../db/test-db.js';
import { describeAccessStoreContract, type ContractIds } from './access-store-contract.js';
import { createPgAccessStore } from './pg-access-store.js';
import { visibleDocumentsWhere, visibleSpacesWhere } from './visibility.js';

/**
 * Jogosultsági adatelérés és láthatóság PostgreSQL ellen (WP4a S3). Eldobható adatbázison fut, csak
 * `TEST_DATABASE_URL`-lel (CI `db` job); az adathalmaz a közös szerződésé (`ContractIds`), az app-szerepkörű
 * kapcsolaton át olvassuk. A betöltést a superuser kapcsolat végzi `replica` módban (a triggerek és az FK-k nélkül,
 * csak a CHECK-ek érvényesek): a teszt a jogosultsági olvasást vizsgálja, nem a séma-invariánsokat.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('AccessStore és láthatóság (PostgreSQL, WP4a)', () => {
  let db: TestDb;
  let ids: ContractIds;

  beforeAll(async () => {
    db = await createTestDb(url as string);
    ids = await seed(db);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  }, 60_000);

  describeAccessStoreContract('PostgreSQL', () =>
    Promise.resolve({ store: createPgAccessStore(drizzle(db.app)), ids }),
  );

  describe('visibleDocumentsWhere / visibleSpacesWhere', () => {
    const docIds = (viewer: string) =>
      drizzle(db.app)
        .select({ id: t.documents.id })
        .from(t.documents)
        .where(visibleDocumentsWhere(viewer))
        .then((rows) => rows.map((row) => row.id).sort());
    const spaceIds = (viewer: string) =>
      drizzle(db.app)
        .select({ id: t.spaces.id })
        .from(t.spaces)
        .where(visibleSpacesWhere(viewer))
        .then((rows) => rows.map((row) => row.id).sort());

    it('a nem tag 0 dokumentumot és 0 színteret lát', async () => {
      expect(await docIds(ids.outsider)).toEqual([]);
      expect(await spaceIds(ids.outsider)).toEqual([]);
    });

    it('a nem tag Rendszeradmin 0 dokumentumot lát (nincs admin-kivétel a tartalomra)', async () => {
      expect(await docIds(ids.admin)).toEqual([]);
    });

    it('a megszűnt tagság nem lát semmit', async () => {
      expect(await docIds(ids.removed)).toEqual([]);
      expect(await spaceIds(ids.removed)).toEqual([]);
    });

    it('a tag a színtér dokumentumait látja (a deleted_at szűrése a hívó dolga)', async () => {
      expect(await docIds(ids.author)).toEqual(
        [ids.doc, ids.archivedDoc, ids.droppedDraft, ids.pendingDoc].sort(),
      );
      expect(await spaceIds(ids.author)).toEqual([ids.space]);
    });

    it('a lezárt tér látható, a törölt tér és dokumentumai nem', async () => {
      expect(await spaceIds(ids.manager)).toEqual([ids.space, ids.closedSpace].sort());
      expect(await docIds(ids.manager)).not.toContain(ids.docInDeletedSpace);
      const rows = await drizzle(db.app)
        .select({ id: t.spaces.id })
        .from(t.spaces)
        .where(inArray(t.spaces.id, [ids.deletedSpace]));
      // a törölt tér létezik a táblában, de a feltétel kiszűri
      expect(rows).toHaveLength(1);
      expect(await spaceIds(ids.manager)).not.toContain(ids.deletedSpace);
    });

    it('a nem létező néző azonosítóval is 0 sor (és nem hiba)', async () => {
      expect(await docIds(randomUUID())).toEqual([]);
    });

    it('a pending dokumentum a tagnak látható; a feltétel nem szűr állapotra', async () => {
      const rows = await drizzle(db.app)
        .select({ id: t.documents.id })
        .from(t.documents)
        .where(eq(t.documents.id, ids.pendingDoc));
      expect(rows).toHaveLength(1);
      expect(await docIds(ids.reviewer)).toContain(ids.pendingDoc);
    });
  });
});

async function seed(db: TestDb): Promise<ContractIds> {
  const ids: ContractIds = {
    manager: randomUUID(),
    author: randomUUID(),
    outsider: randomUUID(),
    admin: randomUUID(),
    removed: randomUUID(),
    reviewer: randomUUID(),
    requester: randomUUID(),
    space: randomUUID(),
    closedSpace: randomUUID(),
    deletedSpace: randomUUID(),
    missing: randomUUID(),
    doc: randomUUID(),
    archivedDoc: randomUUID(),
    droppedDraft: randomUUID(),
    pendingDoc: randomUUID(),
    docInDeletedSpace: randomUUID(),
  };
  const client = await db.admin.connect();
  try {
    await client.query('SET session_replication_role = replica');
    const users: [string, string, 'user' | 'system_admin'][] = [
      [ids.manager, 'Kiss Anna', 'user'],
      [ids.author, 'Nagy Béla', 'user'],
      [ids.outsider, 'Kívülálló', 'user'],
      [ids.admin, 'Admin', 'system_admin'],
      [ids.removed, 'Kilépett', 'user'],
      [ids.reviewer, 'Review-er', 'user'],
      [ids.requester, 'Kérelmező', 'user'],
    ];
    for (const [id, name, role] of users) {
      await client.query(
        'INSERT INTO users (id, display_name, email, system_role) VALUES ($1, $2, $3, $4)',
        [id, name, `${id}@example.test`, role],
      );
    }
    const spaces: [string, string, 'team' | 'project', boolean, boolean][] = [
      [ids.space, 'Adatplatform', 'team', false, false],
      [ids.closedSpace, 'Régi projekt', 'project', true, false],
      [ids.deletedSpace, 'Törölt tér', 'team', false, true],
    ];
    for (const [id, name, type, closed, deleted] of spaces) {
      await client.query(
        `INSERT INTO spaces (id, name, type, color, created_by, closed_at, deleted_at)
         VALUES ($1, $2, $3, '#3B6FB6', $4, ${closed ? 'now()' : 'NULL'}, ${deleted ? 'now()' : 'NULL'})`,
        [id, name, type, ids.admin],
      );
    }
    const members: [string, string, 'author' | 'space_manager', boolean][] = [
      [ids.space, ids.manager, 'space_manager', false],
      [ids.space, ids.author, 'author', false],
      [ids.space, ids.reviewer, 'author', false],
      [ids.space, ids.removed, 'author', true],
      [ids.closedSpace, ids.manager, 'space_manager', false],
    ];
    for (const [spaceId, userId, role, removed] of members) {
      await client.query(
        `INSERT INTO space_members (space_id, user_id, role, added_by, removed_at)
         VALUES ($1, $2, $3, $4, ${removed ? 'now()' : 'NULL'})`,
        [spaceId, userId, role, ids.admin],
      );
    }
    const docs: [string, string, string, boolean, boolean][] = [
      // id, tér, állapot, törölt, volt jóváhagyott változata
      [ids.doc, ids.space, 'draft', false, false],
      [ids.archivedDoc, ids.space, 'draft', true, true],
      [ids.droppedDraft, ids.space, 'draft', true, false],
      [ids.pendingDoc, ids.space, 'pending', false, false],
      [ids.docInDeletedSpace, ids.deletedSpace, 'draft', false, false],
    ];
    for (const [id, spaceId, state, deleted, approved] of docs) {
      await client.query(
        `INSERT INTO documents (id, space_id, slug, title, kind, owner_id, created_by, review_state,
                                approved_revision_id, deleted_at)
         VALUES ($1, $2, $3, 'Cím', 'prompt', $4, $4, $5, $6, ${deleted ? 'now()' : 'NULL'})`,
        [id, spaceId, `d-${id}`, ids.author, state, approved ? randomUUID() : null],
      );
    }
    const crId = randomUUID();
    await client.query(
      `INSERT INTO change_requests (id, document_id, kind, proposed_revision_id, proposed_review_due_at, initiator_id)
       VALUES ($1, $2, 'create', $3, now() + interval '1 year', $4)`,
      [crId, ids.pendingDoc, randomUUID(), ids.author],
    );
    await client.query(
      'INSERT INTO change_request_reviewers (change_request_id, reviewer_id) VALUES ($1, $2)',
      [crId, ids.reviewer],
    );
    await client.query(`INSERT INTO membership_requests (space_id, user_id) VALUES ($1, $2)`, [
      ids.space,
      ids.requester,
    ]);
  } finally {
    await client.query('SET session_replication_role = DEFAULT');
    client.release();
  }
  return ids;
}
