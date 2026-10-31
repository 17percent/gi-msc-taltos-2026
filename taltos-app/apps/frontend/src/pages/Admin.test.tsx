import type { AdminUser, SpaceSummary } from '@taltos/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setViewportDesktop } from '../test/setup';
import {
  GENERAL,
  PROJECT,
  TEAM,
  makeMe,
  mockApi,
  openMenu,
  problem,
  renderApp,
  summaries,
  userRef,
  type RouteTable,
} from '../test/helpers';

const adminMe = makeMe({ systemRole: 'system_admin' });

function setup(extra: RouteTable = {}, list: SpaceSummary[] = summaries) {
  const api = mockApi({
    'GET /api/v1/me': () => Response.json(adminMe),
    'GET /api/v1/spaces': () => Response.json(list),
    ...extra,
  });
  return api;
}

const adminUsers: AdminUser[] = [
  {
    ...userRef('u-me', 'Kovács Anna'),
    email: 'anna@example.test',
    systemRole: 'system_admin',
    lastLoginAt: '2026-10-30T10:00:00Z',
  },
  {
    ...userRef('u-b', 'Nagy Béla'),
    email: 'bela@example.test',
    systemRole: 'system_admin',
    lastLoginAt: null,
  },
  {
    ...userRef('u-c', 'Szabó Csilla'),
    email: 'csilla@example.test',
    systemRole: 'user',
    lastLoginAt: null,
  },
];

describe('Adminisztráció: jogosultság', () => {
  it('nem Rendszeradminisztrátornak „Nincs jogosultságod” állapot, fülek nélkül', async () => {
    mockApi({
      'GET /api/v1/me': () => Response.json(makeMe()),
      'GET /api/v1/spaces': () => Response.json(summaries),
    });
    renderApp('/admin/spaces');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Nincs jogosultságod' }),
    ).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Adminisztráció' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Új színtér' })).toBeNull();
  });

  it('/admin a Színterek fülre irányít; a fülek útvonalak aria-current-tel', async () => {
    setup();
    renderApp('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Adminisztráció' })).toBeTruthy();
    const tabs = within(screen.getByRole('navigation', { name: 'Adminisztráció' }));
    await waitFor(() =>
      expect(tabs.getByRole('link', { name: 'Színterek' }).getAttribute('aria-current')).toBe(
        'page',
      ),
    );
    expect(tabs.getByRole('link', { name: 'Rendszeradminisztrátorok' }).getAttribute('href')).toBe(
      '/admin/admins',
    );
  });
});

