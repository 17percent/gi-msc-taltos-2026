import { describe, expect, it } from 'vitest';
import type { RevisionMetadata, SpaceType } from '@taltos/shared';
import type { Actor } from '../policy/targets.js';
import type { TagStore } from '../tags/store.js';
import type { DocumentStore } from './store.js';

/**
 * Az adapter-specifikus fixture és megfigyelés (mint a `StoreHarness` a `SpaceStore`-nál): a szerződés teszt ezen át
 * tölti fel és olvassa a világot, így ugyanaz a forgatókönyv fut a memóriabeli és a PostgreSQL-adapteren. Minden hívás
 * friss, egyedi azonosítókat ad.
 */
export interface DocumentHarness {
  documents: DocumentStore;
  tags: TagStore;
  user(name: string, options?: { admin?: boolean }): Promise<string>;
  space(options?: { type?: SpaceType; closed?: boolean }): Promise<string>;
  member(spaceId: string, userId: string): Promise<void>;
  /** Színtérgazda tagság. */
  manager(spaceId: string, userId: string): Promise<void>;
  /** A felhasználó mint hívó (a rendszerszerepe a `user()` hívásból). */
  actor(userId: string): Actor;
  /** A fajta felvétele a listába (`deleted`: törölt fajta). */
  kind(key: string, options?: { deleted?: boolean }): Promise<void>;
  /** Közvetlenül felvett címke (a `POST /tags` nélkül), az azonosítóját adja. */
  tag(name: string): Promise<string>;
  /** Egy dokumentum az adott állapotban, a fixture-be írva (a tár használata nélkül). */
  document(
    spaceId: string,
    ownerId: string,
    options?: {
      title?: string;
      content?: string;
      kind?: string;
      tagIds?: string[];
      /** Volt Jóváhagyott revíziója (az élő tartalom eltérhet tőle). */
      approved?: { content: string; title?: string; kind?: string; tagIds?: string[] };
      /** Jóváhagyott törléssel archivált (a Jóváhagyott revízióval együtt). */
      archived?: boolean;
      /** Eldobott piszkozat (`deleted_at` beállítva, Jóváhagyott revízió nélkül). */
      discarded?: boolean;
      /** Függő review-kérése van (Review-ra vár). */
      pending?: boolean;
      /** Volt, de lezárt (elutasított) kérése: Átdolgozandó. */
      rejectedRequest?: boolean;
    },
  ): Promise<string>;
  inspect: {
    document(id: string): Promise<
      | {
          slug: string;
          title: string;
          kind: string;
          ownerId: string;
          spaceId: string;
          content: string;
          tagText: string;
          reviewState: string;
          deleted: boolean;
          approvedRevisionId: string | null;
          iteration: number;
        }
      | undefined
    >;
    revisions(
      id: string,
    ): Promise<
      { id: string; title: string; content: string; metadata: RevisionMetadata; authorId: string }[]
    >;
    tagIds(documentId: string): Promise<string[]>;
    /** A dokumentumból kiinduló kapcsolatok. */
    links(documentId: string): Promise<{ toId: string; type: string }[]>;
    /** Az összes esemény sorrendben. */
    events(): Promise<
      {
        type: string;
        spaceId: string | null;
        documentId: string | null;
        actorId: string | null;
        details: Record<string, unknown>;
      }[]
    >;
    /** A `document_collab_state` sorai a dokumentumra (a létrehozás nem ír ilyet). */
    collabStates(documentId: string): Promise<number>;
    /** Az összes dokumentum száma (a sikertelen létrehozás nem hagy nyomot). */
    documentCount(): Promise<number>;
  };
}

const NOW = new Date('2026-11-06T09:00:00Z');

/**
 * A `DocumentStore` közös szerződése (WP5a: létrehozás üresen és duplikálással, első revízió, olvasás, eldobás). A
 * HTTP-réteg és az `AccessStore`-os döntés nincs benne: azt a `documents.http.test.ts` és a `policy.test.ts` fedi.
 */
