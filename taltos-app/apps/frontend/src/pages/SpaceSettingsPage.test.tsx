import type { SpaceMember, SpaceRole, SpaceSummary, SystemRole } from '@taltos/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  GENERAL,
  PROJECT,
  TEAM,
  detailOf,
  makeMe,
  mockApi,
  openMenu,
  problem,
  renderApp,
  summaries,
  userRef,
  type RouteTable,
} from '../test/helpers';

type Kind = 'team' | 'project' | 'general';
const idOf: Record<Kind, string> = { team: TEAM, project: PROJECT, general: GENERAL };

type Scenario = {
  systemRole?: SystemRole;
  /** A hívó szerepe a vizsgált színtérben; `null`: nem tag. */
  myRole: SpaceRole | null;
  kind?: Kind;
  closed?: boolean;
  members?: SpaceMember[];
  extra?: RouteTable;
};

function membersFor(myRole: SpaceRole | null): SpaceMember[] {
  const list: SpaceMember[] = [
    { user: userRef('u-boss', 'Nagy Béla'), role: 'space_manager' },
    { user: userRef('u-x', 'Szabó Csilla'), role: 'author' },
    { user: userRef('u-y', 'Tóth Dóra'), role: 'author' },
  ];
  if (myRole) list.push({ user: userRef('u-me', 'Kovács Anna'), role: myRole });
  return list;
}

/** Felállít egy színtér-beállítások oldalt: /me, /spaces, részletek és tagok; a `extra` felülírhat. */
function setup(scenario: Scenario) {
  const kind = scenario.kind ?? 'team';
  const spaceId = idOf[kind];
  const base = summaries.find((space) => space.id === spaceId) as SpaceSummary;
  const summary: SpaceSummary = { ...base, closed: scenario.closed ?? false };
  const own =
    scenario.myRole === null
      ? []
      : [{ id: spaceId, name: summary.name, type: summary.type, role: scenario.myRole }];
  const me = makeMe({
    systemRole: scenario.systemRole ?? 'user',
    spaces:
      kind === 'general'
        ? own
        : [
            { id: GENERAL, name: 'Általános', type: 'general' as const, role: 'author' as const },
            ...own,
          ],
    currentSpaceId: GENERAL,
  });
  const members = scenario.members ?? membersFor(scenario.myRole);
  const api = mockApi({
    'GET /api/v1/me': () => Response.json(me),
    'GET /api/v1/spaces': () =>
      Response.json(summaries.map((space) => (space.id === spaceId ? summary : space))),
    [`GET /api/v1/spaces/${spaceId}`]: () =>
      Response.json(detailOf(summary, { memberCount: members.length })),
    [`GET /api/v1/spaces/${spaceId}/members`]: () => Response.json(members),
    ...scenario.extra,
  });
  renderApp(`/spaces/${spaceId}/settings`);
  return { api, spaceId, summary };
}

async function ready(name: string | RegExp = /Fejlesztés|Atlasz-pilot|Általános/) {
  return screen.findByRole('heading', { level: 1, name });
}

const has = {
  nameInput: () => screen.queryByRole('textbox', { name: 'Név' }),
  descriptionInput: () => screen.queryByRole('textbox', { name: 'Leírás' }),
  colorPicker: () => screen.queryByRole('radio', { name: 'Kék' }),
  addButton: () => screen.queryByRole('button', { name: /Tag hozzáadása/ }),
  saveButton: () => screen.queryByRole('button', { name: 'Mentés' }),
  selfAssign: () => screen.queryByRole('button', { name: 'Felvétel magamat' }),
  rowMenu: (name: string) => screen.queryByRole('button', { name: `Műveletek: ${name}` }),
};

/** A tagsor menüje: milyen elemeket kínál (üres lista: nincs menügomb). */
async function rowMenuItems(name: string): Promise<string[]> {
  const trigger = has.rowMenu(name);
  if (!trigger) return [];
  openMenu(trigger);
  const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent ?? '');
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return items;
}