describe('Adminisztráció › Színterek', () => {
  it('listázza a színtereket, a lezártat külön csoportban, a tagságot a /me szerint', async () => {
    const list = summaries.map((space) =>
      space.id === PROJECT ? { ...space, closed: true } : space,
    );
    setup({}, list);
    renderApp('/admin/spaces');
    await screen.findByText('Fejlesztés', { selector: 'span span' });
    expect(screen.getByRole('heading', { name: 'Lezárt színterek' })).toBeTruthy();
    const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    expect(rows.some((row) => row.includes('Fejlesztés') && row.includes('Színtérgazda'))).toBe(
      true,
    );
    expect(rows.some((row) => row.includes('Atlasz-pilot') && row.includes('Nem vagy tag'))).toBe(
      true,
    );
    expect(rows.some((row) => row.includes('Atlasz-pilot') && row.includes('Lezárt'))).toBe(true);
  });

  it('betöltés közben skeleton, hibánál Alert + Újrapróbálás', async () => {
    let fail = true;
    setup({
      'GET /api/v1/spaces': () =>
        fail ? problem(500, 'internal_error') : Response.json(summaries),
    });
    renderApp('/admin/spaces');
    expect(
      (await screen.findByText(/A színterek listája nem töltődött be\. Próbáld újra\./))
        .textContent,
    ).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getAllByRole('button', { name: 'Újrapróbálás' })[0] as HTMLElement);
    expect(await screen.findAllByText('Atlasz-pilot')).not.toHaveLength(0);
  });

  it('mobilon kártya-lista van (nincs táblázat a DOM-ban)', async () => {
    setViewportDesktop(false);
    setup();
    renderApp('/admin/spaces');
    await screen.findAllByText('Atlasz-pilot');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(2);
    setViewportDesktop(true);
  });

  it('a soronkénti menü a szabály szerint kínál elemeket', async () => {
    const closedTeam = summaries.map((space) =>
      space.id === PROJECT ? { ...space, closed: true } : space,
    );
    setup({}, closedTeam);
    renderApp('/admin/spaces');
    // Nyitott csapat-tér, tag: Beállítások + Átnevezés; nincs önfelvétel, nincs lezárás.
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Fejlesztés' }));
    let items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(items).toEqual(['Beállítások megnyitása', 'Átnevezés']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    // Lezárt projekt-tér, nem tag: nincs átnevezés, nincs lezárás; van önfelvétel.
    openMenu(screen.getByRole('button', { name: 'Műveletek: Atlasz-pilot' }));
    items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(items).toEqual(['Beállítások megnyitása', 'Felvétel magamat']);
  });

  it('nyitott projekt-térnél a Lezárás is kínált; csapat-térnél nem', async () => {
    setup();
    renderApp('/admin/spaces');
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Atlasz-pilot' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toContain(
      'Lezárás',
    );
  });

  it('lezárás: végleges megerősítés a spec szövegével, majd POST /close', async () => {
    const api = setup({ [`POST /api/v1/spaces/${PROJECT}/close`]: () => Response.json({}) });
    renderApp('/admin/spaces');
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Atlasz-pilot' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Lezárás' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('„Atlasz-pilot” lezárása')).toBeTruthy();
    expect(
      within(dialog).getByText('Ebben a verzióban a lezárást nem lehet visszavonni.'),
    ).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/értesít/i);
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Mégse' })),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Színtér lezárása' }));
    await waitFor(() =>
      expect(api.callsTo(`POST /api/v1/spaces/${PROJECT}/close`)).toHaveLength(1),
    );
    expect(api.callsTo(`POST /api/v1/spaces/${PROJECT}/close`)[0]?.headers).toMatchObject({
      'X-CSRF-Token': 'csrf-123',
    });
    await waitFor(() => expect(api.callsTo('GET /api/v1/spaces').length).toBeGreaterThanOrEqual(2));
  });

  it('a lezárás hibája (forbidden) az oldal tetején jelenik meg', async () => {
    setup({ [`POST /api/v1/spaces/${PROJECT}/close`]: () => problem(403, 'forbidden') });
    renderApp('/admin/spaces');
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Atlasz-pilot' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Lezárás' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Színtér lezárása',
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Csak projekt-tér zárható le.',
    );
  });

  it('átnevezés: PATCH csak a névvel; ütköző névnél mezőhiba kérés nélkül', async () => {
    const api = setup({ [`PATCH /api/v1/spaces/${TEAM}`]: () => Response.json({}) });
    renderApp('/admin/spaces');
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Fejlesztés' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Átnevezés' }));
    const dialog = await screen.findByRole('dialog', { name: 'Színtér átnevezése' });
    const input = within(dialog).getByRole('textbox', { name: 'Név' });
    fireEvent.change(input, { target: { value: 'általános' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Átnevezés' }));
    expect(
      await within(dialog).findByText('Ilyen nevű színtér már van. Válassz másik nevet.'),
    ).toBeTruthy();
    expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'Platform' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Átnevezés' }));
    await waitFor(() => expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)).toHaveLength(1));
    expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)[0]?.body).toEqual({ name: 'Platform' });
  });

  it('önfelvétel a listából: POST a saját azonosítóval és a választott szereppel', async () => {
    const api = setup({
      [`POST /api/v1/spaces/${PROJECT}/members`]: () => Response.json({}, { status: 201 }),
    });
    renderApp('/admin/spaces');
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Atlasz-pilot' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Felvétel magamat' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Felvétel' }));
    await waitFor(() =>
      expect(api.callsTo(`POST /api/v1/spaces/${PROJECT}/members`)).toHaveLength(1),
    );
    expect(api.callsTo(`POST /api/v1/spaces/${PROJECT}/members`)[0]?.body).toEqual({
      userId: 'u-me',
      role: 'author',
    });
    await waitFor(() => expect(api.callsTo('GET /api/v1/me').length).toBeGreaterThanOrEqual(2));
  });

  async function openNewDialog() {
    fireEvent.click(await screen.findByRole('button', { name: 'Új színtér' }));
    return screen.findByRole('dialog', { name: 'Új színtér' });
  }

  it('új színtér: mezőhibák kérés nélkül, nincs előválasztott típus, az első szabad szín előválasztva', async () => {
    const api = setup();
    renderApp('/admin/spaces');
    const dialog = await openNewDialog();
    expect(
      within(dialog).getByRole<HTMLInputElement>('radio', { name: /Csapat-munkatér/ }).checked,
    ).toBe(false);
    expect(
      within(dialog).getByRole<HTMLInputElement>('radio', { name: /Projekt-tér/ }).checked,
    ).toBe(false);
    // A paletta első öt színe foglalt (3 színtér: #3B6FB6, #2E8B6F, #B5651D) → a 4. (Lila) az első szabad.
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Lila' }).checked).toBe(
      true,
    );
    expect(within(dialog).getByText('A típus később nem módosítható.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Színtér létrehozása' }));
    expect(await within(dialog).findByText('Add meg a színtér nevét.')).toBeTruthy();
    expect(within(dialog).getByText('Válaszd ki a színtér típusát.')).toBeTruthy();
    expect(within(dialog).getByText('Válaszd ki a kezdeti Színtérgazdát.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Név' }));
    expect(api.callsTo('POST /api/v1/spaces')).toHaveLength(0);
  });

  it('új színtér: foglalt név (kis-nagybetű nélkül) kliensoldali hiba', async () => {
    setup();
    renderApp('/admin/spaces');
    const dialog = await openNewDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Név' }), {
      target: { value: 'FEJLESZTÉS' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Színtér létrehozása' }));
    expect(
      await within(dialog).findByText('Ilyen nevű színtér már van. Válassz másik nevet.'),
    ).toBeTruthy();
  });

  it('új színtér: kezdeti gazda cmdk-keresővel, POST a teljes törzzsel', async () => {
    const api = setup({
      'GET /api/v1/users': () => Response.json([userRef('u-boss', 'Nagy Béla')]),
      'POST /api/v1/spaces': () => Response.json({ id: 'new-id' }, { status: 201 }),
    });
    renderApp('/admin/spaces');
    const dialog = await openNewDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Név' }), {
      target: { value: 'Platform' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Projekt-tér/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Leírás' }), {
      target: { value: 'Rövid leírás' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Okker' }));
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Kezdeti Színtérgazda' }), {
      target: { value: 'Nag' },
    });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Nagy Béla/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Színtér létrehozása' }));
    await waitFor(() => expect(api.callsTo('POST /api/v1/spaces')).toHaveLength(1));
    expect(api.callsTo('POST /api/v1/spaces')[0]?.body).toEqual({
      name: 'Platform',
      type: 'project',
      description: 'Rövid leírás',
      color: '#C2872B',
      initialManagerId: 'u-boss',
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Új színtér' })).toBeNull());
  });

  it('új színtér: szerver validation_error tartalék-üzenettel, az adatok megmaradnak', async () => {
    setup({
      'GET /api/v1/users': () => Response.json([userRef('u-boss', 'Nagy Béla')]),
      'POST /api/v1/spaces': () => problem(400, 'validation_error'),
    });
    renderApp('/admin/spaces');
    const dialog = await openNewDialog();
    const name = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Név' });
    fireEvent.change(name, { target: { value: 'Platform' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Csapat-munkatér/ }));
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Kezdeti Színtérgazda' }), {
      target: { value: 'Nag' },
    });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Nagy Béla/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Színtér létrehozása' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Ilyen nevű színtér már lehet, vagy a megadott adatok nem megfelelők.',
    );
    expect(name.value).toBe('Platform');
  });

  it('új színtér: internal_error esetén Újrapróbálás gomb', async () => {
    setup({
      'GET /api/v1/users': () => Response.json([userRef('u-boss', 'Nagy Béla')]),
      'POST /api/v1/spaces': () => problem(500, 'internal_error'),
    });
    renderApp('/admin/spaces');
    const dialog = await openNewDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Név' }), {
      target: { value: 'Platform' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Csapat-munkatér/ }));
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Kezdeti Színtérgazda' }), {
      target: { value: 'Nag' },
    });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Nagy Béla/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Színtér létrehozása' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Valami félresikerült nálunk',
    );
    expect(within(dialog).getByRole('button', { name: 'Újrapróbálás' })).toBeTruthy();
  });
});

