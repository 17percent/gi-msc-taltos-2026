import type { DocumentDetail, SpaceRole } from '@taltos/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GENERAL, TEAM, makeMe, problem, renderApp, summaries } from '../test/helpers';
import { DOC_ID, documentApi, json, makeDoc, noContent, owner } from '../test/documents';
import { documentCapabilities } from './capabilities';

vi.mock('../editor/CollabEditor', () => ({ CollabEditor: () => <div data-testid="editor" /> }));

function setup(doc: Partial<DocumentDetail> = {}, options: Parameters<typeof documentApi>[0] = {}) {
  return documentApi({
    ...options,
    routes: { [`GET /api/v1/documents/${DOC_ID}`]: json(makeDoc(doc)), ...options.routes },
  });
}

const menuButton = () => screen.findByRole('button', { name: 'Dokumentum műveletei' });
const open = async () => fireEvent.keyDown(await menuButton(), { key: 'Enter' });

describe('DocumentHeader', () => {
  it('cím (h1), állapotjelvény ikonnal és felirattal, fajta-címke, címkék, tulajdonos', async () => {
    setup({ iteration: 2, reviewState: 'pending', approvedRevisionId: 'r1' });
    renderApp(`/documents/${DOC_ID}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ügyfélszolgálati gyorsválaszok' }),
    ).toBeTruthy();
    expect(screen.getByText('Review-ra vár').querySelector('svg')).toBeTruthy();
    expect(screen.getByText('Fajta: Prompt')).toBeTruthy();
    const tags = screen.getByRole('list', { name: 'Címkék' });
    expect(within(tags).getAllByRole('listitem')).toHaveLength(1);
    expect(
      screen.getByText(
        'Tulajdonos: Kovács Anna · Jóváhagyott verzió: v2 · A Jóváhagyott változat érvényben marad.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Ügyfélszolgálati gyorsválaszok – Táltos'));
    expect(await screen.findByTestId('editor')).toBeTruthy();
  });

  it.each([
    ['draft', 'Piszkozat'],
    ['pending', 'Review-ra vár'],
    ['approved', 'Jóváhagyott'],
    ['changes_requested', 'Átdolgozandó'],
  ] as const)('állapotjelvény: %s', async (reviewState, label) => {
    setup({ reviewState });
    renderApp(`/documents/${DOC_ID}`);
    expect((await screen.findByText(label)).querySelector('svg')).toBeTruthy();
  });

  it('hat címke fölött „+N további” gomb, aria-expanded', async () => {
    setup({
      tags: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, name: `Cím${i}` })),
    });
    renderApp(`/documents/${DOC_ID}`);
    const more = await screen.findByRole('button', { name: '+3 további' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(
      within(screen.getByRole('list', { name: 'Címkék' })).getAllByRole('listitem'),
    ).toHaveLength(6);
    fireEvent.click(more);
    expect(
      within(screen.getByRole('list', { name: 'Címkék' })).getAllByRole('listitem'),
    ).toHaveLength(9);
  });

  it('a cím React-szöveg: a jelölés nem értelmeződik', async () => {
    setup({ title: '<img src=x onerror=alert(1)>' });
    renderApp(`/documents/${DOC_ID}`);
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(heading.querySelector('img')).toBeNull();
  });

  it('betöltés közben nincs szerkesztő; 404; 403 hozzáférés-állapot cím nélkül; hálózati hiba újrapróbálással', async () => {
    documentApi({ routes: { [`GET /api/v1/documents/${DOC_ID}`]: () => 'pending' } });
    const view = renderApp(`/documents/${DOC_ID}`);
    expect(await screen.findByText('A dokumentum betöltése…')).toBeTruthy();
    expect(screen.queryByTestId('editor')).toBeNull();
    view.unmount();

    documentApi({
      routes: { [`GET /api/v1/documents/${DOC_ID}`]: () => problem(404, 'not_found') },
    });
    const v2 = renderApp(`/documents/${DOC_ID}`);
    expect(await screen.findByRole('heading', { name: 'A dokumentum nem található' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Vissza a Kezdőlapra' })).toBeTruthy();
    v2.unmount();

    documentApi({
      routes: {
        [`GET /api/v1/documents/${DOC_ID}`]: () =>
          problem(403, 'not_space_member', {
            space: { id: 'sp-x', name: 'Titkos tér' },
            managers: [{ id: 'm1', displayName: 'Nagy Béla', avatarUrl: null }],
            canRequestMembership: false,
          }),
      },
    });
    const v3 = renderApp(`/documents/${DOC_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'Nincs hozzáférésed ehhez a dokumentumhoz' }),
    ).toBeTruthy();
    expect(screen.getByText(/A\(z\) „Titkos tér” tartalmát csak a tagjai látják/)).toBeTruthy();
    expect(screen.getByText('Nagy Béla')).toBeTruthy();
    expect(screen.queryByTestId('editor')).toBeNull();
    v3.unmount();

    const api = documentApi({
      routes: { [`GET /api/v1/documents/${DOC_ID}`]: () => problem(500, 'internal_error') },
    });
    renderApp(`/documents/${DOC_ID}`);
    expect(await screen.findByText('A dokumentum adatai nem töltődtek be.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Újrapróbálás' }));
    await waitFor(() => expect(api.callsTo(`GET /api/v1/documents/${DOC_ID}`)).toHaveLength(2));
  });

  it('Rendszeradmin nem tagként a hozzáférés-állapotban a beállítások linkjét kapja', async () => {
    documentApi({
      me: makeMe({ systemRole: 'system_admin', spaces: [], currentSpaceId: null }),
      routes: {
        [`GET /api/v1/documents/${DOC_ID}`]: () =>
          problem(403, 'not_space_member', {
            space: { id: 'sp-x', name: 'Titkos tér' },
            managers: [],
            canRequestMembership: false,
          }),
      },
    });
    renderApp(`/documents/${DOC_ID}`);
    const link = await screen.findByRole('link', { name: 'Színtér beállításai', hidden: false });
    expect(link.getAttribute('href')).toBe('/spaces/sp-x/settings');
  });
});

