import { describe, expect, it } from 'vitest';
import type { AccessStore } from './access-store.js';

/** A fixture azonosítói; mindkét adapter (memória, PostgreSQL) ugyanezt az adathalmazt kapja. */
export interface ContractIds {
  manager: string;
  author: string;
  outsider: string;
  admin: string;
  removed: string;
  reviewer: string;
  /** Nem tag, függő felvételi kérése van a `space`-be. */
  requester: string;
  space: string;
  closedSpace: string;
  deletedSpace: string;
  missing: string;
  doc: string;
  archivedDoc: string;
  droppedDraft: string;
  pendingDoc: string;
  docInDeletedSpace: string;
}

/**
 * Az `AccessStore` közös szerződése. A hívó előkészíti az adathalmazt:
 *  - `space` (csapat, nyitott): `manager` (Színtérgazda), `author` (Szerző), `removed` (megszűnt tagság), nem tag: `outsider`, `admin`;
 *    az `outsider`-nek nincs függő kérése a `space`-be, a `requester`-nek van; a `closedSpace`-ben az `outsider` nem tag;
 *  - `closedSpace` (projekt, lezárt) és `deletedSpace` (törölt);
 *  - `doc` (a `space`-ben, tulajdonos: `author`, Piszkozat); `archivedDoc` (archivált, volt jóváhagyott változata);
 *    `droppedDraft` (eldobott piszkozat); `pendingDoc` (függő kérés: indítványozó `author`, aktív review-er `reviewer`);
 *    `docInDeletedSpace`;
 *  - a `manager` megjelenített neve „Kiss Anna”, a `space` neve „Adatplatform”.
 */
export function describeAccessStoreContract(
  name: string,
  setup: () => Promise<{ store: AccessStore; ids: ContractIds }>,
): void {
  describe(`${name}: AccessStore-szerződés`, () => {
    it('spaceTarget: az aktív tag szerepét adja, a nem tagnak null a tagsága', async () => {
      const { store, ids } = await setup();
      expect(await store.spaceTarget(ids.manager, ids.space)).toEqual({
        spaceId: ids.space,
        type: 'team',
        closed: false,
        membership: 'space_manager',
      });
      expect((await store.spaceTarget(ids.author, ids.space))?.membership).toBe('author');
      expect((await store.spaceTarget(ids.outsider, ids.space))?.membership).toBeNull();
      expect((await store.spaceTarget(ids.admin, ids.space))?.membership).toBeNull();
    });

    it('spaceTarget: a megszűnt tagság nem tagság (nem gyorsítótárazott)', async () => {
      const { store, ids } = await setup();
      expect((await store.spaceTarget(ids.removed, ids.space))?.membership).toBeNull();
    });

    it('spaceTarget: a lezárt tér lezártnak látszik, a törölt vagy nem létező tér undefined', async () => {
      const { store, ids } = await setup();
      expect(await store.spaceTarget(ids.manager, ids.closedSpace)).toMatchObject({
        type: 'project',
        closed: true,
      });
      expect(await store.spaceTarget(ids.manager, ids.deletedSpace)).toBeUndefined();
      expect(await store.spaceTarget(ids.manager, ids.missing)).toBeUndefined();
    });

    it('documentTarget: tulajdonos, állapot, színtér és tagság egyetlen betöltésből', async () => {
      const { store, ids } = await setup();
      expect(await store.documentTarget(ids.author, ids.doc)).toEqual({
        documentId: ids.doc,
        space: { spaceId: ids.space, type: 'team', closed: false, membership: 'author' },
        ownerId: ids.author,
        archived: false,
        reviewState: 'draft',
      });
      expect((await store.documentTarget(ids.outsider, ids.doc))?.space.membership).toBeNull();
    });

    it('documentTarget: az archivált betöltődik, az eldobott piszkozat, a törölt térbeli és a nem létező undefined', async () => {
      const { store, ids } = await setup();
      expect((await store.documentTarget(ids.manager, ids.archivedDoc))?.archived).toBe(true);
      expect(await store.documentTarget(ids.manager, ids.droppedDraft)).toBeUndefined();
      expect(await store.documentTarget(ids.manager, ids.docInDeletedSpace)).toBeUndefined();
      expect(await store.documentTarget(ids.manager, ids.missing)).toBeUndefined();
    });

    it('documentTarget: a függő kérés indítványozója és a megjelölt review-er', async () => {
      const { store, ids } = await setup();
      expect(await store.documentTarget(ids.reviewer, ids.pendingDoc)).toMatchObject({
        reviewState: 'pending',
        initiatorId: ids.author,
        isDesignatedReviewer: true,
      });
      expect(await store.documentTarget(ids.manager, ids.pendingDoc)).toMatchObject({
        initiatorId: ids.author,
        isDesignatedReviewer: false,
      });
      const plain = await store.documentTarget(ids.manager, ids.doc);
      expect(plain).not.toHaveProperty('initiatorId');
      expect(plain).not.toHaveProperty('isDesignatedReviewer');
    });

    it('denialDetails: színtér-név, gazdák és a felvételi kérés lehetősége; cím és darabszám nélkül', async () => {
      const { store, ids } = await setup();
      const details = await store.denialDetails(
        { userId: ids.outsider, systemRole: 'user' },
        ids.space,
      );
      expect(details).toEqual({
        space: { id: ids.space, name: 'Adatplatform' },
        managers: [{ id: ids.manager, displayName: 'Kiss Anna', avatarUrl: null }],
        canRequestMembership: true,
      });
      const keys = JSON.stringify(details);
      expect(keys).not.toMatch(/title|count|memberCount/i);
    });

    it('denialDetails: a Rendszeradmin nem kérhet felvételt (önfelvétel), lezárt térbe senki', async () => {
      const { store, ids } = await setup();
      expect(
        (await store.denialDetails({ userId: ids.admin, systemRole: 'system_admin' }, ids.space))
          ?.canRequestMembership,
      ).toBe(false);
      expect(
        (await store.denialDetails({ userId: ids.outsider, systemRole: 'user' }, ids.closedSpace))
          ?.canRequestMembership,
      ).toBe(false);
    });

    it('denialDetails: függő kérésnél nem kérhet újra; törölt vagy nem létező térre undefined', async () => {
      const { store, ids } = await setup();
      expect(
        (await store.denialDetails({ userId: ids.requester, systemRole: 'user' }, ids.space))
          ?.canRequestMembership,
      ).toBe(false);
      expect(
        await store.denialDetails({ userId: ids.outsider, systemRole: 'user' }, ids.deletedSpace),
      ).toBeUndefined();
      expect(
        await store.denialDetails({ userId: ids.outsider, systemRole: 'user' }, ids.missing),
      ).toBeUndefined();
    });
  });
}
