import { describe, expect, it } from 'vitest';
import type { DocumentHarness } from '../documents/document-store-contract.js';

const NOW = new Date('2026-11-06T09:00:00Z');

/**
 * A `TagStore` közös szerződése (WP5a, D34, D58, D59): látható dokumentumokra szűrt lista, javaslat és darabszám;
 * normalizált egyezés + legfeljebb 3 trigram-javaslat; a csendes újrahasznosítás; a fajták.
 */
export function describeTagStoreContract(
  name: string,
  setup: () => Promise<DocumentHarness>,
): void {
  describe(`${name}: TagStore-szerződés`, () => {
    async function world() {
      const h = await setup();
      const alice = await h.user('alice');
      const mine = await h.space();
      await h.member(mine, alice);
      return { h, alice, mine };
    }

    it('a lista csak a látható, nem törölt dokumentumokon használt címkéket adja, a látott használat darabszámával', async () => {
      const { h, alice, mine } = await world();
      const bob = await h.user('bob');
      const theirs = await h.space();
      await h.member(theirs, bob);
      const shared = await h.tag('közös');
      const onlyMine = await h.tag('csak-enyém');
      const onlyTheirs = await h.tag('idegen');
      const orphan = await h.tag('árva');
      const archivedOnly = await h.tag('archivált');
      await h.document(mine, alice, { tagIds: [shared, onlyMine] });
      await h.document(mine, alice, { tagIds: [shared] });
      await h.document(theirs, bob, { tagIds: [shared, onlyTheirs] });
      await h.document(mine, alice, { tagIds: [archivedOnly], archived: true });
      await h.document(mine, alice, { tagIds: [orphan], discarded: true });

      expect((await h.tags.listTags(alice)).tags).toEqual([
        { id: shared, name: 'közös', count: 2 },
        { id: onlyMine, name: 'csak-enyém', count: 1 },
      ]);
      expect((await h.tags.listTags(bob)).tags).toEqual([
        { id: onlyTheirs, name: 'idegen', count: 1 },
        { id: shared, name: 'közös', count: 1 },
      ]);
      const nobody = await h.user('nobody');
      expect((await h.tags.listTags(nobody)).tags).toEqual([]);
    });

    it('a keresés: a normalizált pontos egyezés és legfeljebb 3 trigram-javaslat (≥ 0,4), hasonlóság szerint', async () => {
      const { h, alice, mine } = await world();
      const names = ['prompt', 'prompts', 'prompter', 'promptok', 'prompting', 'prom', 'agent'];
      const ids: Record<string, string> = {};
      for (const name of names) ids[name] = await h.tag(name);
      await h.document(mine, alice, { tagIds: Object.values(ids) });

      const result = await h.tags.searchTags(alice, 'prompt');
      expect(result.exact).toEqual({ id: ids.prompt, name: 'prompt', count: 1 });
      // hasonlóság: prompts 0,67 · prompter és promptok 0,60 (név szerint) · prompting 0,55 · prom 0,50 (a harmadik után kimarad)
      expect(result.similar.map((t) => t.name)).toEqual(['prompts', 'prompter', 'promptok']);
      expect(result.similar.length).toBeLessThanOrEqual(3);
      expect(result.similar.map((t) => t.name)).not.toContain('agent');
    });

    it('a keresés nem ad pontos egyezést és javaslatot, ha nincs ilyen címke; az üres lekérdezés üres', async () => {
      const { h, alice, mine } = await world();
      await h.document(mine, alice, { tagIds: [await h.tag('valami')] });
      expect(await h.tags.searchTags(alice, 'teljesen-mas')).toEqual({ exact: null, similar: [] });
      expect(await h.tags.searchTags(alice, '')).toEqual({ exact: null, similar: [] });
    });

    it('idegen színtérben használt címke se pontos egyezésként, se javaslatként, se darabszámban nem látszik', async () => {
      const { h, alice, mine } = await world();
      const bob = await h.user('bob');
      const theirs = await h.space();
      await h.member(theirs, bob);
      const secret = await h.tag('titkos');
      const similar = await h.tag('titkosak');
      await h.document(theirs, bob, { tagIds: [secret, similar] });
      expect(await h.tags.searchTags(alice, 'titkos')).toEqual({ exact: null, similar: [] });
      expect(await h.tags.searchTags(alice, 'titko')).toEqual({ exact: null, similar: [] });
      expect((await h.tags.listTags(alice)).tags).toEqual([]);
      // a látható használat megjelenik, az idegen nem emeli a darabszámot
      await h.document(mine, alice, { tagIds: [secret] });
      expect((await h.tags.searchTags(alice, 'titkos')).exact).toEqual({
        id: secret,
        name: 'titkos',
        count: 1,
      });
      expect((await h.tags.searchTags(bob, 'titkos')).exact?.count).toBe(1);
    });

    describe('createTag', () => {
      it('új címke: {id, name}, tag_created esemény; a név az elsőként létrehozó írásmódja (szóközök összevonva)', async () => {
        const { h, alice } = await world();
        const tag = await h.tags.createTag(h.actor(alice), '  Gépi   Tanulás ', NOW);
        expect(Object.keys(tag).sort()).toEqual(['id', 'name']);
        expect(tag.name).toBe('Gépi Tanulás');
        expect(await h.inspect.events()).toEqual([
          {
            type: 'tag_created',
            spaceId: null,
            documentId: null,
            actorId: alice,
            details: { tagId: tag.id },
          },
        ]);
      });

      it('normalizált ütközésnél a meglévő sor megy vissza, azonos kulcskészlettel és esemény nélkül', async () => {
        const { h, alice } = await world();
        const bob = await h.user('bob');
        const first = await h.tags.createTag(h.actor(alice), 'Gépi Tanulás', NOW);
        const again = await h.tags.createTag(h.actor(bob), 'gepi   tanulas', NOW);
        expect(again).toEqual(first);
        expect(Object.keys(again).sort()).toEqual(Object.keys(first).sort());
        expect((await h.inspect.events()).filter((e) => e.type === 'tag_created')).toHaveLength(1);
      });
    });

    describe('fajták', () => {
      it('a lista a rendezés szerinti, a törölt kimarad; a bővítés kulcsra egyedi, kind_created eseménnyel', async () => {
        const { h, alice } = await world();
        await h.kind('alpha');
        await h.kind('beta');
        await h.kind('torolt', { deleted: true });
        const keys = (await h.tags.listKinds()).map((k) => k.key);
        expect(keys).toEqual(expect.arrayContaining(['alpha', 'beta']));
        expect(keys).not.toContain('torolt');

        const created = await h.tags.createKind(
          h.actor(alice),
          { key: 'mcp_server', label: 'MCP-szerver' },
          NOW,
        );
        expect(created).toEqual({ ok: true, value: { key: 'mcp_server', label: 'MCP-szerver' } });
        const after = (await h.tags.listKinds()).map((k) => k.key);
        expect(after.at(-1)).toBe('mcp_server');
        expect(
          await h.tags.createKind(h.actor(alice), { key: 'mcp_server', label: 'Más' }, NOW),
        ).toMatchObject({
          ok: false,
          code: 'validation_error',
        });
        // a törölt fajta kulcsa is foglalt
        expect(
          await h.tags.createKind(h.actor(alice), { key: 'torolt', label: 'X' }, NOW),
        ).toMatchObject({
          ok: false,
          code: 'validation_error',
        });
        expect((await h.inspect.events()).filter((e) => e.type === 'kind_created')).toEqual([
          {
            type: 'kind_created',
            spaceId: null,
            documentId: null,
            actorId: alice,
            details: { key: 'mcp_server' },
          },
        ]);
      });
    });
  });
}