describe('Adminisztráció › Rendszeradminisztrátorok', () => {
  const adminRoutes = (extra: RouteTable = {}) =>
    setup({ 'GET /api/v1/admin/users': () => Response.json(adminUsers), ...extra });

  it('az adminokat e-maillel és utolsó belépéssel listázza, a saját soron „Te” jelöléssel', async () => {
    adminRoutes();
    renderApp('/admin/admins');
    await screen.findByText('anna@example.test');
    expect(screen.getByText('Te')).toBeTruthy();
    expect(screen.getByText('Még nem lépett be')).toBeTruthy();
    expect(screen.queryByText('csilla@example.test')).toBeNull();
  });

  it('visszavonás: megerősítés, PUT user szerepre; saját jognál /me újratöltés és Kezdőlapra irányítás', async () => {
    const api = adminRoutes({
      'PUT /api/v1/admin/users/u-b/system-role': () => new Response(null, { status: 204 }),
    });
    renderApp('/admin/admins');
    fireEvent.click(await screen.findByRole('button', { name: 'Jog visszavonása: Nagy Béla' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByText(/A saját jogodat vonod vissza/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jog visszavonása' }));
    await waitFor(() =>
      expect(api.callsTo('PUT /api/v1/admin/users/u-b/system-role')).toHaveLength(1),
    );
    expect(api.callsTo('PUT /api/v1/admin/users/u-b/system-role')[0]?.body).toEqual({
      systemRole: 'user',
    });
  });

  it('saját jog visszavonása: kiegészítő szöveg, majd átirányítás a Kezdőlapra', async () => {
    const api = adminRoutes({
      'PUT /api/v1/admin/users/u-me/system-role': () => new Response(null, { status: 204 }),
    });
    renderApp('/admin/admins');
    fireEvent.click(await screen.findByRole('button', { name: 'Jog visszavonása: Kovács Anna' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(
        'A saját jogodat vonod vissza: utána te sem fogod látni az Adminisztrációt.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jog visszavonása' }));
    await waitFor(() =>
      expect(api.callsTo('PUT /api/v1/admin/users/u-me/system-role')).toHaveLength(1),
    );
    await waitFor(() => expect(api.callsTo('GET /api/v1/me').length).toBeGreaterThanOrEqual(2));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Az alkalmazás váza fut' }),
    ).toBeTruthy();
  });

  it('last_admin: a pontos üzenet, a fókusz a kijelölő keresőre kerül', async () => {
    adminRoutes({
      'PUT /api/v1/admin/users/u-b/system-role': () => problem(409, 'last_admin'),
    });
    renderApp('/admin/admins');
    fireEvent.click(await screen.findByRole('button', { name: 'Jog visszavonása: Nagy Béla' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Jog visszavonása',
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Legalább egy Rendszeradminisztrátornak maradnia kell. Előbb jelölj ki másik Rendszeradminisztrátort, utána vond vissza ezt a jogot.',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('combobox', { name: 'Felhasználó neve vagy e-mail-címe' }),
      ),
    );
  });

  it('kijelölés: csak nem-adminok kereshetők (név vagy e-mail), megerősítés után PUT system_admin', async () => {
    const api = adminRoutes({
      'PUT /api/v1/admin/users/u-c/system-role': () => new Response(null, { status: 204 }),
    });
    renderApp('/admin/admins');
    const input = await screen.findByRole('combobox', {
      name: 'Felhasználó neve vagy e-mail-címe',
    });
    fireEvent.change(input, { target: { value: 'ágy' } });
    expect(await screen.findByText(/Nincs találat erre/)).toBeTruthy();
    fireEvent.change(input, { target: { value: 'csilla@' } });
    const option = await screen.findByRole('option', { name: /Szabó Csilla/ });
    expect(option.textContent).toContain('csilla@example.test');
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button', { name: 'Jog megadása' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Szabó Csilla legyen Rendszeradminisztrátor?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jog megadása' }));
    await waitFor(() =>
      expect(api.callsTo('PUT /api/v1/admin/users/u-c/system-role')).toHaveLength(1),
    );
    expect(api.callsTo('PUT /api/v1/admin/users/u-c/system-role')[0]?.body).toEqual({
      systemRole: 'system_admin',
    });
  });

  it('betöltési hiba: Alert és Újrapróbálás', async () => {
    adminRoutes({ 'GET /api/v1/admin/users': () => problem(500, 'internal_error') });
    renderApp('/admin/admins');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'A felhasználók listája nem töltődött be.',
    );
    expect(screen.getByRole('button', { name: 'Újrapróbálás' })).toBeTruthy();
  });

  it('GENERAL azonosító nem szivárog ki a felületre', async () => {
    adminRoutes();
    renderApp('/admin/admins');
    await screen.findByText('anna@example.test');
    expect(document.body.textContent).not.toContain(GENERAL);
  });
});
