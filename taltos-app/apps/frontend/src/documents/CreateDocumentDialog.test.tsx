import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  GENERAL,
  PROJECT,
  TEAM,
  makeMe,
  openSelect,
  problem,
  renderApp,
  summaries,
} from '../test/helpers';
import { DOC_ID, NEW_DOC_ID, documentApi, json, makeDoc } from '../test/documents';

vi.mock('../editor/CollabEditor', () => ({ CollabEditor: () => <div data-testid="editor" /> }));

async function openBlank() {
  fireEvent.click(await screen.findByRole('button', { name: 'Új dokumentum' }));
  return screen.findByRole('dialog', { name: 'Új dokumentum' });
}

async function pickKind(dialog: HTMLElement, label: string) {
  openSelect(await within(dialog).findByRole('combobox', { name: 'Fajta' }));
  fireEvent.keyDown(await screen.findByRole('option', { name: label }), { key: 'Enter' });
}

const created = (title: string) => json(makeDoc({ id: NEW_DOC_ID, title }), 201);

describe('Új dokumentum (oldalsáv + CreateDocumentDialog, üres mód)', () => {
  it('a gomb látszik, a dialógus az aktuális térre nyílik, a fókusz a Cím mezőn', async () => {
    documentApi();
    renderApp('/');
    const dialog = await openBlank();
    expect(within(dialog).getByText('Üres Piszkozatként jön létre, te leszel a tulajdonosa.'));
    // Az aktuális (Általános) és a Fejlesztés is választható: Select, az aktuális előválasztva.
    expect(within(dialog).getByRole('combobox', { name: 'Színtér' }).textContent).toContain(
      'Általános',
    );
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Cím' }));
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Dokumentum létrehozása' })
        .disabled,
    ).toBe(false);
  });

  it('nincs nem lezárt tagsági tér: nincs gomb (nem tag Rendszeradmin; csak lezárt tér)', async () => {
    documentApi({ me: makeMe({ systemRole: 'system_admin', spaces: [], currentSpaceId: null }) });
    renderApp('/');
    expect(await screen.findByText('Nincs színtered')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Új dokumentum' })).toBeNull();
  });

  it('csak lezárt tagsági térnél nincs gomb', async () => {
    documentApi({
      me: makeMe({
        spaces: [{ id: PROJECT, name: 'Atlasz-pilot', type: 'project', role: 'author' }],
        currentSpaceId: PROJECT,
      }),
      spaces: summaries.map((space) => (space.id === PROJECT ? { ...space, closed: true } : space)),
    });
    renderApp('/');
    await screen.findByRole('combobox', { name: 'Színtér' });
    expect(screen.queryByRole('button', { name: 'Új dokumentum' })).toBeNull();
  });

  it('a lezárt tér tiltott sor „Lezárt” felirattal; lezárt aktuális térnél a magyarázó sor látszik', async () => {
    documentApi({
      me: makeMe({
        spaces: [
          { id: GENERAL, name: 'Általános', type: 'general', role: 'author' },
          { id: TEAM, name: 'Fejlesztés', type: 'team', role: 'space_manager' },
          { id: PROJECT, name: 'Atlasz-pilot', type: 'project', role: 'author' },
        ],
        currentSpaceId: PROJECT,
      }),
      spaces: summaries.map((space) => (space.id === PROJECT ? { ...space, closed: true } : space)),
    });
    renderApp('/');
    const dialog = await openBlank();
    expect(
      within(dialog).getByText(
        'A(z) „Atlasz-pilot” lezárt, ezért itt nem hozható létre dokumentum.',
      ),
    ).toBeTruthy();
    // Az első választható színtér lép az aktuális helyére.
    const trigger = within(dialog).getByRole('combobox', { name: 'Színtér' });
    expect(trigger.textContent).toContain('Általános');
    openSelect(trigger);
    const closed = await screen.findByRole('option', { name: /Atlasz-pilot/ });
    expect(closed.getAttribute('aria-disabled')).toBe('true');
    expect(closed.textContent).toContain('Lezárt');
  });

  it('mezőhibák kérés nélkül; az első hibás mezőre kerül a fókusz', async () => {
    const api = documentApi();
    renderApp('/');
    const dialog = await openBlank();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dokumentum létrehozása' }));
    expect(await within(dialog).findByText('Add meg a dokumentum címét.')).toBeTruthy();
    expect(within(dialog).getByText('Válassz fajtát.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Cím' }));
    expect(api.callsTo('POST /api/v1/documents')).toHaveLength(0);
  });

  it('a cím a szerver korlátaival egyezően ellenőrzött (200 karakter, csak láthatatlan karakter)', async () => {
    const api = documentApi();
    renderApp('/');
    const dialog = await openBlank();
    const title = within(dialog).getByRole('textbox', { name: 'Cím' });
    await pickKind(dialog, 'Prompt');
    fireEvent.change(title, { target: { value: 'x'.repeat(201) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dokumentum létrehozása' }));
    expect(await within(dialog).findByText('A cím legfeljebb 200 karakter lehet.')).toBeTruthy();
    expect(within(dialog).getByText('201 / 200')).toBeTruthy();
    fireEvent.change(title, { target: { value: '​ ​' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dokumentum létrehozása' }));
    expect(await within(dialog).findByText('Add meg a dokumentum címét.')).toBeTruthy();
    expect(api.callsTo('POST /api/v1/documents')).toHaveLength(0);
  });

  it('sikeres létrehozás: a kérés törzse, navigáció az új dokumentumra, fókusz a h1-en, toast', async () => {
    const api = documentApi({
      routes: {
        'POST /api/v1/documents': created('Új útmutató'),
        [`GET /api/v1/documents/${NEW_DOC_ID}`]: json(
          makeDoc({ id: NEW_DOC_ID, title: 'Új útmutató' }),
        ),
      },
    });
    renderApp('/');
    const dialog = await openBlank();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Cím' }), {
      target: { value: '  Új útmutató  ' },
    });
    await pickKind(dialog, 'Útmutató');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dokumentum létrehozása' }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Új útmutató' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(api.callsTo('POST /api/v1/documents')[0]?.body).toEqual({
      spaceId: GENERAL,
      title: 'Új útmutató',
      kind: 'guide',
      tagIds: [],
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Piszkozat létrehozva: „Új útmutató”.')).toBeTruthy();
    expect(await screen.findByTestId('editor')).toBeTruthy();
  });

  it('kettős küldés tilos: a gomb letiltott, a kérés egyszer megy el', async () => {
    const api = documentApi({ routes: { 'POST /api/v1/documents': () => 'pending' } });
    renderApp('/');
    const dialog = await openBlank();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Cím' }), {
      target: { value: 'Cím' },
    });
    await pickKind(dialog, 'Prompt');
    const submit = within(dialog).getByRole('button', { name: 'Dokumentum létrehozása' });
    fireEvent.click(submit);
    const busy = await within(dialog).findByRole('button', { name: 'Létrehozás…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    expect(api.callsTo('POST /api/v1/documents')).toHaveLength(1);
    // Beküldés közben az Esc és a „Mégse” sem zár.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Új dokumentum' })).toBeTruthy();
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Mégse' }).disabled).toBe(
      true,
    );
  });

  async function fail(response: () => Response, extra = {}) {
    const api = documentApi({ routes: { 'POST /api/v1/documents': response }, ...extra });
    renderApp('/');
    const dialog = await openBlank();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Cím' }), {
      target: { value: 'Megmaradó cím' },
    });
    await pickKind(dialog, 'Prompt');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dokumentum létrehozása' }));
    return { api, dialog };
  }

  it.each([
    [
      '500',
      () => problem(500, 'internal_error'),
      'Valami félresikerült nálunk, a dokumentum nem jött létre. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.',
    ],
    [
      '400',
      () => problem(400, 'validation_error'),
      'Nem sikerült létrehozni: a megadott adatok nem megfelelők. Lehet, hogy a fajta már nem választható, vagy egy címke már nem létezik. Ellenőrizd a mezőket, és próbáld újra.',
    ],
    [
      '403 not_space_member',
      () => problem(403, 'not_space_member'),
      'Már nem vagy tagja a kiválasztott színtérnek (vagy a másolandó dokumentum színterének), ezért nem hozható létre a dokumentum. A színterek listája frissült.',
    ],
    [
      '403 space_closed',
      () => problem(403, 'space_closed'),
      'A(z) „Általános” projekt-tér közben lezárult, ezért nem hozható benne létre dokumentum. Válassz másik színteret.',
    ],
    [
      '403 forbidden',
      () => problem(403, 'forbidden'),
      'Ehhez a művelethez nincs jogosultságod. Ha szerinted kellene, kérd a Színtérgazdát vagy a Rendszeradminisztrátort.',
    ],
    [
      '404',
      () => problem(404, 'not_found'),
      'A kiválasztott színtér már nem található. Válassz másikat.',
    ],
  ])(
    'hiba (%s): a megfelelő üzenet, a dialógus nyitva marad, a mezők megmaradnak',
    async (_name, response, message) => {
      const { dialog } = await fail(response);
      const alert = await within(dialog).findByRole('alert');
      expect(alert.textContent).toContain(message);
      expect(screen.getByRole('dialog', { name: 'Új dokumentum' })).toBeTruthy();
      expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Cím' }).value).toBe(
        'Megmaradó cím',
      );
      expect(within(dialog).getByRole('combobox', { name: 'Fajta' }).textContent).toContain(
        'Prompt',
      );
    },
  );

  it('hálózati hiba: őszinte üzenet (nem tudjuk, létrejött-e), újrapróbálható', async () => {
    const { api, dialog } = await fail(() => {
      throw new TypeError('Failed to fetch');
    });
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain(
      'A kapcsolat megszakadt, ezért nem tudjuk, létrejött-e a dokumentum.',
    );
    fireEvent.click(within(alert).getByRole('button', { name: 'Újrapróbálás' }));
    await waitFor(() => expect(api.callsTo('POST /api/v1/documents')).toHaveLength(2));
  });

  it('a szerver `detail` szövege nem jelenik meg', async () => {
    const { dialog } = await fail(
      () =>
        new Response(
          JSON.stringify({ status: 500, code: 'internal_error', detail: 'SECRET-TRACE <b>x</b>' }),
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
    );
    await within(dialog).findByRole('alert');
    expect(document.body.textContent).not.toContain('SECRET-TRACE');
  });

  it('nincs fajta: a dialógus blokkol, a figyelmeztetés megmondja a teendőt (NK3)', async () => {
    documentApi({ kinds: [] });
    renderApp('/');
    const dialog = await openBlank();
    expect(
      await within(dialog).findByText(
        'Még nincs felvéve egyetlen fajta sem, ezért nem hozható létre dokumentum.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText(/Kérd meg a Rendszeradminisztrátort/)).toBeTruthy();
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Dokumentum létrehozása' })
        .disabled,
    ).toBe(true);
  });

  it('a fajták listája nem töltődött be: hiba, újrapróbálás, a gomb letiltott', async () => {
    const api = documentApi({
      routes: { 'GET /api/v1/kinds': () => problem(500, 'internal_error') },
    });
    renderApp('/');
    const dialog = await openBlank();
    expect(await within(dialog).findByText('A fajták listája nem töltődött be.')).toBeTruthy();
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Dokumentum létrehozása' })
        .disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Újrapróbálás' }));
    await waitFor(() => expect(api.callsTo('GET /api/v1/kinds').length).toBeGreaterThan(1));
  });

  it('betöltés közben a Cím mező írható, a gomb letiltott', async () => {
    documentApi({ routes: { 'GET /api/v1/kinds': () => 'pending' } });
    renderApp('/');
    const dialog = await openBlank();
    const title = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Cím' });
    expect(title.disabled).toBe(false);
    fireEvent.change(title, { target: { value: 'Gépelt' } });
    expect(title.value).toBe('Gépelt');
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Dokumentum létrehozása' })
        .disabled,
    ).toBe(true);
  });
});

describe('Duplikálás (CreateDocumentDialog, duplikálás mód)', () => {
  const source = makeDoc({
    title: 'Élő cím (módosított)',
    reviewState: 'changes_requested',
    approvedRevisionId: 'rev-1',
    iteration: 2,
    approvedMetadata: {
      revisionId: 'rev-1',
      title: 'Jóváhagyott cím',
      kind: 'guide',
      tags: [
        { id: 'tag-prompt', name: 'Prompt' },
        { id: 'tag-quick', name: 'Gyorsindítás' },
      ],
      links: [],
    },
  });

  function setup(doc = source, extra = {}) {
    return documentApi({
      routes: {
        [`GET /api/v1/documents/${DOC_ID}`]: json(doc),
        'POST /api/v1/documents': created('Jóváhagyott cím (másolat)'),
        ...extra,
      },
    });
  }

  async function openDuplicate() {
    renderApp(`/documents/${DOC_ID}`);
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Dokumentum műveletei' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplikálás' }));
    return screen.findByRole('dialog', { name: 'Dokumentum duplikálása' });
  }

  it('előtöltés a Jóváhagyott metaadatból, „ (másolat)” utótaggal; a forrás kimondva', async () => {
    const api = setup();
    const dialog = await openDuplicate();
    const title = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Cím' });
    expect(title.value).toBe('Jóváhagyott cím (másolat)');
    expect(dialog.textContent).toContain(
      'A másolat a(z) „Élő cím (módosított)” legutóbbi Jóváhagyott változatából (v2) készül',
    );
    expect(dialog.textContent).toContain('A másolat új Piszkozat: te leszel a tulajdonosa');
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Fajta' }).textContent).toContain(
        'Útmutató',
      ),
    );
    const chips = within(within(dialog).getByRole('list', { name: 'Kiválasztott címkék' }));
    expect(chips.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Prompt',
      'Gyorsindítás',
    ]);
    // A cél az aktuális (Általános) színtér.
    expect(within(dialog).getByRole('combobox', { name: 'Színtér' }).textContent).toContain(
      'Általános',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Másolat létrehozása' }));
    await screen.findByTestId('editor');
    expect(api.callsTo('POST /api/v1/documents')[0]?.body).toEqual({
      spaceId: GENERAL,
      title: 'Jóváhagyott cím (másolat)',
      kind: 'guide',
      tagIds: ['tag-prompt', 'tag-quick'],
      sourceDocumentId: DOC_ID,
    });
    expect(
      await screen.findByText('A másolat létrejött Piszkozatként: „Jóváhagyott cím (másolat)”.'),
    );
  });

  it('Jóváhagyott változat nélkül az élő állapotból készül, ezt a szöveg kimondja', async () => {
    setup(makeDoc({ title: 'Friss', kind: 'prompt' }));
    const dialog = await openDuplicate();
    expect(dialog.textContent).toContain(
      'A(z) „Friss” még nem volt Jóváhagyott, ezért a másolat az aktuális, Piszkozat állapotából készül.',
    );
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Cím' }).value).toBe(
      'Friss (másolat)',
    );
  });

  it('a már nem választható fajta üres marad, a magyarázat látszik', async () => {
    setup(makeDoc({ kind: 'torolt', title: 'X' }));
    const dialog = await openDuplicate();
    expect(
      await within(dialog).findByText('A forrás fajtája már nem választható. Válassz másikat.'),
    ).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Fajta' }).textContent).toContain(
      'Válassz fajtát',
    );
  });

  it('a hosszú cím az utótaggal nem csonkul csendben: hibát kap a felhasználó', async () => {
    setup(makeDoc({ title: 'a'.repeat(195) }));
    const dialog = await openDuplicate();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Másolat létrehozása' }));
    expect(await within(dialog).findByText('A cím legfeljebb 200 karakter lehet.')).toBeTruthy();
  });

  it('a másolandó dokumentum már nem található: a megfelelő üzenet, nincs újrapróbálás', async () => {
    setup(source, { 'POST /api/v1/documents': () => problem(404, 'not_found') });
    const dialog = await openDuplicate();
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Fajta' }).textContent).toContain(
        'Útmutató',
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Másolat létrehozása' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain(
      'A másolandó dokumentum már nem található. Lehet, hogy közben eldobták.',
    );
    expect(within(alert).queryByRole('button', { name: 'Újrapróbálás' })).toBeNull();
  });

  it('400 után a fajták listája újratöltődik (a fajta közben törölhető volt)', async () => {
    const api = setup(source, { 'POST /api/v1/documents': () => problem(400, 'validation_error') });
    const dialog = await openDuplicate();
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Fajta' }).textContent).toContain(
        'Útmutató',
      ),
    );
    const before = api.callsTo('GET /api/v1/kinds').length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Másolat létrehozása' }));
    await within(dialog).findByRole('alert');
    await waitFor(() => expect(api.callsTo('GET /api/v1/kinds').length).toBeGreaterThan(before));
  });

  it('az Esc a dialógust zárja, a fókusz a menügombra tér vissza', async () => {
    setup();
    const dialog = await openDuplicate();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Dokumentum műveletei' }),
      ),
    );
  });
});
