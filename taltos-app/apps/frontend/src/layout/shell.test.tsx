import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  GENERAL,
  PROJECT,
  TEAM,
  makeMe,
  mockApi,
  openSelect,
  problem,
  renderApp,
  summaries,
} from '../test/helpers';

const ok = (body: unknown) => () => Response.json(body);
const noContent = () => new Response(null, { status: 204 });

async function nav() {
  return within(await screen.findByRole('navigation', { name: 'Fő navigáció' }));
}

describe('navigáció szerepenként (spec 2.3)', () => {
  it('Szerzőnek: Kezdőlap + Színtér beállításai, Adminisztráció nincs', async () => {
    mockApi({ 'GET /api/v1/me': ok(makeMe()), 'GET /api/v1/spaces': ok(summaries) });
    renderApp('/');
    const menu = await nav();
    expect(menu.getByRole('link', { name: 'Kezdőlap' })).toBeTruthy();
    expect(menu.getByRole('link', { name: 'Színtér beállításai' }).getAttribute('href')).toBe(
      `/spaces/${GENERAL}/settings`,
    );
    expect(menu.queryByRole('link', { name: 'Adminisztráció' })).toBeNull();
  });

  it('Rendszeradminisztrátornak az Adminisztráció is látszik', async () => {
    mockApi({
      'GET /api/v1/me': ok(makeMe({ systemRole: 'system_admin' })),
      'GET /api/v1/spaces': ok(summaries),
    });
    renderApp('/');
    const menu = await nav();
    expect(menu.getByRole('link', { name: 'Adminisztráció' }).getAttribute('href')).toBe('/admin');
  });

  it('az aktív elem aria-current="page" jelölést kap', async () => {
    mockApi({ 'GET /api/v1/me': ok(makeMe()), 'GET /api/v1/spaces': ok(summaries) });
    renderApp('/');
    const menu = await nav();
    expect(menu.getByRole('link', { name: 'Kezdőlap' }).getAttribute('aria-current')).toBe('page');
  });

  it('kijelentkezve nincs oldalsáv, csak Bejelentkezés', async () => {
    mockApi({ 'GET /api/v1/me': () => problem(401, 'unauthenticated') });
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Jelentkezz be a Táltosba' });
    expect(screen.queryByRole('navigation', { name: 'Fő navigáció' })).toBeNull();
  });

  it('van „Ugrás a tartalomra” link és main tájékozódási pont', async () => {
    mockApi({ 'GET /api/v1/me': ok(makeMe()), 'GET /api/v1/spaces': ok(summaries) });
    renderApp('/');
    await nav();
    expect(screen.getByRole('link', { name: 'Ugrás a tartalomra' }).getAttribute('href')).toBe(
      '#main-content',
    );
    expect(screen.getByRole('main')).toBeTruthy();
  });
});