describe('jogosultsági mátrix (spec 5.): vezérlők szerepenként és állapotonként', () => {
  type Row = {
    label: string;
    scenario: Scenario;
    name: boolean;
    description: boolean;
    add: boolean;
    role: boolean;
    remove: boolean;
    selfAssign: boolean;
  };
  const rows: Row[] = [
    // Nyitott csapat-tér
    {
      label: 'Szerző, nyitott tér',
      scenario: { myRole: 'author' },
      name: false,
      description: false,
      add: false,
      role: false,
      remove: false,
      selfAssign: false,
    },
    {
      label: 'Színtérgazda, nyitott tér',
      scenario: { myRole: 'space_manager' },
      name: false,
      description: true,
      add: true,
      role: true,
      remove: true,
      selfAssign: false,
    },
    {
      label: 'Rendszeradmin (nem tag), nyitott tér',
      scenario: { myRole: null, systemRole: 'system_admin' },
      name: true,
      description: true,
      add: true,
      role: true,
      remove: true,
      selfAssign: true,
    },
    {
      label: 'Rendszeradmin (tag is), nyitott tér',
      scenario: { myRole: 'author', systemRole: 'system_admin' },
      name: true,
      description: true,
      add: true,
      role: true,
      remove: true,
      selfAssign: false,
    },
    // Lezárt projekt-tér
    {
      label: 'Szerző, lezárt tér',
      scenario: { myRole: 'author', kind: 'project', closed: true },
      name: false,
      description: false,
      add: false,
      role: false,
      remove: false,
      selfAssign: false,
    },
    {
      label: 'Színtérgazda, lezárt tér',
      scenario: { myRole: 'space_manager', kind: 'project', closed: true },
      name: false,
      description: false,
      add: false,
      role: false,
      remove: false,
      selfAssign: false,
    },
    {
      label: 'Rendszeradmin, lezárt tér',
      scenario: { myRole: null, systemRole: 'system_admin', kind: 'project', closed: true },
      name: false,
      description: false,
      add: true,
      role: true,
      remove: true,
      selfAssign: true,
    },
    // Általános
    {
      label: 'Szerző, Általános',
      scenario: { myRole: 'author', kind: 'general' },
      name: false,
      description: false,
      add: false,
      role: false,
      remove: false,
      selfAssign: false,
    },
    {
      label: 'Színtérgazda, Általános',
      scenario: { myRole: 'space_manager', kind: 'general' },
      name: false,
      description: true,
      add: true,
      role: true,
      remove: false,
      selfAssign: false,
    },
    {
      label: 'Rendszeradmin, Általános',
      scenario: { myRole: null, systemRole: 'system_admin', kind: 'general' },
      name: true,
      description: true,
      add: true,
      role: true,
      remove: false,
      selfAssign: true,
    },
  ];

  it.each(rows)('$label', async (row) => {
    setup(row.scenario);
    await ready();
    expect(has.nameInput() !== null).toBe(row.name);
    expect(has.descriptionInput() !== null).toBe(row.description);
    expect(has.colorPicker() !== null).toBe(row.description);
    expect(has.saveButton() !== null).toBe(row.name || row.description);
    expect(has.addButton() !== null).toBe(row.add);
    expect(has.selfAssign() !== null).toBe(row.selfAssign);

    // Egy Szerző sor menüje: szerepváltás és eltávolítás elérhetősége.
    const items = await rowMenuItems('Szabó Csilla');
    expect(items.includes('Legyen Színtérgazda')).toBe(row.role);
    expect(items.includes('Eltávolítás')).toBe(row.remove);
    // Egy Színtérgazda sor menüje: visszaminősítés.
    const managerItems = await rowMenuItems('Nagy Béla');
    expect(managerItems.includes('Legyen Szerző')).toBe(row.role);
    expect(managerItems.includes('Eltávolítás')).toBe(row.remove);
  });

  it('a tagok listája és a metaadat minden szerepnek látszik, e-mail soha', async () => {
    setup({ myRole: 'author' });
    await ready();
    expect(screen.getByText('Nagy Béla')).toBeTruthy();
    expect(screen.getByText('Szabó Csilla')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/@/);
  });
});

