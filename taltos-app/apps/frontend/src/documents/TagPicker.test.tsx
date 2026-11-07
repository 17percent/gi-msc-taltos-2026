import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { problem, renderApp } from '../test/helpers';
import { DOC_ID, documentApi, json, makeDoc, tagList } from '../test/documents';
import type { TagSearchResponse } from '@taltos/shared';

vi.mock('../editor/CollabEditor', () => ({ CollabEditor: () => <div data-testid="editor" /> }));

const fiftyTags = Array.from({ length: 50 }, (_, index) => ({
  id: `bulk-${index}`,
  name: `Címke ${index}`,
}));

async function openPicker(extra: Parameters<typeof documentApi>[0] = {}) {
  const api = documentApi(extra);
  renderApp('/');
  fireEvent.click(await screen.findByRole('button', { name: 'Új dokumentum' }));
  const dialog = await screen.findByRole('dialog', { name: 'Új dokumentum' });
  const input = await within(dialog).findByRole<HTMLInputElement>('combobox', { name: 'Címkék' });
  // A teljes lista betöltődéséig (a „Címkék betöltése…” eltűnéséig) várunk.
  await waitFor(() => expect(within(dialog).queryByText('Címkék betöltése…')).toBeNull());
  return { api, dialog, input };
}

const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
const chips = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('listitem')
    .map((item) => item.textContent);