describe('Piszkozat eldobása', () => {
  async function openDiscard() {
    renderApp(`/documents/${DOC_ID}`);
    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Piszkozat eldobása' }));
    return screen.findByRole('alertdialog');
  }

  it('megerősítés: a fókusz a „Mégse”-n; siker után a Kezdőlapra replace navigáció és toast', async () => {
    const api = setup({}, { routes: { [`DELETE /api/v1/documents/${DOC_ID}/draft`]: noContent } });
    const dialog = await openDiscard();
    expect(within(dialog).getByText('A művelet naplózódik.')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Mégse' })),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Piszkozat eldobása' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Az alkalmazás váza fut' }),
    ).toBeTruthy();
    expect(api.callsTo(`DELETE /api/v1/documents/${DOC_ID}/draft`)).toHaveLength(1);
    expect(
      await screen.findByText('A Piszkozat eldobva: „Ügyfélszolgálati gyorsválaszok”.'),
    ).toBeTruthy();
  });

  it.each([
    [
      problem(409, 'request_pending'),
      'Közben review-ra küldték ezt a dokumentumot, ezért nem dobható el. Az oldal frissült.',
    ],
    [
      problem(409, 'has_approved_revision'),
      'Ezt a dokumentumot már beküldték review-ra, vagy volt Jóváhagyott változata, ezért nem dobható el. A tartalmát továbbra is szerkesztheted.',
    ],
    [problem(403, 'forbidden'), 'Piszkozatot csak a tulajdonosa vagy a Színtérgazda dobhat el.'],
    [
      problem(403, 'space_closed'),
      'Ez a projekt-tér közben lezárult, ezért a Piszkozat már nem dobható el.',
    ],
    [
      problem(500, 'internal_error'),
      'Valami félresikerült nálunk, a Piszkozat még nem lett eldobva. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.',
    ],
  ])('hiba: üzenet, a dialógus nyitva marad', async (response, message) => {
    setup({}, { routes: { [`DELETE /api/v1/documents/${DOC_ID}/draft`]: () => response.clone() } });
    const dialog = await openDiscard();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Piszkozat eldobása' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain(message);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('409: az oldal adatai újratöltődnek', async () => {
    const api = setup(
      {},
      {
        routes: {
          [`DELETE /api/v1/documents/${DOC_ID}/draft`]: () => problem(409, 'request_pending'),
        },
      },
    );
    const dialog = await openDiscard();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Piszkozat eldobása' }));
    await within(dialog).findByRole('alert');
    await waitFor(() => expect(api.callsTo(`GET /api/v1/documents/${DOC_ID}`).length).toBe(2));
    expect(within(dialog).getByRole('button', { name: 'Bezár' })).toBeTruthy();
  });
});