describe('színtérváltó (spec 2.2)', () => {
  it('az aktuális színteret mutatja, színponttal a GET /spaces adatából', async () => {
    mockApi({ 'GET /api/v1/me': ok(makeMe()), 'GET /api/v1/spaces': ok(summaries) });
    renderApp('/');
    const trigger = await screen.findByRole('combobox', { name: 'Színtér' });
    expect(trigger.textContent).toContain('Általános');
    await waitFor(() => {
      const dot = within(trigger).getByTestId('space-dot');
      expect(dot.style.backgroundColor).not.toBe('');
    });
  });

  it('váltáskor PUT /me/current-space megy CSRF-fejléccel, és a felirat átvált', async () => {
    const api = mockApi({
      'GET /api/v1/me': ok(makeMe()),
      'GET /api/v1/spaces': ok(summaries),
      'PUT /api/v1/me/current-space': noContent,
    });
    renderApp('/');
    openSelect(await screen.findByRole('combobox', { name: 'Színtér' }));
    fireEvent.keyDown(await screen.findByRole('option', { name: /Fejlesztés/ }), { key: 'Enter' });
    await waitFor(() => expect(api.callsTo('PUT /api/v1/me/current-space')).toHaveLength(1));
    const call = api.callsTo('PUT /api/v1/me/current-space')[0];
    expect(call?.body).toEqual({ spaceId: TEAM });
    expect(call?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf-123' });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Színtér' }).textContent).toContain('Fejlesztés'),
    );
    const menu = await nav();
    expect(menu.getByRole('link', { name: 'Színtér beállításai' }).getAttribute('href')).toBe(
      `/spaces/${TEAM}/settings`,
    );
  });

  it('sikertelen váltásnál visszaáll, és hibaüzenetet ad', async () => {
    mockApi({
      'GET /api/v1/me': ok(makeMe()),
      'GET /api/v1/spaces': ok(summaries),
      'PUT /api/v1/me/current-space': () => problem(500, 'internal_error'),
    });
    renderApp('/');
    openSelect(await screen.findByRole('combobox', { name: 'Színtér' }));
    fireEvent.keyDown(await screen.findByRole('option', { name: /Fejlesztés/ }), { key: 'Enter' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Valami félresikerült nálunk');
    expect(screen.getByRole('combobox', { name: 'Színtér' }).textContent).toContain('Általános');
  });

  it('a /me currentSpaceId-jét használja kezdőértéknek', async () => {
    mockApi({
      'GET /api/v1/me': ok(makeMe({ currentSpaceId: TEAM })),
      'GET /api/v1/spaces': ok(summaries),
    });
    renderApp('/');
    const trigger = await screen.findByRole('combobox', { name: 'Színtér' });
    expect(trigger.textContent).toContain('Fejlesztés');
  });

  it('ha a currentSpaceId nem saját tér, az Általánosra esik vissza', async () => {
    mockApi({
      'GET /api/v1/me': ok(makeMe({ currentSpaceId: PROJECT })),
      'GET /api/v1/spaces': ok(summaries),
    });
    renderApp('/');
    expect((await screen.findByRole('combobox', { name: 'Színtér' })).textContent).toContain(
      'Általános',
    );
  });

  it('Általános nélkül az első saját térre esik vissza', async () => {
    mockApi({
      'GET /api/v1/me': ok(
        makeMe({
          currentSpaceId: null,
          spaces: [{ id: TEAM, name: 'Fejlesztés', type: 'team', role: 'author' }],
        }),
      ),
      'GET /api/v1/spaces': ok(summaries),
    });
    renderApp('/');
    expect((await screen.findByRole('combobox', { name: 'Színtér' })).textContent).toContain(
      'Fejlesztés',
    );
  });

  it('csak a saját tagságú színtereket kínálja, lezárt jelöléssel', async () => {
    const closed = summaries.map((space) =>
      space.id === TEAM ? { ...space, closed: true } : space,
    );
    mockApi({
      'GET /api/v1/me': ok(makeMe({ systemRole: 'system_admin' })),
      'GET /api/v1/spaces': ok(closed),
    });
    renderApp('/');
    openSelect(await screen.findByRole('combobox', { name: 'Színtér' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Általános', 'FejlesztésLezárt']);
    expect(screen.queryByRole('option', { name: /Atlasz-pilot/ })).toBeNull();
  });

  it('nincs színtér: magyarázat; Rendszeradminnak link az Adminisztrációra', async () => {
    mockApi({
      'GET /api/v1/me': ok(makeMe({ spaces: [], currentSpaceId: null })),
      'GET /api/v1/spaces': ok(summaries),
    });
    renderApp('/');
    expect(await screen.findByText('Nincs színtered')).toBeTruthy();
    expect(screen.getByText('Kérd meg valamelyik Színtérgazdát, hogy vegyen fel.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Színtér beállításai' })).toBeNull();
  });

  it('nincs színtér, Rendszeradmin: „Vedd fel magad az Adminisztrációban.”', async () => {
    mockApi({
      'GET /api/v1/me': ok(
        makeMe({ spaces: [], currentSpaceId: null, systemRole: 'system_admin' }),
      ),
      'GET /api/v1/spaces': ok(summaries),
    });
    renderApp('/');
    const link = await screen.findByRole('link', { name: 'Adminisztrációban' });
    expect(link.getAttribute('href')).toBe('/admin/spaces');
  });

  it('betöltés közben skeleton (aria-busy)', async () => {
    mockApi({
      'GET /api/v1/me': ok(makeMe()),
      'GET /api/v1/spaces': () => 'pending',
    });
    renderApp('/');
    expect(await screen.findByText('Színterek betöltése…')).toBeTruthy();
  });

  it('a lista betöltési hibájánál Alert és Újrapróbálás', async () => {
    let fail = true;
    const api = mockApi({
      'GET /api/v1/me': ok(makeMe()),
      'GET /api/v1/spaces': () =>
        fail ? problem(500, 'internal_error') : Response.json(summaries),
    });
    renderApp('/');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('A színterek listája nem töltődött be.');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Újrapróbálás' }));
    await screen.findByRole('combobox', { name: 'Színtér' });
    expect(api.callsTo('GET /api/v1/spaces')).toHaveLength(2);
  });
});

describe('mobil oldalsáv (Sheet)', () => {
  it('a hamburger megnyitja a menüt a váltóval és a navigációval', async () => {
    mockApi({ 'GET /api/v1/me': ok(makeMe()), 'GET /api/v1/spaces': ok(summaries) });
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Menü megnyitása' }));
    const sheet = await screen.findByRole('dialog', { name: 'Menü' });
    expect(within(sheet).getByRole('link', { name: 'Kezdőlap' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('link', { name: 'Kezdőlap' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull());
  });

  it('Esc bezárja', async () => {
    mockApi({ 'GET /api/v1/me': ok(makeMe()), 'GET /api/v1/spaces': ok(summaries) });
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Menü megnyitása' }));
    const sheet = await screen.findByRole('dialog', { name: 'Menü' });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull());
  });
});

describe('fiókmenü (spec 2.4)', () => {
  it('Rendszeradminnál megjelenik a szerep, e-mail soha', async () => {
    mockApi({
      'GET /api/v1/me': ok(makeMe({ systemRole: 'system_admin' })),
      'GET /api/v1/spaces': ok(summaries),
    });
    renderApp('/');
    const trigger = await screen.findByRole('button', { name: 'Fiókmenü: Kovács Anna' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = await screen.findByRole('menu');
    expect(menu.textContent).toContain('Rendszeradminisztrátor');
    expect(menu.textContent).not.toContain('@');
  });
});