describe('TagPicker', () => {
  it('üres mezőre kattintva a meglévő címkék látszanak, darabszám nélkül', async () => {
    const { dialog, input } = await openPicker();
    expect(
      within(dialog).getByText(/Írj be egy témát, vagy válassz a meglévők közül./),
    ).toBeTruthy();
    fireEvent.click(input);
    const group = await within(dialog).findByRole('group', { name: 'Meglévő címkék' });
    // Gyakoribb elöl; a darabszám (3, 1, 2) nem jelenik meg.
    expect(
      within(group)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Prompt', 'Promptok', 'Gyorsindítás']);
    expect(group.textContent).not.toMatch(/\d/);
  });

  it('billentyűzet és aria: combobox, aria-controls, nyílbillentyű, Enter választ', async () => {
    const { dialog, input } = await openPicker();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-controls')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const list = await within(dialog).findByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    const options = within(list).getAllByRole('option');
    // Alapból a „Nincs kijelölt címke” helyfoglaló sor az aktív; a nyíl az első valódi sorra lép.
    expect(options[0]?.textContent).toBe('Nincs kijelölt címke');
    await waitFor(() => expect(options[0]?.getAttribute('aria-selected')).toBe('true'));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(options[1]?.getAttribute('aria-selected')).toBe('true'));
    await waitFor(() => expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(options[2]?.getAttribute('aria-selected')).toBe('true'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(chips(dialog)).toEqual(['Promptok']));
    // Törlés után a fókusz a beviteli mezőre kerül.
    fireEvent.click(within(dialog).getByRole('button', { name: '„Promptok” címke törlése' }));
    expect(document.activeElement).toBe(input);
    expect(chips(dialog)).toEqual([]);
  });

  it('pontos egyezés: automatikus csere a tárolt névre, státuszsorral, POST /tags nélkül', async () => {
    const { api, dialog, input } = await openPicker({
      search: { exact: { id: 'tag-prompt', name: 'Prompt', count: 3 }, similar: [] },
    });
    type(input, 'prompt');
    await waitFor(() =>
      expect(api.callsTo('GET /api/v1/tags').some((call) => call.query === '?q=prompt')).toBe(true),
    );
    const row = await within(dialog).findByRole('option', { name: 'Prompt' });
    // A pontos egyezés előkiemelt, az „új címke” sor nincs.
    await waitFor(() => expect(row.getAttribute('aria-selected')).toBe('true'));
    expect(within(dialog).queryByRole('option', { name: /új címke/i })).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(chips(dialog)).toEqual(['Prompt']));
    expect(
      within(dialog).getByText('„prompt” helyett a meglévő „Prompt” címkét adtuk hozzá.'),
    ).toBeTruthy();
    expect(api.callsTo('POST /api/v1/tags')).toHaveLength(0);
  });

  it('már kiválasztott címke nem duplázódik', async () => {
    const { dialog, input } = await openPicker({
      search: { exact: { id: 'tag-prompt', name: 'Prompt', count: 3 }, similar: [] },
    });
    type(input, 'Prompt');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(chips(dialog)).toEqual(['Prompt']));
    type(input, 'prompt');
    expect(await within(dialog).findByText('Ez a címke már hozzá van adva.')).toBeTruthy();
    expect(chips(dialog)).toEqual(['Prompt']);
  });

  it('javaslatok: legfeljebb 3, nincs alapértelmezett kiemelés, az Enter nem hoz létre semmit', async () => {
    const { api, dialog, input } = await openPicker({
      search: {
        exact: null,
        similar: [
          { id: 's1', name: 'Prompt', count: 9 },
          { id: 's2', name: 'Promptok', count: 9 },
          { id: 's3', name: 'Prompting', count: 9 },
          { id: 's4', name: 'Negyedik', count: 9 },
        ],
      },
    });
    type(input, 'promtp');
    const group = await within(dialog).findByRole('group', { name: 'Ezt kerested?' });
    expect(within(group).getAllByRole('option')).toHaveLength(3);
    // Nincs kiemelt sor, az Enter csak a státuszsort írja ki.
    expect(
      within(dialog)
        .queryAllByRole('option', { selected: true })
        .map((option) => option.textContent),
    ).toEqual(['Nincs kijelölt címke']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(
      await within(dialog).findByText(
        'Válassz a javaslatok közül, vagy a „Mégis új címke” lehetőséget.',
      ),
    ).toBeTruthy();
    expect(chips(dialog)).toEqual([]);
    expect(api.callsTo('POST /api/v1/tags')).toHaveLength(0);
    // A javaslat választása a meglévő címkét adja hozzá.
    fireEvent.click(within(group).getByRole('option', { name: 'Promptok' }));
    await waitFor(() => expect(chips(dialog)).toEqual(['Promptok']));
    expect(api.callsTo('POST /api/v1/tags')).toHaveLength(0);
  });

  it('„Mégis új címke”: azonnali POST /tags, a chip a visszaadott nevet mutatja, új címkét nem állít', async () => {
    const { api, dialog, input } = await openPicker({
      search: { exact: null, similar: [{ id: 's1', name: 'Prompt', count: 9 }] },
      // A szerver a már létező címke írásmódját adja vissza (D58).
      routes: { 'POST /api/v1/tags': json({ id: 'tag-prompt', name: 'Prompt' }) },
    });
    type(input, 'promtp');
    const row = await within(dialog).findByRole('option', { name: 'Mégis új címke: „promtp”' });
    await waitFor(() => expect(row.getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(within(dialog).getByRole('option', { name: 'Mégis új címke: „promtp”' }));
    await waitFor(() => expect(chips(dialog)).toEqual(['Prompt']));
    expect(api.callsTo('POST /api/v1/tags')[0]?.body).toEqual({ name: 'promtp' });
    expect(
      within(dialog).getByText('„promtp” helyett a meglévő „Prompt” címkét adtuk hozzá.'),
    ).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/új címke (született|jött létre|létrejött)/i);
    expect(dialog.textContent).not.toMatch(/létrehoztuk/i);
  });

  it('nincs találat: csak az „Új címke” sor, alapértelmezetten kiemelt, az Enter létrehozza', async () => {
    const { api, dialog, input } = await openPicker({
      routes: { 'POST /api/v1/tags': json({ id: 'tag-new', name: 'Valami új' }) },
    });
    type(input, 'Valami új');
    await within(dialog).findByRole('option', { name: 'Új címke: „Valami új”' });
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole('option', { name: 'Új címke: „Valami új”' })
          .getAttribute('aria-selected'),
      ).toBe('true'),
    );
    expect(within(dialog).queryByRole('option', { name: /Mégis/ })).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(chips(dialog)).toEqual(['Valami új']));
    expect(api.callsTo('POST /api/v1/tags')).toHaveLength(1);
    expect(within(dialog).queryByText(/helyett/)).toBeNull();
  });

  it('kapu: amíg a ?q= keresés fut, az új címke sor tiltott, és nem hoz létre semmit', async () => {
    const { api, dialog, input } = await openPicker({ search: 'pending' });
    type(input, 'Valami új');
    expect(await within(dialog).findByText('Ellenőrizzük, létezik-e hasonló címke…')).toBeTruthy();
    const row = await within(dialog).findByRole('option', { name: 'Új címke: „Valami új”' });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(row);
    expect(api.callsTo('POST /api/v1/tags')).toHaveLength(0);
  });

  it('kapu: a keresés hibája után az új címke sor tiltott marad, az újrapróbálás működik', async () => {
    const { api, dialog, input } = await openPicker({
      search: problem(500, 'internal_error'),
    });
    type(input, 'Valami új');
    expect(await within(dialog).findByText('A javaslatok nem töltődtek be.')).toBeTruthy();
    const row = within(dialog).getByRole('option', { name: 'Új címke: „Valami új”' });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    const before = api.callsTo('GET /api/v1/tags').length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Újrapróbálás' }));
    await waitFor(() => expect(api.callsTo('GET /api/v1/tags').length).toBeGreaterThan(before));
    expect(api.callsTo('POST /api/v1/tags')).toHaveLength(0);
  });

  it('POST /tags hiba: üzenet, a beírt szöveg megmarad', async () => {
    const { dialog, input } = await openPicker({
      routes: { 'POST /api/v1/tags': () => problem(400, 'validation_error') },
    });
    type(input, 'Valami új');
    await within(dialog).findByRole('option', { name: 'Új címke: „Valami új”' });
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole('option', { name: 'Új címke: „Valami új”' })
          .getAttribute('aria-disabled'),
      ).not.toBe('true'),
    );
    fireEvent.click(within(dialog).getByRole('option', { name: 'Új címke: „Valami új”' }));
    expect(
      await within(dialog).findByText(
        'Ezt a címkét nem tudtuk hozzáadni: ellenőrizd a szöveget (1–64 karakter).',
      ),
    ).toBeTruthy();
    expect(input.value).toBe('Valami új');
    expect(chips(dialog)).toEqual([]);
  });

  it('szöveg-validáció: 64 karakter fölött és csak láthatatlan karakternél nincs új címke sor', async () => {
    const { api, dialog, input } = await openPicker();
    type(input, 'x'.repeat(65));
    expect(await within(dialog).findByText('A címke legfeljebb 64 karakter lehet.')).toBeTruthy();
    expect(within(dialog).queryByRole('option')).toBeNull();
    type(input, '​‍');
    expect(await within(dialog).findByText('Adj meg legalább egy látható karaktert.')).toBeTruthy();
    expect(api.callsTo('GET /api/v1/tags').some((call) => call.query.startsWith('?q='))).toBe(
      false,
    );
  });

  it('Esc: az első a listát zárja, a második a dialógust', async () => {
    const { dialog, input } = await openPicker();
    type(input, 'Valami új');
    await within(dialog).findByRole('option', { name: /Új címke/ });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(within(dialog).queryByRole('option')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Új dokumentum' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('üres rendszer: a súgó nem ígér globális számot', async () => {
    const api = documentApi({
      routes: { 'GET /api/v1/tags': () => Response.json({ tags: [] }) },
    });
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Új dokumentum' }));
    const dialog = await screen.findByRole('dialog', { name: 'Új dokumentum' });
    expect(
      await within(dialog).findByText(
        /Még nincs címke a rendszerben\. Írj be egyet, és ez lesz az első\./,
      ),
    ).toBeTruthy();
    expect(api.callsTo('GET /api/v1/tags').length).toBeGreaterThan(0);
  });

  it('a címkék listája nem töltődött be: hibasor, de a keresés használható', async () => {
    const api = documentApi({
      routes: {
        'GET /api/v1/tags': ({ url }) =>
          url.searchParams.has('q')
            ? Response.json({ exact: null, similar: [] })
            : problem(500, 'internal_error'),
      },
    });
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Új dokumentum' }));
    const dialog = await screen.findByRole('dialog', { name: 'Új dokumentum' });
    expect(
      await within(dialog).findByText('A meglévő címkék listája nem töltődött be.'),
    ).toBeTruthy();
    type(within(dialog).getByRole('combobox', { name: 'Címkék' }), 'Valami új');
    await within(dialog).findByRole('option', { name: 'Új címke: „Valami új”' });
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole('option', { name: 'Új címke: „Valami új”' })
          .getAttribute('aria-disabled'),
      ).not.toBe('true'),
    );
    expect(
      api.callsTo('GET /api/v1/tags').some((call) => call.query === '?q=Valami%20%C3%BAj'),
    ).toBe(true);
  });

  it('50 címkénél a mező letiltott, a súgó megmondja a teendőt', async () => {
    documentApi({
      routes: {
        [`GET /api/v1/documents/${DOC_ID}`]: json(makeDoc({ tags: fiftyTags })),
      },
    });
    renderApp(`/documents/${DOC_ID}`);
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Dokumentum műveletei' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplikálás' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dokumentum duplikálása' });
    const input = within(dialog).getByRole<HTMLInputElement>('combobox', { name: 'Címkék' });
    expect(input.disabled).toBe(true);
    expect(dialog.textContent).toContain(
      'Elérted a legfeljebb 50 címkét. Törölj egyet, hogy másikat adhass hozzá.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '„Címke 0” címke törlése' }));
    expect(input.disabled).toBe(false);
  });

  const live = (dialog: HTMLElement) =>
    dialog.querySelector('[data-testid="tag-live"]')?.textContent ?? '';

  it('élő régió: a találatszám és a hozzáadás/törlés minden körben újra bemondódik (azonos szöveg is)', async () => {
    const { dialog, input } = await openPicker({
      search: { exact: null, similar: [{ id: 's2', name: 'Promptok', count: 9 }] },
    });
    type(input, 'promtp');
    await waitFor(() => expect(live(dialog)).toBe('1 találat és javaslat'));
    fireEvent.click(await within(dialog).findByRole('option', { name: 'Promptok' }));
    await waitFor(() =>
      expect(live(dialog)).toContain('„Promptok” hozzáadva. 1 címke kiválasztva.'),
    );
    // Új gépelés: a találatszám újra mondja magát (az előző hozzáadás-szöveg nem marad ott).
    // A már kiválasztott címke nem javaslat, ezért most 0.
    type(input, 'promtp');
    await waitFor(() => expect(live(dialog)).toBe('0 találat és javaslat'));
    fireEvent.click(within(dialog).getByRole('button', { name: '„Promptok” címke törlése' }));
    await waitFor(() => expect(live(dialog)).toContain('„Promptok” törölve. 0 címke kiválasztva.'));
    type(input, 'promtp');
    fireEvent.click(await within(dialog).findByRole('option', { name: 'Promptok' }));
    const again = live(dialog);
    expect(again).toContain('„Promptok” hozzáadva. 1 címke kiválasztva.');
    // Azonos szöveg másodszor: közben a régió tartalma megváltozott (törlés, találatszám), így újra bemondódik.
    fireEvent.click(within(dialog).getByRole('button', { name: '„Promptok” címke törlése' }));
    const afterRemove = live(dialog);
    type(input, 'promtp');
    await waitFor(() => expect(live(dialog)).toBe('1 találat és javaslat'));
    expect(afterRemove).not.toBe(live(dialog));
    fireEvent.click(await within(dialog).findByRole('option', { name: 'Promptok' }));
    expect(live(dialog)).toBe(again);
  });

  it('üres mezőnél az Enter nem hivatkozik nem létező javaslatra vagy „Mégis új címke” sorra', async () => {
    const { dialog, input } = await openPicker();
    fireEvent.click(input);
    await within(dialog).findByRole('group', { name: 'Meglévő címkék' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await within(dialog).findByText(/Válassz a listából/)).toBeTruthy();
    expect(within(dialog).queryByText(/Mégis új címke/)).toBeNull();
    expect(chips(dialog)).toEqual([]);
  });

  it('javaslatoknál az aria-activedescendant címkézett elemre mutat; ↑/Home/End', async () => {
    const { dialog, input } = await openPicker({
      search: { exact: null, similar: [{ id: 's2', name: 'Promptok', count: 9 }] },
    });
    type(input, 'promtp');
    await within(dialog).findByRole('group', { name: 'Ezt kerested?' });
    await waitFor(() => expect(input.getAttribute('aria-activedescendant')).toBeTruthy());
    const target = () => document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    expect(target()?.textContent).toBe('Nincs kijelölt címke');
    expect(target()?.getAttribute('aria-hidden')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(target()?.textContent).toBe('Promptok'));
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    await waitFor(() => expect(target()?.textContent).toBe('Nincs kijelölt címke'));
    fireEvent.keyDown(input, { key: 'End' });
    await waitFor(() => expect(target()?.textContent).toMatch(/Mégis új címke/));
    fireEvent.keyDown(input, { key: 'Home' });
    await waitFor(() => expect(target()?.textContent).toBe('Nincs kijelölt címke'));
  });
});