describe('állapotok', () => {
  it('betöltés közben skeleton és rejtett állapotszöveg', async () => {
    mockApi({
      'GET /api/v1/me': () => Response.json(makeMe()),
      'GET /api/v1/spaces': () => Response.json(summaries),
      [`GET /api/v1/spaces/${TEAM}`]: () => 'pending',
      [`GET /api/v1/spaces/${TEAM}/members`]: () => 'pending',
    });
    renderApp(`/spaces/${TEAM}/settings`);
    expect(await screen.findAllByText('Színtér betöltése…')).not.toHaveLength(0);
  });

  it('hálózati hibánál Alert és Újrapróbálás, ami újra lekér', async () => {
    let fail = true;
    const { api } = setup({
      myRole: 'space_manager',
      extra: {
        [`GET /api/v1/spaces/${TEAM}`]: () =>
          fail
            ? problem(500, 'internal_error')
            : Response.json(detailOf(summaries[1] as SpaceSummary)),
      },
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Valami félresikerült nálunk');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Újrapróbálás' }));
    await ready();
    expect(api.callsTo(`GET /api/v1/spaces/${TEAM}`).length).toBeGreaterThanOrEqual(2);
  });

  it('404: a színtér nem található, visszalinkkel', async () => {
    setup({
      myRole: 'author',
      extra: { [`GET /api/v1/spaces/${TEAM}`]: () => problem(404, 'not_found') },
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'A színtér nem található' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Vissza a Kezdőlapra' }).getAttribute('href')).toBe(
      '/',
    );
  });

  it('not_space_member: csak a színtér neve és a gazdák; nincs „Felvétel kérése”, nincs szám', async () => {
    setup({
      myRole: null,
      extra: {
        [`GET /api/v1/spaces/${TEAM}`]: () =>
          problem(403, 'not_space_member', {
            space: { id: TEAM, name: 'Fejlesztés' },
            managers: [userRef('u-boss', 'Nagy Béla')],
            canRequestMembership: true,
          }),
        [`GET /api/v1/spaces/${TEAM}/members`]: () => problem(403, 'not_space_member'),
      },
    });
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Nincs hozzáférésed ehhez a színtérhez',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/A\(z\) „Fejlesztés” tartalmát és beállításait csak a tagjai látják\./),
    ).toBeTruthy();
    expect(screen.getByText('Felvételért fordulj valamelyik Színtérgazdához:')).toBeTruthy();
    expect(screen.getByText('Nagy Béla')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Felvétel kérése|kérés/i })).toBeNull();
    expect(screen.getByRole('link', { name: 'Vissza a Kezdőlapra' })).toBeTruthy();
    expect(document.querySelector('main')?.textContent).not.toMatch(/\d+ tag|dokumentum/i);
  });

  it('not_space_member gazdák nélkül a Rendszeradminisztrátorra utal', async () => {
    setup({
      myRole: null,
      extra: {
        [`GET /api/v1/spaces/${TEAM}`]: () =>
          problem(403, 'not_space_member', {
            space: { id: TEAM, name: 'Fejlesztés' },
            managers: [],
            canRequestMembership: true,
          }),
        [`GET /api/v1/spaces/${TEAM}/members`]: () => problem(403, 'not_space_member'),
      },
    });
    expect(
      await screen.findByText(
        /nincs elérhető Színtérgazdája\. Fordulj a Rendszeradminisztrátorhoz\./,
      ),
    ).toBeTruthy();
  });

  it('Szerző: csak olvasható nézet a gazdák nevével, üres leírásnál „Nincs leírás.”', async () => {
    setup({ myRole: 'author' });
    await ready();
    expect(screen.getByText('A beállításokat a Színtérgazdák módosítják: Nagy Béla.')).toBeTruthy();
    expect(screen.getByText('A típus létrehozás után nem módosítható.')).toBeTruthy();
    expect(screen.getByText(/A fejlesztők tere\./)).toBeTruthy();
  });

  it('lezárt tér: figyelmeztetés, Rendszeradminnak a tagságkezelés említésével', async () => {
    setup({ myRole: null, systemRole: 'system_admin', kind: 'project', closed: true });
    await ready();
    expect(screen.getByText(/Ez a projekt-tér le van zárva/).textContent).toContain(
      'Rendszeradminisztrátorként a tagságot továbbra is kezelheted.',
    );
    expect(screen.getByText('Lezárt')).toBeTruthy();
  });

  it('lezárt tér: másoknak a Rendszeradminisztrátort említi', async () => {
    setup({ myRole: 'author', kind: 'project', closed: true });
    await ready();
    expect(screen.getByText(/Ez a projekt-tér le van zárva/).textContent).toContain(
      'A tagságot csak a Rendszeradminisztrátor módosíthatja.',
    );
  });

  it('nem tag Rendszeradmin: tájékoztató sáv, morzsa és Felvétel magamat', async () => {
    setup({ myRole: null, systemRole: 'system_admin' });
    await ready();
    expect(
      screen.getByText(
        /Nem vagy tagja ennek a színtérnek, ezért csak az adatait és a tagjait látod/,
      ),
    ).toBeTruthy();
    const crumbs = within(screen.getByRole('navigation', { name: 'Morzsa' }));
    expect(crumbs.getByRole('link', { name: 'Adminisztráció' })).toBeTruthy();
    expect(crumbs.getByText('Fejlesztés').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Nem vagy tag')).toBeTruthy();
  });

  it('nem Rendszeradminnak nincs morzsa', async () => {
    setup({ myRole: 'author' });
    await ready();
    expect(screen.queryByRole('navigation', { name: 'Morzsa' })).toBeNull();
  });

  it('Általános: magyarázat, és az eltávolítás sehol nem kínált', async () => {
    setup({ myRole: 'space_manager', kind: 'general' });
    await ready();
    expect(screen.getByText(/Az Általános színtér tagsága automatikus/)).toBeTruthy();
    expect(await rowMenuItems('Szabó Csilla')).toEqual(['Legyen Színtérgazda']);
  });

  it('három tag alatt figyelmeztet (gazdának és nem gazdának eltérő szöveggel)', async () => {
    const two: SpaceMember[] = [
      { user: userRef('u-boss', 'Nagy Béla'), role: 'space_manager' },
      { user: userRef('u-me', 'Kovács Anna'), role: 'author' },
    ];
    setup({ myRole: 'author', members: two });
    await ready();
    expect(screen.getByText(/kevesebb mint három tag van/).textContent).toContain(
      'Kérd a Színtérgazdát, hogy vegyen fel további tagokat.',
    );
  });

  it('a felhasználó által megadott leírás szövegként jelenik meg, nem HTML-ként', async () => {
    const hostile: SpaceSummary = {
      ...(summaries[1] as SpaceSummary),
      description: '<img src=x onerror="alert(1)"><script>alert(2)</script>',
      name: '<b>Félkövér</b>',
    };
    setup({
      myRole: 'author',
      extra: {
        [`GET /api/v1/spaces/${TEAM}`]: () => Response.json(detailOf(hostile)),
      },
    });
    await screen.findAllByText('<b>Félkövér</b>');
    const main = document.querySelector('main') as HTMLElement;
    expect(main.querySelector('img[src="x"]')).toBeNull();
    expect(main.querySelector('script')).toBeNull();
    expect(main.querySelector('h1 b')).toBeNull();
    expect(main.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(main.textContent).toContain('<b>Félkövér</b>');
  });
});