describe('szerep × állapot mátrix (spec 7.)', () => {
  const draft = { reviewState: 'draft', approvedRevisionId: null, archived: false, owner } as const;
  const base = (role: SpaceRole | null, closed = false, ownerId = 'u-me') => ({
    systemRole: 'user' as const,
    userId: 'u-me',
    doc: { ...draft, owner: { ...owner, id: ownerId } },
    space: role ? { closed, role } : null,
    hasCreatableSpace: true,
  });

  it.each([
    ['Szerző, saját Piszkozat', base('author'), { duplicate: true, discard: true }],
    ['Szerző, más Piszkozata', base('author', false, 'u-x'), { duplicate: true, discard: false }],
    [
      'Színtérgazda, más Piszkozata',
      base('space_manager', false, 'u-x'),
      { duplicate: true, discard: true },
    ],
    ['nem tag (Rendszeradmin)', base(null), { duplicate: false, discard: false }],
    ['lezárt tér, saját', base('author', true), { duplicate: true, discard: false }],
    [
      'lezárt tér, nincs más nem lezárt tér',
      { ...base('author', true), hasCreatableSpace: false },
      { duplicate: false, discard: false },
    ],
  ])('%s', (_name, input, expected) => {
    expect(documentCapabilities(input)).toEqual(expected);
  });

  it.each([
    ['Review-ra vár', { reviewState: 'pending' as const }],
    ['Jóváhagyott', { reviewState: 'approved' as const }],
    ['Átdolgozandó', { reviewState: 'changes_requested' as const }],
    ['volt Jóváhagyott', { approvedRevisionId: 'r1' }],
    ['archivált', { archived: true }],
  ])('az eldobás rejtett: %s', (_name, change) => {
    expect(documentCapabilities({ ...base('author'), doc: { ...draft, ...change } }).discard).toBe(
      false,
    );
  });

  it('a menü a felületen: Szerzőnek más dokumentumán csak a Duplikálás', async () => {
    setup({ owner: { ...owner, id: 'u-x' } });
    renderApp(`/documents/${DOC_ID}`);
    await open();
    expect(await screen.findByRole('menuitem', { name: 'Duplikálás' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Piszkozat eldobása' })).toBeNull();
  });

  it('a menü a felületen: Színtérgazdának más Piszkozatán mindkettő; lezárt térben csak a Duplikálás', async () => {
    const manager = makeMe({
      spaces: [
        { id: GENERAL, name: 'Általános', type: 'general', role: 'author' },
        { id: TEAM, name: 'Fejlesztés', type: 'team', role: 'space_manager' },
      ],
    });
    setup({ spaceId: TEAM, owner: { ...owner, id: 'u-x' } }, { me: manager });
    const view = renderApp(`/documents/${DOC_ID}`);
    await open();
    expect(await screen.findByRole('menuitem', { name: 'Piszkozat eldobása' })).toBeTruthy();
    view.unmount();

    setup(
      { spaceId: TEAM },
      {
        me: manager,
        spaces: summaries.map((space) => (space.id === TEAM ? { ...space, closed: true } : space)),
      },
    );
    renderApp(`/documents/${DOC_ID}`);
    await open();
    expect(await screen.findByRole('menuitem', { name: 'Duplikálás' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Piszkozat eldobása' })).toBeNull();
    expect(screen.getByText('Lezárt')).toBeTruthy();
  });
});
