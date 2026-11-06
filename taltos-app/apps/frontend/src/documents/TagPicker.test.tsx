import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { problem, renderApp } from '../test/helpers';
import { DOC_ID, documentApi, json, makeDoc } from '../test/documents';

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
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = within(list).getAllByRole('option');
    await waitFor(() => expect(options[0]?.getAttribute('aria-selected')).toBe('true'));
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(options[1]?.getAttribute('aria-selected')).toBe('true'));
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
    expect(within(dialog).queryAllByRole('option', { selected: true })).toHaveLength(0);
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
});