export function describeDocumentStoreContract(
  name: string,
  setup: () => Promise<DocumentHarness>,
): void {
  describe(`${name}: DocumentStore-szerződés`, () => {
    async function world() {
      const h = await setup();
      const owner = await h.user('owner');
      const space = await h.space();
      await h.member(space, owner);
      await h.kind('prompt');
      return { h, owner, space };
    }

    describe('createDocument: üres', () => {
      it('Piszkozatot hoz létre, első revízióval, amely nem véglegesít, és Yjs-állapot nélkül', async () => {
        const { h, owner, space } = await world();
        const result = await h.documents.createDocument(
          h.actor(owner),
          { spaceId: space, title: 'Árvíztűrő tükörfúrógép', kind: 'prompt', tagIds: [] },
          NOW,
        );
        if (!result.ok) throw new Error(result.code);
        const detail = result.value;
        expect(detail).toMatchObject({
          spaceId: space,
          slug: 'arvizturo-tukorfurogep',
          title: 'Árvíztűrő tükörfúrógép',
          kind: 'prompt',
          reviewState: 'draft',
          approvedRevisionId: null,
          iteration: 0,
          archived: false,
          tags: [],
          approvedMetadata: null,
        });
        expect(detail.owner.id).toBe(owner);

        const stored = await h.inspect.document(detail.id);
        expect(stored).toMatchObject({
          ownerId: owner,
          content: '',
          reviewState: 'draft',
          deleted: false,
          approvedRevisionId: null,
          iteration: 0,
        });
        const revisions = await h.inspect.revisions(detail.id);
        expect(revisions).toHaveLength(1);
        expect(revisions[0]).toMatchObject({
          title: 'Árvíztűrő tükörfúrógép',
          content: '',
          authorId: owner,
          metadata: { kind: 'prompt', tagIds: [], links: [] },
        });
        expect(await h.inspect.collabStates(detail.id)).toBe(0);
        expect(await h.inspect.links(detail.id)).toEqual([]);
        expect(await h.inspect.events()).toEqual([
          {
            type: 'created',
            spaceId: space,
            documentId: detail.id,
            actorId: owner,
            details: {},
          },
        ]);
      });

      it('a címkék a létrehozással együtt állnak be: document_tags, tag_text, a pillanatkép rendezett azonosítói', async () => {
        const { h, owner, space } = await world();
        const [zeta, alfa] = [await h.tag('zeta'), await h.tag('alfa')];
        const result = await h.documents.createDocument(
          h.actor(owner),
          { spaceId: space, title: 'Címkés', kind: 'prompt', tagIds: [zeta, alfa, zeta] },
          NOW,
        );
        if (!result.ok) throw new Error(result.code);
        const id = result.value.id;
        expect(result.value.tags.map((t) => t.name)).toEqual(['alfa', 'zeta']);
        expect([...(await h.inspect.tagIds(id))].sort()).toEqual([alfa, zeta].sort());
        // a `tag_text` a címkenevek rendezve, szóközzel (B4 S9: a DB-trigger állítja)
        expect((await h.inspect.document(id))?.tagText).toBe('alfa zeta');
        const [revision] = await h.inspect.revisions(id);
        expect(revision?.metadata.tagIds).toEqual([alfa, zeta].sort());
      });

      it('a slug a címből készül; ütközésnél rövid utótaggal, más térben újra az alap', async () => {
        const { h, owner, space } = await world();
        const other = await h.space();
        await h.member(other, owner);
        const slugOf = async (spaceId: string) => {
          const result = await h.documents.createDocument(
            h.actor(owner),
            { spaceId, title: 'Ugyanaz a Cím!', kind: 'prompt', tagIds: [] },
            NOW,
          );
          if (!result.ok) throw new Error(result.code);
          return result.value.slug;
        };
        expect(await slugOf(space)).toBe('ugyanaz-a-cim');
        const second = await slugOf(space);
        expect(second).toMatch(/^ugyanaz-a-cim-[0-9a-f]{6}$/);
        expect(await slugOf(space)).not.toBe(second);
        expect(await slugOf(other)).toBe('ugyanaz-a-cim');
      });

      it('a csak írásjelből álló cím slugja a tartalék alap', async () => {
        const { h, owner, space } = await world();
        const result = await h.documents.createDocument(
          h.actor(owner),
          { spaceId: space, title: '???', kind: 'prompt', tagIds: [] },
          NOW,
        );
        if (!result.ok) throw new Error(result.code);
        expect(result.value.slug).toBe('dokumentum');
      });

      it('ismeretlen vagy törölt fajta, ismeretlen címke: validation_error, nyom nélkül', async () => {
        const { h, owner, space } = await world();
        await h.kind('regi', { deleted: true });
        const create = (kind: string, tagIds: string[] = []) =>
          h.documents.createDocument(
            h.actor(owner),
            { spaceId: space, title: 'Cím', kind, tagIds },
            NOW,
          );
        expect(await create('nincs-ilyen')).toMatchObject({ ok: false, code: 'validation_error' });
        expect(await create('regi')).toMatchObject({ ok: false, code: 'validation_error' });
        expect(await create('prompt', ['00000000-0000-4000-8000-000000000000'])).toMatchObject({
          ok: false,
          code: 'validation_error',
        });
        expect(await h.inspect.documentCount()).toBe(0);
        expect(await h.inspect.events()).toEqual([]);
      });

      it('a policy a tár zára alatt is érvényes: nem tag, Rendszeradmin tagság nélkül, lezárt tér, hiányzó tér', async () => {
        const { h, owner, space } = await world();
        const outsider = await h.user('outsider');
        const root = await h.user('root', { admin: true });
        const closed = await h.space({ closed: true });
        await h.member(closed, owner);
        const attempt = (actor: Actor, spaceId: string) =>
          h.documents.createDocument(
            actor,
            { spaceId, title: 'Cím', kind: 'prompt', tagIds: [] },
            NOW,
          );
        expect(await attempt(h.actor(outsider), space)).toMatchObject({
          ok: false,
          code: 'not_space_member',
        });
        expect(await attempt(h.actor(root), space)).toMatchObject({
          ok: false,
          code: 'not_space_member',
        });
        expect(await attempt(h.actor(owner), closed)).toMatchObject({
          ok: false,
          code: 'space_closed',
        });
        expect(await attempt(h.actor(owner), '00000000-0000-4000-8000-000000000000')).toMatchObject(
          { ok: false, code: 'not_found' },
        );
        expect(await h.inspect.documentCount()).toBe(0);
      });
    });

    describe('createDocument: duplikálás', () => {
      it('forrás Jóváhagyott revízió nélkül: az élő tartalom másolódik; származik kapcsolat, esemény mindkét oldalon', async () => {
        const { h, owner, space } = await world();
        const target = await h.space();
        await h.member(target, owner);
        const source = await h.document(space, owner, { content: 'élő szöveg' });
        const result = await h.documents.createDocument(
          h.actor(owner),
          {
            spaceId: target,
            title: 'Másolat',
            kind: 'prompt',
            tagIds: [],
            sourceDocumentId: source,
          },
          NOW,
        );
        if (!result.ok) throw new Error(result.code);
        const id = result.value.id;
        expect(result.value.spaceId).toBe(target);
        const stored = await h.inspect.document(id);
        expect(stored).toMatchObject({
          content: 'élő szöveg',
          reviewState: 'draft',
          ownerId: owner,
        });
        const [revision] = await h.inspect.revisions(id);
        expect(revision).toMatchObject({
          content: 'élő szöveg',
          metadata: { links: [{ toId: source, type: 'szarmazik', anchor: null }] },
        });
        expect(await h.inspect.links(id)).toEqual([{ toId: source, type: 'szarmazik' }]);
        // a forráson semmi nem változik
        expect((await h.inspect.document(source))?.content).toBe('élő szöveg');
        expect(await h.inspect.links(source)).toEqual([]);

        const events = await h.inspect.events();
        expect(events.map((e) => e.type).sort()).toEqual([
          'created',
          'duplicated_from',
          'duplicated_from',
        ]);
        expect(events.find((e) => e.type === 'duplicated_from' && e.documentId === id)).toEqual({
          type: 'duplicated_from',
          spaceId: target,
          documentId: id,
          actorId: owner,
          details: { sourceDocumentId: source, sourceSpaceId: space, sourceRevisionId: null },
        });
        expect(events.find((e) => e.type === 'duplicated_from' && e.documentId === source)).toEqual(
          {
            type: 'duplicated_from',
            spaceId: space,
            documentId: source,
            actorId: owner,
            details: { targetDocumentId: id, targetSpaceId: target },
          },
        );
      });

      it('a Jóváhagyott revízió tartalmát másolja, ha van (eltérő élő tartalom mellett); az esemény a revíziót hordozza', async () => {
        const { h, owner, space } = await world();
        const source = await h.document(space, owner, {
          content: 'ÉLŐ, még review-zatlan módosítás',
          approved: { content: 'jóváhagyott szöveg' },
        });
        const approvedRevisionId = (await h.inspect.document(source))?.approvedRevisionId;
        expect(approvedRevisionId).toBeTruthy();
        const result = await h.documents.createDocument(
          h.actor(owner),
          {
            spaceId: space,
            title: 'Másolat',
            kind: 'prompt',
            tagIds: [],
            sourceDocumentId: source,
          },
          NOW,
        );
        if (!result.ok) throw new Error(result.code);
        expect((await h.inspect.document(result.value.id))?.content).toBe('jóváhagyott szöveg');
        const [revision] = await h.inspect.revisions(result.value.id);
        expect(revision?.content).toBe('jóváhagyott szöveg');
        const copySide = (await h.inspect.events()).find(
          (e) => e.type === 'duplicated_from' && e.documentId === result.value.id,
        );
        expect(copySide?.details).toMatchObject({ sourceRevisionId: approvedRevisionId });
      });

      it('archivált forrás is duplikálható (a Jóváhagyott revízióból)', async () => {
        const { h, owner, space } = await world();
        const source = await h.document(space, owner, {
          content: 'élő',
          archived: true,
          approved: { content: 'archivált jóváhagyott' },
        });
        const result = await h.documents.createDocument(
          h.actor(owner),
          {
            spaceId: space,
            title: 'Feltámasztott',
            kind: 'prompt',
            tagIds: [],
            sourceDocumentId: source,
          },
          NOW,
        );
        if (!result.ok) throw new Error(result.code);
        expect((await h.inspect.document(result.value.id))?.content).toBe('archivált jóváhagyott');
      });

      it('eldobott forrás és nem látható (nem tag) forrás: not_found, nyom nélkül', async () => {
        const { h, owner, space } = await world();
        const foreign = await h.space();
        const stranger = await h.user('stranger');
        await h.member(foreign, stranger);
        const hidden = await h.document(foreign, stranger, { content: 'titok' });
        const discarded = await h.document(space, owner, { discarded: true });
        const before = await h.inspect.documentCount();
        for (const sourceDocumentId of [hidden, discarded]) {
          expect(
            await h.documents.createDocument(
              h.actor(owner),
              { spaceId: space, title: 'Másolat', kind: 'prompt', tagIds: [], sourceDocumentId },
              NOW,
            ),
          ).toMatchObject({ ok: false, code: 'not_found' });
        }
        expect(await h.inspect.documentCount()).toBe(before);
        expect(await h.inspect.events()).toEqual([]);
      });

      it('idegen forrás: a másik tagság megvonása után a forrás láthatatlan; a cél tagsága kell', async () => {
        const { h, owner, space } = await world();
        const closed = await h.space({ closed: true });
        await h.member(closed, owner);
        const source = await h.document(space, owner, { content: 'x' });
        // lezárt célba nem lehet másolni
        expect(
          await h.documents.createDocument(
            h.actor(owner),
            { spaceId: closed, title: 'Cím', kind: 'prompt', tagIds: [], sourceDocumentId: source },
            NOW,
          ),
        ).toMatchObject({ ok: false, code: 'space_closed' });
        // lezárt térből viszont lehet másolni (olvasás)
        const fromClosed = await h.document(closed, owner, { content: 'lezárt tartalom' });
        const copy = await h.documents.createDocument(
          h.actor(owner),
          {
            spaceId: space,
            title: 'Lezártból',
            kind: 'prompt',
            tagIds: [],
            sourceDocumentId: fromClosed,
          },
          NOW,
        );
        if (!copy.ok) throw new Error(copy.code);
        expect((await h.inspect.document(copy.value.id))?.content).toBe('lezárt tartalom');
      });
    });

    describe('getDocument', () => {
      it('a tag látja az élő metaadatot és az állapotot; a nem tag, az eldobott és a hiányzó nem létezik', async () => {
        const { h, owner, space } = await world();
        const outsider = await h.user('outsider');
        const tag = await h.tag('címke');
        const id = await h.document(space, owner, { title: 'Látható', tagIds: [tag] });
        const detail = await h.documents.getDocument(owner, id);
        expect(detail).toMatchObject({
          id,
          spaceId: space,
          title: 'Látható',
          kind: 'prompt',
          reviewState: 'draft',
          approvedRevisionId: null,
          iteration: 0,
          archived: false,
          approvedMetadata: null,
          tags: [{ id: tag, name: 'címke' }],
        });
        expect(detail?.owner.id).toBe(owner);
        expect(await h.documents.getDocument(outsider, id)).toBeUndefined();
        const discarded = await h.document(space, owner, { discarded: true });
        expect(await h.documents.getDocument(owner, discarded)).toBeUndefined();
        expect(
          await h.documents.getDocument(owner, '00000000-0000-4000-8000-000000000000'),
        ).toBeUndefined();
      });

      it('az archivált dokumentum olvasható; az approvedMetadata a Jóváhagyott revízió pillanatképe feloldott címkenevekkel', async () => {
        const { h, owner, space } = await world();
        await h.kind('skill');
        const [a, b] = [await h.tag('régi'), await h.tag('új')];
        const id = await h.document(space, owner, {
          title: 'Élő cím',
          kind: 'prompt',
          tagIds: [b],
          archived: true,
          approved: { title: 'Jóváhagyott cím', kind: 'skill', content: 'x', tagIds: [a] },
        });
        const detail = await h.documents.getDocument(owner, id);
        expect(detail).toMatchObject({ archived: true, title: 'Élő cím', kind: 'prompt' });
        expect(detail?.approvedRevisionId).toBeTruthy();
        expect(detail?.approvedMetadata).toEqual({
          revisionId: detail?.approvedRevisionId,
          title: 'Jóváhagyott cím',
          kind: 'skill',
          tags: [{ id: a, name: 'régi' }],
          links: [],
        });
        expect(detail?.tags).toEqual([{ id: b, name: 'új' }]);
      });
    });

    describe('discardDraft', () => {
      it('a tulajdonos eldobja: a dokumentum eltűnik, draft_discarded esemény, a Jóváhagyott állapot érintetlen', async () => {
        const { h, owner, space } = await world();
        const id = await h.document(space, owner, {});
        expect(await h.documents.discardDraft(h.actor(owner), id, NOW)).toEqual({
          ok: true,
          value: null,
        });
        expect(await h.documents.getDocument(owner, id)).toBeUndefined();
        const stored = await h.inspect.document(id);
        expect(stored).toMatchObject({ deleted: true, approvedRevisionId: null, iteration: 0 });
        expect(await h.inspect.events()).toEqual([
          { type: 'draft_discarded', spaceId: space, documentId: id, actorId: owner, details: {} },
        ]);
      });

      it('a Színtérgazda más piszkozatát is eldobhatja; a nem tulajdonos Szerző nem', async () => {
        const { h, owner, space } = await world();
        const manager = await h.user('manager');
        const author = await h.user('author');
        await h.manager(space, manager);
        await h.member(space, author);
        const mine = await h.document(space, owner, {});
        expect(await h.documents.discardDraft(h.actor(author), mine, NOW)).toMatchObject({
          ok: false,
          code: 'forbidden',
        });
        expect((await h.inspect.document(mine))?.deleted).toBe(false);
        expect((await h.documents.discardDraft(h.actor(manager), mine, NOW)).ok).toBe(true);
      });

      it('lezárt térben space_closed; nem tagnak és Rendszeradminnak (tagság nélkül) not_space_member', async () => {
        const { h, owner, space } = await world();
        const closed = await h.space({ closed: true });
        await h.member(closed, owner);
        const outsider = await h.user('outsider');
        const root = await h.user('root', { admin: true });
        const inClosed = await h.document(closed, owner, {});
        const open = await h.document(space, owner, {});
        expect(await h.documents.discardDraft(h.actor(owner), inClosed, NOW)).toMatchObject({
          ok: false,
          code: 'space_closed',
        });
        expect(await h.documents.discardDraft(h.actor(outsider), open, NOW)).toMatchObject({
          ok: false,
          code: 'not_space_member',
        });
        expect(await h.documents.discardDraft(h.actor(root), open, NOW)).toMatchObject({
          ok: false,
          code: 'not_space_member',
        });
        expect((await h.inspect.document(inClosed))?.deleted).toBe(false);
        expect((await h.inspect.document(open))?.deleted).toBe(false);
      });

      it('409: függő kérésnél request_pending; Jóváhagyott revíziónál, archiváltnál és lezárt (elutasított) kérésnél has_approved_revision', async () => {
        const { h, owner, space } = await world();
        const pending = await h.document(space, owner, { pending: true });
        const approved = await h.document(space, owner, { approved: { content: 'x' } });
        const archived = await h.document(space, owner, {
          archived: true,
          approved: { content: 'x' },
        });
        const rejected = await h.document(space, owner, { rejectedRequest: true });
        const outcome = async (id: string) => {
          const result = await h.documents.discardDraft(h.actor(owner), id, NOW);
          return result.ok ? 'ok' : result.code;
        };
        expect(await outcome(pending)).toBe('request_pending');
        expect(await outcome(approved)).toBe('has_approved_revision');
        expect(await outcome(archived)).toBe('has_approved_revision');
        expect(await outcome(rejected)).toBe('has_approved_revision');
        for (const id of [pending, approved, archived, rejected]) {
          expect((await h.inspect.document(id))?.deleted ?? false).toBe(id === archived);
        }
        expect(await h.inspect.events()).toEqual([]);
      });

      it('nem létező és már eldobott dokumentum: not_found; a második eldobás nem ír eseményt', async () => {
        const { h, owner, space } = await world();
        const id = await h.document(space, owner, {});
        expect((await h.documents.discardDraft(h.actor(owner), id, NOW)).ok).toBe(true);
        expect(await h.documents.discardDraft(h.actor(owner), id, NOW)).toMatchObject({
          ok: false,
          code: 'not_found',
        });
        expect(
          await h.documents.discardDraft(
            h.actor(owner),
            '00000000-0000-4000-8000-000000000000',
            NOW,
          ),
        ).toMatchObject({ ok: false, code: 'not_found' });
        expect((await h.inspect.events()).filter((e) => e.type === 'draft_discarded')).toHaveLength(
          1,
        );
      });
    });
  });
}