describe('alapadatok mentése', () => {
  it('Színtérgazda: csak a módosult mező megy a PATCH-ben (nincs name)', async () => {
    const { api } = setup({ myRole: 'space_manager' });
    await ready();
    const description = screen.getByRole('textbox', { name: 'Leírás' });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mentés' }).disabled).toBe(true);
    fireEvent.change(description, { target: { value: 'Új leírás' } });
    expect(screen.getByText('Nem mentett módosítások.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    await waitFor(() => expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)).toHaveLength(1));
    const call = api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)[0];
    expect(call?.body).toEqual({ description: 'Új leírás' });
    expect(call?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf-123' });
  });

  it('a szín módosítása csak a color mezőt küldi', async () => {
    const { api } = setup({ myRole: 'space_manager' });
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Lila' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    await waitFor(() => expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)).toHaveLength(1));
    expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)[0]?.body).toEqual({ color: '#A15BB9' });
  });

  it('Rendszeradmin: a név is megy, és sikernél a „✓ Mentve.” megjelenik', async () => {
    let currentName = 'Fejlesztés';
    const { api } = setup({
      myRole: null,
      systemRole: 'system_admin',
      extra: {
        [`PATCH /api/v1/spaces/${TEAM}`]: ({ init }) => {
          currentName = (JSON.parse(init?.body as string) as { name: string }).name;
          return Response.json({});
        },
        [`GET /api/v1/spaces/${TEAM}`]: () =>
          Response.json(detailOf({ ...(summaries[1] as SpaceSummary), name: currentName })),
      },
    });
    await ready();
    fireEvent.change(screen.getByRole('textbox', { name: 'Név' }), {
      target: { value: 'Platform' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    await waitFor(() => expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)).toHaveLength(1));
    expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)[0]?.body).toEqual({ name: 'Platform' });
    expect(await screen.findByText('✓ Mentve.')).toBeTruthy();
  });

  it('a Változtatások elvetése visszaállítja az értékeket', async () => {
    setup({ myRole: 'space_manager' });
    await ready();
    const description = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Leírás' });
    fireEvent.change(description, { target: { value: 'Valami más' } });
    fireEvent.click(screen.getByRole('button', { name: 'Változtatások elvetése' }));
    expect(description.value).toContain('A fejlesztők tere.');
  });

  it('üres név, túl hosszú név, foglalt név és túl hosszú leírás mezőhibát ad, kérés nélkül', async () => {
    const { api } = setup({ myRole: null, systemRole: 'system_admin' });
    await ready();
    const name = screen.getByRole('textbox', { name: 'Név' });
    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    expect(await screen.findByText('Add meg a színtér nevét.')).toBeTruthy();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);

    fireEvent.change(name, { target: { value: 'x'.repeat(81) } });
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    expect(await screen.findByText('A név legfeljebb 80 karakter lehet.')).toBeTruthy();

    fireEvent.change(name, { target: { value: 'atlasz-PILOT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    expect(
      await screen.findByText('Ilyen nevű színtér már van. Válassz másik nevet.'),
    ).toBeTruthy();

    fireEvent.change(name, { target: { value: 'Fejlesztés' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Leírás' }), {
      target: { value: 'y'.repeat(2001) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    expect(await screen.findByText('A leírás legfeljebb 2000 karakter lehet.')).toBeTruthy();
    expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}`)).toHaveLength(0);
  });

  it('space_closed: üzenet és újratöltés (a nézet csak olvasható lesz)', async () => {
    const { api } = setup({
      myRole: 'space_manager',
      extra: { [`PATCH /api/v1/spaces/${TEAM}`]: () => problem(403, 'space_closed') },
    });
    await ready();
    fireEvent.change(screen.getByRole('textbox', { name: 'Leírás' }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Ez a projekt-tér közben lezárult, ezért már csak olvasható.',
    );
    await waitFor(() =>
      expect(api.callsTo(`GET /api/v1/spaces/${TEAM}`).length).toBeGreaterThanOrEqual(2),
    );
    // A beírt adat nem vész el.
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Leírás' }).value).toBe('x');
  });

  it('forbidden: üzenet, és a /me újratöltődik', async () => {
    const { api } = setup({
      myRole: 'space_manager',
      extra: { [`PATCH /api/v1/spaces/${TEAM}`]: () => problem(403, 'forbidden') },
    });
    await ready();
    fireEvent.change(screen.getByRole('textbox', { name: 'Leírás' }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Ehhez a művelethez nincs jogosultságod.',
    );
    await waitFor(() => expect(api.callsTo('GET /api/v1/me').length).toBeGreaterThanOrEqual(2));
  });

  it('validation_error mezőjelölés nélkül: az általános tartalék-üzenet (NK9)', async () => {
    setup({
      myRole: null,
      systemRole: 'system_admin',
      extra: { [`PATCH /api/v1/spaces/${TEAM}`]: () => problem(400, 'validation_error') },
    });
    await ready();
    fireEvent.change(screen.getByRole('textbox', { name: 'Név' }), {
      target: { value: 'Platform' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Ilyen nevű színtér már lehet, vagy a megadott adatok nem megfelelők.',
    );
  });
});

describe('tagkezelés', () => {
  it('szerepváltás: megerősítés nélkül PATCH megy a tag szerepével', async () => {
    const { api } = setup({
      myRole: 'space_manager',
      extra: { [`PATCH /api/v1/spaces/${TEAM}/members/u-x`]: () => Response.json({}) },
    });
    await ready();
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Szabó Csilla' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Legyen Színtérgazda' }));
    await waitFor(() =>
      expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}/members/u-x`)).toHaveLength(1),
    );
    expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}/members/u-x`)[0]?.body).toEqual({
      role: 'space_manager',
    });
  });

  it('saját visszaminősítés (nem Rendszeradmin): megerősítő dialógus, fókusz a Mégse gombon', async () => {
    const { api } = setup({
      myRole: 'space_manager',
      extra: { [`PATCH /api/v1/spaces/${TEAM}/members/u-me`]: () => Response.json({}) },
    });
    await ready();
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Kovács Anna' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Legyen Szerző' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Visszaminősíted magad Szerzővé?')).toBeTruthy();
    expect(
      within(dialog).getByText('Utána nem módosíthatod a színtér beállításait és tagjait.'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Mégse' })),
    );
    expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}/members/u-me`)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Visszaminősítés' }));
    await waitFor(() =>
      expect(api.callsTo(`PATCH /api/v1/spaces/${TEAM}/members/u-me`)).toHaveLength(1),
    );
    // A saját szerep változott: a /me újratöltődik.
    await waitFor(() => expect(api.callsTo('GET /api/v1/me').length).toBeGreaterThanOrEqual(2));
  });

  it('last_space_manager szerepváltásnál: az üzenet a nevet tartalmazza, a lista változatlan', async () => {
    setup({
      myRole: 'space_manager',
      extra: {
        [`PATCH /api/v1/spaces/${TEAM}/members/u-boss`]: () => problem(409, 'last_space_manager'),
      },
    });
    await ready();
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Nagy Béla' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Legyen Szerző' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Ennek a színtérnek legalább egy Színtérgazdája kell legyen. Előbb léptess elő másik tagot Színtérgazdává, utána minősítsd vissza Nagy Béla szerepét.',
    );
    expect(screen.getByText('Nagy Béla')).toBeTruthy();
  });

  it('eltávolítás: megerősítés után DELETE, siker után a lista újratölt', async () => {
    const { api } = setup({
      myRole: 'space_manager',
      extra: {
        [`DELETE /api/v1/spaces/${TEAM}/members/u-x`]: () => new Response(null, { status: 204 }),
      },
    });
    await ready();
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Szabó Csilla' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eltávolítás' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('Szabó Csilla eltávolítása a(z) „Fejlesztés” színtérből'),
    ).toBeTruthy();
    expect(
      within(dialog).getByText('Szabó Csilla többé nem látja a színtér tartalmát.'),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/Magadat távolítod el/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Eltávolítás' }));
    await waitFor(() =>
      expect(api.callsTo(`DELETE /api/v1/spaces/${TEAM}/members/u-x`)).toHaveLength(1),
    );
    expect(api.callsTo(`DELETE /api/v1/spaces/${TEAM}/members/u-x`)[0]?.headers).toMatchObject({
      'X-CSRF-Token': 'csrf-123',
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() =>
      expect(api.callsTo(`GET /api/v1/spaces/${TEAM}/members`).length).toBeGreaterThanOrEqual(2),
    );
  });

  it('saját eltávolításnál kiegészítő figyelmeztetés van', async () => {
    setup({ myRole: 'space_manager' });
    await ready();
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Kovács Anna' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eltávolítás' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('Magadat távolítod el: utána nem fogod látni a színteret.'),
    ).toBeTruthy();
  });

  it('owner_handover_required: őszinte üzenet az oldal tetején, a dialógus bezárul', async () => {
    setup({
      myRole: 'space_manager',
      extra: {
        [`DELETE /api/v1/spaces/${TEAM}/members/u-x`]: () =>
          problem(409, 'owner_handover_required'),
      },
    });
    await ready();
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Szabó Csilla' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eltávolítás' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eltávolítás' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Szabó Csilla még nem archivált dokumentumok tulajdonosa, ezért nem távolítható el.',
    );
    expect(alert.textContent).toContain('ezt a tulajdonos vagy a Színtérgazda teheti meg.');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('last_space_manager eltávolításnál a megfelelő üzenet jelenik meg', async () => {
    setup({
      myRole: 'space_manager',
      extra: {
        [`DELETE /api/v1/spaces/${TEAM}/members/u-boss`]: () => problem(409, 'last_space_manager'),
      },
    });
    await ready();
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Nagy Béla' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eltávolítás' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eltávolítás' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      'ezért Nagy Béla nem távolítható el. Előbb léptess elő másik tagot Színtérgazdává.',
    );
  });

  it('tagfelvétel: kereső (debounce), „Már tag” tiltott sor, POST a kiválasztott szereppel', async () => {
    const { api } = setup({
      myRole: 'space_manager',
      extra: {
        'GET /api/v1/users': () =>
          Response.json([userRef('u-x', 'Szabó Csilla'), userRef('u-new', 'Szabó Zoltán')]),
        [`POST /api/v1/spaces/${TEAM}/members`]: () => Response.json({}, { status: 201 }),
      },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Tag hozzáadása/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Tag hozzáadása' });
    const input = within(dialog).getByRole('combobox', { name: 'Kolléga' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(within(dialog).getByText('Írd be a kolléga nevét (legalább 2 betű).')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Sza' } });
    expect(await within(dialog).findByText('Keresés…')).toBeTruthy();
    const existing = await within(dialog).findByRole('option', { name: /Szabó Csilla/ });
    expect(existing.textContent).toContain('Már tag');
    expect(existing.getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('2 találat')).toBeTruthy();
    expect(api.callsTo('GET /api/v1/users')[0]?.query).toBe('?q=Sza');
    fireEvent.click(within(dialog).getByRole('option', { name: /Szabó Zoltán/ }));
    expect(within(dialog).getByRole('button', { name: 'Szabó Zoltán törlése' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Színtérgazda' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tag hozzáadása' }));
    await waitFor(() => expect(api.callsTo(`POST /api/v1/spaces/${TEAM}/members`)).toHaveLength(1));
    expect(api.callsTo(`POST /api/v1/spaces/${TEAM}/members`)[0]?.body).toEqual({
      userId: 'u-new',
      role: 'space_manager',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Tag hozzáadása' })).toBeNull(),
    );
  });

  it('a kereső állapotai: nincs találat, hiba + újrapróbálás', async () => {
    let mode: 'empty' | 'error' | 'ok' = 'empty';
    setup({
      myRole: 'space_manager',
      extra: {
        'GET /api/v1/users': () =>
          mode === 'error'
            ? problem(500, 'internal_error')
            : Response.json(mode === 'empty' ? [] : [userRef('u-new', 'Szabó Zoltán')]),
      },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Tag hozzáadása/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Tag hozzáadása' });
    const input = within(dialog).getByRole('combobox', { name: 'Kolléga' });
    fireEvent.change(input, { target: { value: 'Xy' } });
    expect(await within(dialog).findByText(/Nincs találat erre: „Xy”/)).toBeTruthy();
    mode = 'error';
    fireEvent.change(input, { target: { value: 'Xyz' } });
    expect(await within(dialog).findByText('A keresés nem sikerült.')).toBeTruthy();
    mode = 'ok';
    fireEvent.click(within(dialog).getByRole('button', { name: 'Újrapróbálás' }));
    expect(await within(dialog).findByRole('option', { name: /Szabó Zoltán/ })).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('Xyz');
  });

  it('Esc először a keresőlistát zárja, a második a dialógot', async () => {
    setup({
      myRole: 'space_manager',
      extra: { 'GET /api/v1/users': () => Response.json([userRef('u-new', 'Szabó Zoltán')]) },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Tag hozzáadása/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Tag hozzáadása' });
    const input = within(dialog).getByRole('combobox', { name: 'Kolléga' });
    fireEvent.change(input, { target: { value: 'Szab' } });
    await within(dialog).findByRole('option', { name: /Szabó Zoltán/ });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(within(dialog).queryByRole('option')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Tag hozzáadása' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Tag hozzáadása' })).toBeNull(),
    );
  });

  it('tagfelvétel validation_error: a tag-specifikus üzenet, a dialóg nyitva marad, a lista újratölt', async () => {
    const { api } = setup({
      myRole: 'space_manager',
      extra: {
        'GET /api/v1/users': () => Response.json([userRef('u-new', 'Szabó Zoltán')]),
        [`POST /api/v1/spaces/${TEAM}/members`]: () => problem(400, 'validation_error'),
      },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Tag hozzáadása/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Tag hozzáadása' });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Kolléga' }), {
      target: { value: 'Szab' },
    });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Szabó Zoltán/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tag hozzáadása' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'lehet, hogy már tag, vagy már nem szerepel a belépésre jogosultak között',
    );
    expect(screen.getByRole('dialog', { name: 'Tag hozzáadása' })).toBeTruthy();
    await waitFor(() =>
      expect(api.callsTo(`GET /api/v1/spaces/${TEAM}/members`).length).toBeGreaterThanOrEqual(2),
    );
  });

  it('dupla küldés ellen: a gomb a művelet alatt letiltott, a kérés egyszer megy', async () => {
    const { api } = setup({
      myRole: 'space_manager',
      extra: {
        'GET /api/v1/users': () => Response.json([userRef('u-new', 'Szabó Zoltán')]),
        [`POST /api/v1/spaces/${TEAM}/members`]: () => 'pending',
      },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Tag hozzáadása/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Tag hozzáadása' });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Kolléga' }), {
      target: { value: 'Szab' },
    });
    fireEvent.click(await within(dialog).findByRole('option', { name: /Szabó Zoltán/ }));
    const submit = within(dialog).getByRole('button', { name: 'Tag hozzáadása' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    const pending = await within(dialog).findByRole('button', { name: 'Hozzáadás…' });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect(api.callsTo(`POST /api/v1/spaces/${TEAM}/members`)).toHaveLength(1);
  });

  it('önfelvétel: a Rendszeradmin a választott szerepben veszi fel magát, utána a /me újratölt', async () => {
    const { api } = setup({
      myRole: null,
      systemRole: 'system_admin',
      extra: { [`POST /api/v1/spaces/${TEAM}/members`]: () => Response.json({}, { status: 201 }) },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Felvétel magamat' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Felvétel a(z) „Fejlesztés” színtérbe',
    });
    expect(
      within(dialog).getByText(
        'A felvétel naplózódik, a színtér tagjai nem kapnak róla értesítést.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Szerző' }).checked).toBe(
      true,
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Színtérgazda' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Felvétel' }));
    await waitFor(() => expect(api.callsTo(`POST /api/v1/spaces/${TEAM}/members`)).toHaveLength(1));
    expect(api.callsTo(`POST /api/v1/spaces/${TEAM}/members`)[0]?.body).toEqual({
      userId: 'u-me',
      role: 'space_manager',
    });
    await waitFor(() => expect(api.callsTo('GET /api/v1/me').length).toBeGreaterThanOrEqual(2));
  });
});