/** A `?q=` kéréseket a teszt oldja fel, tetszőleges sorrendben (versenyhelyzet vizsgálata). */
function deferredSearch() {
  const pending = new Map<string, (response: Response) => void>();
  const handler = ({ url }: { url: URL }) => {
    if (!url.searchParams.has('q')) return Promise.resolve(Response.json(tagList));
    const q = url.searchParams.get('q') ?? '';
    return new Promise<Response>((resolve) => pending.set(q, resolve));
  };
  const answer = (q: string, body: TagSearchResponse | Response) => {
    const resolve = pending.get(q);
    if (!resolve) throw new Error(`nincs függő kérés: ${q}`);
    resolve(body instanceof Response ? body : Response.json(body));
  };
  return { handler, pending, answer };
}
/** A sor a `key` miatt újra létrejön, ha az állapota változik: mindig újra lekérdezzük. */
const rowOf = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole('option', { name }).getAttribute('aria-disabled');
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
const queries = (api: ReturnType<typeof documentApi>) =>
  api.callsTo('GET /api/v1/tags').filter((call) => call.query.startsWith('?q='));

describe('TagPicker: robusztusság', () => {
  afterEach(() => vi.restoreAllMocks());

  it('elavult ?q= válasz (később érkezik) nem írja felül a frissebbet, és a hibája sem látszik', async () => {
    const search = deferredSearch();
    const { dialog, input } = await openPicker({
      routes: { 'GET /api/v1/tags': search.handler },
    });
    type(input, 'qx');
    await waitFor(() => expect(search.pending.has('qx')).toBe(true));
    type(input, 'qxz');
    await waitFor(() => expect(search.pending.has('qxz')).toBe(true));
    search.answer('qxz', { exact: null, similar: [{ id: 'n1', name: 'Újabb találat', count: 1 }] });
    await within(dialog).findByRole('option', { name: 'Újabb találat' });
    // A régi kérés sikere elavult: nem változtathat a listán.
    search.answer('qx', { exact: null, similar: [{ id: 'o1', name: 'Régi találat', count: 1 }] });
    await flush();
    expect(within(dialog).queryByRole('option', { name: 'Régi találat' })).toBeNull();
    expect(within(dialog).getByRole('option', { name: 'Újabb találat' })).toBeTruthy();
    expect(within(dialog).getByRole('option', { name: 'Mégis új címke: „qxz”' })).toBeTruthy();
  });

  it('elavult ?q= hiba (korábban érkezik): az új címke sor az aktuális szövegre várva tiltott marad', async () => {
    const search = deferredSearch();
    const { api, dialog, input } = await openPicker({
      routes: {
        'GET /api/v1/tags': search.handler,
        'POST /api/v1/tags': json({ id: 'tag-new', name: 'qxz' }),
      },
    });
    type(input, 'qx');
    await waitFor(() => expect(search.pending.has('qx')).toBe(true));
    type(input, 'qxz');
    await waitFor(() => expect(search.pending.has('qxz')).toBe(true));
    // A „qx” szövegre érkező hibás válasz nem nyithatja meg a kaput a „qxz” szövegre, és nem hiba-állapot.
    search.answer('qx', problem(500, 'internal_error'));
    await flush();
    const row = await within(dialog).findByRole('option', { name: 'Új címke: „qxz”' });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).queryByText('A javaslatok nem töltődtek be.')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(row);
    expect(api.callsTo('POST /api/v1/tags')).toHaveLength(0);
    search.answer('qxz', { exact: null, similar: [] });
    await waitFor(() => expect(rowOf(dialog, 'Új címke: „qxz”')).not.toBe('true'));
  });

  it('vezérlőkarakter (NUL): hiba, nincs keresés és nincs új címke sor', async () => {
    const { api, dialog, input } = await openPicker();
    type(input, 'a\u0000b');
    expect(
      await within(dialog).findByText('A címke nem tartalmazhat vezérlőkaraktert.'),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('option')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(queries(api)).toHaveLength(0);
  });

  it('csak kombináló jel (normalizálva üres): látható karaktert kér, nem keres', async () => {
    const { api, dialog, input } = await openPicker();
    type(input, '́');
    expect(await within(dialog).findByText('Adj meg legalább egy látható karaktert.')).toBeTruthy();
    expect(within(dialog).queryByRole('option')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(queries(api)).toHaveLength(0);
  });

  it('láthatatlan karakterek a szövegben: a keresés és a POST a tisztított, szóközösszevont szöveget kapja', async () => {
    const { api, dialog, input } = await openPicker({
      routes: { 'POST /api/v1/tags': json({ id: 'tag-new', name: 'Valami új' }) },
    });
    type(input, '  Valami​   új‍ ');
    const row = await within(dialog).findByRole('option', { name: 'Új címke: „Valami új”' });
    await waitFor(() => expect(rowOf(dialog, 'Új címke: „Valami új”')).not.toBe('true'));
    expect(queries(api).some((call) => call.query === '?q=Valami%20%C3%BAj')).toBe(true);
    fireEvent.click(within(dialog).getByRole('option', { name: 'Új címke: „Valami új”' }));
    await waitFor(() => expect(chips(dialog)).toEqual(['Valami új']));
    expect(api.callsTo('POST /api/v1/tags')[0]?.body).toEqual({ name: 'Valami új' });
  });

  it('POST /tags 500: újrapróbálható, a szöveg megmarad; a második próba sikerrel jár', async () => {
    let calls = 0;
    const { dialog, input } = await openPicker({
      routes: {
        'POST /api/v1/tags': () =>
          ++calls === 1
            ? problem(500, 'internal_error')
            : Response.json({ id: 't9', name: 'Valami új' }),
      },
    });
    type(input, 'Valami új');
    const row = await within(dialog).findByRole('option', { name: 'Új címke: „Valami új”' });
    await waitFor(() => expect(rowOf(dialog, 'Új címke: „Valami új”')).not.toBe('true'));
    fireEvent.click(within(dialog).getByRole('option', { name: 'Új címke: „Valami új”' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Valami félresikerült nálunk');
    expect(input.value).toBe('Valami új');
    fireEvent.click(within(alert).getByRole('button', { name: 'Újrapróbálás' }));
    await waitFor(() => expect(chips(dialog)).toEqual(['Valami új']));
    expect(calls).toBe(2);
  });

  it('POST /tags hálózati hiba: nem lesz chip, a hiba új gépelésre eltűnik', async () => {
    const { dialog, input } = await openPicker({
      routes: {
        'POST /api/v1/tags': () => {
          throw new TypeError('Failed to fetch');
        },
      },
    });
    type(input, 'Valami új');
    const row = await within(dialog).findByRole('option', { name: 'Új címke: „Valami új”' });
    await waitFor(() => expect(rowOf(dialog, 'Új címke: „Valami új”')).not.toBe('true'));
    fireEvent.click(within(dialog).getByRole('option', { name: 'Új címke: „Valami új”' }));
    await within(dialog).findByRole('alert');
    expect(chips(dialog)).toEqual([]);
    type(input, 'Valami újabb');
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
  });

  it('a helyi találatok legfeljebb 5 sort adnak', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `Közös ${i}`, count: i }));
    const { dialog, input } = await openPicker({
      routes: {
        'GET /api/v1/tags': ({ url }) =>
          url.searchParams.has('q')
            ? Response.json({ exact: null, similar: [] })
            : Response.json({ tags: many }),
      },
    });
    type(input, 'kozos');
    const group = await within(dialog).findByRole('group', { name: 'Meglévő címkék' });
    expect(within(group).getAllByRole('option')).toHaveLength(5);
  });

  describe('aria-activedescendant', () => {
    /** Az invariáns: nyitott listánál az aktív elem létezik, `option`, kijelölt, nem rejtett és címkézett. */
    function expectValidActive(input: HTMLElement) {
      const id = input.getAttribute('aria-activedescendant');
      const options = document.querySelectorAll('[role="option"]');
      if (options.length === 0) {
        if (id) {
          expect(document.getElementById(id), 'a lista zárva, de az azonosító árva').not.toBeNull();
        }
        return;
      }
      expect(id, 'nyitott listánál kell aktív elem').toBeTruthy();
      const el = document.getElementById(id ?? '');
      expect(el, `nincs elem: ${id}`).not.toBeNull();
      expect(el?.getAttribute('role')).toBe('option');
      expect(el?.getAttribute('aria-selected')).toBe('true');
      expect(el?.closest('[aria-hidden="true"]')).toBeNull();
      expect((el?.textContent ?? '').trim()).not.toBe('');
    }
    const check = (input: HTMLElement) => waitFor(() => expectValidActive(input));

    it('nyilak, Home/End, újrarajzolás (a találatok megváltoznak), Esc és újranyitás után is érvényes', async () => {
      const results: Record<string, TagSearchResponse> = {
        promtp: {
          exact: null,
          similar: [
            { id: 's1', name: 'Prompt', count: 9 },
            { id: 's2', name: 'Promptok', count: 9 },
          ],
        },
        prompt: { exact: { id: 'tag-prompt', name: 'Prompt', count: 3 }, similar: [] },
      };
      const { dialog, input } = await openPicker({
        routes: {
          'GET /api/v1/tags': ({ url }) =>
            url.searchParams.has('q')
              ? Response.json(
                  results[url.searchParams.get('q') ?? ''] ?? { exact: null, similar: [] },
                )
              : Response.json(tagList),
        },
      });
      type(input, 'promtp');
      await within(dialog).findByRole('group', { name: 'Ezt kerested?' });
      await check(input);
      const keys = ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'End'];
      for (const key of keys) {
        fireEvent.keyDown(input, { key });
        await check(input);
      }
      // Újrarajzolás: a találatlista kicserélődik (pontos egyezés, majd csak az új sor).
      type(input, 'prompt');
      await waitFor(() =>
        expect(within(dialog).queryByRole('group', { name: 'Ezt kerested?' })).toBeNull(),
      );
      await check(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      await check(input);
      type(input, 'zzz');
      await within(dialog).findByRole('option', { name: 'Új címke: „zzz”' });
      await check(input);
      // Esc: a lista bezárul, nem maradhat árva azonosító.
      fireEvent.keyDown(input, { key: 'Escape' });
      await waitFor(() => expect(within(dialog).queryByRole('option')).toBeNull());
      await check(input);
      // Újranyitás ↓-re.
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      await within(dialog).findByRole('option', { name: 'Új címke: „zzz”' });
      await check(input);
    });

    it('választás után (a lista bezárul) nincs árva aria-activedescendant', async () => {
      const { dialog, input } = await openPicker({
        search: { exact: null, similar: [{ id: 's2', name: 'Promptok', count: 9 }] },
      });
      type(input, 'promtp');
      fireEvent.click(await within(dialog).findByRole('option', { name: 'Promptok' }));
      await waitFor(() => expect(chips(dialog)).toEqual(['Promptok']));
      await check(input);
      expect(within(dialog).queryByRole('option')).toBeNull();
    });
  });

  describe('MutationObserver életciklus', () => {
    it('a lista-megfigyelő a dialógus zárásakor leválik, a későn érkező válasz nem hibázik', async () => {
      const Real = MutationObserver;
      const watchers: { disconnected: boolean; filter: boolean }[] = [];
      class Spy extends Real {
        record = { disconnected: false, filter: false };
        constructor(callback: MutationCallback) {
          super(callback);
          watchers.push(this.record);
        }
        override observe(target: Node, options?: MutationObserverInit) {
          if (options?.attributeFilter?.includes('aria-selected')) this.record.filter = true;
          super.observe(target, options);
        }
        override disconnect() {
          this.record.disconnected = true;
          super.disconnect();
        }
      }
      vi.stubGlobal('MutationObserver', Spy);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const search = deferredSearch();
      const { dialog, input } = await openPicker({ routes: { 'GET /api/v1/tags': search.handler } });
      const ours = watchers.filter((w) => w.filter);
      expect(ours.length).toBe(1);
      expect(ours[0]?.disconnected).toBe(false);
      type(input, 'qxz');
      await waitFor(() => expect(search.pending.has('qxz')).toBe(true));
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.keyDown(input, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(dialog.isConnected).toBe(false);
      expect(ours.every((w) => w.disconnected)).toBe(true);
      search.answer('qxz', { exact: null, similar: [{ id: 'a', name: 'Késő', count: 1 }] });
      await flush();
      expect(errors).not.toHaveBeenCalled();
    });
  });
});
