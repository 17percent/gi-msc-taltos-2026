import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi, openSelect, problem, renderApp, summaries } from '../test/helpers';

const ok = (body: unknown) => () => Response.json(body);
const noContent = () => new Response(null, { status: 204 });

function twoSpaces() {
  return mockApi({
    'GET /api/v1/me': ok(makeMe()),
    'GET /api/v1/spaces': ok(summaries),
    'PUT /api/v1/me/current-space': noContent,
  });
}

async function nav() {
  return within(await screen.findByRole('navigation', { name: 'Fő navigáció' }));
}

describe('WP4b review-javítások (shell)', () => {
  it('a váltó listája a Sheet fölött jelenik meg (z-modal, nem z-overlay)', async () => {
    twoSpaces();
    renderApp('/');
    openSelect(await screen.findByRole('combobox', { name: 'Színtér' }));
    const list = await screen.findByRole('listbox');
    expect(list.className).toContain('z-(--z-modal)');
    expect(list.className).not.toContain('z-(--z-overlay)');
  });

  it('a böngészőfül címe követi az útvonalat', async () => {
    twoSpaces();
    renderApp('/');
    const menu = await nav();
    await waitFor(() => expect(document.title).toBe('Kezdőlap – Táltos'));
    fireEvent.click(menu.getByRole('link', { name: 'Színtér beállításai' }));
    await waitFor(() => expect(document.title).toBe('Színtér beállításai – Táltos'));
    fireEvent.click(menu.getByRole('link', { name: 'Kezdőlap' }));
    await waitFor(() => expect(document.title).toBe('Kezdőlap – Táltos'));
  });

  it('az ismeretlen oldalnak is van címe', async () => {
    twoSpaces();
    renderApp('/nincs-ilyen');
    await waitFor(() => expect(document.title).toBe('Az oldal nem létezik – Táltos'));
  });

  async function openSheetAndPick() {
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Menü megnyitása' }));
    const sheet = await screen.findByRole('dialog', { name: 'Menü' });
    openSelect(within(sheet).getByRole('combobox', { name: 'Színtér' }));
    fireEvent.keyDown(await screen.findByRole('option', { name: /Fejlesztés/ }), { key: 'Enter' });
    return sheet;
  }

  it('mobil váltás sikertelen: a Sheet nyitva marad, a hiba látszik', async () => {
    mockApi({
      'GET /api/v1/me': ok(makeMe()),
      'GET /api/v1/spaces': ok(summaries),
      'PUT /api/v1/me/current-space': () => problem(500, 'internal_error'),
    });
    const sheet = await openSheetAndPick();
    expect((await within(sheet).findByRole('alert')).textContent).toContain('Valami félresikerült');
    expect(screen.getByRole('dialog', { name: 'Menü' })).toBeTruthy();
  });

  it('mobil váltás sikeres: a Sheet bezárul', async () => {
    twoSpaces();
    await openSheetAndPick();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull());
  });

  it('gyors dupla váltásnál csak a legutóbbi kérés állíthat vissza', async () => {
    let first: (response: Response) => void = () => undefined;
    let calls = 0;
    mockApi({
      'GET /api/v1/me': ok(makeMe()),
      'GET /api/v1/spaces': ok(summaries),
      'PUT /api/v1/me/current-space': () => {
        calls += 1;
        return calls === 1
          ? new Promise<Response>((resolve) => {
              first = resolve;
            })
          : new Response(null, { status: 204 });
      },
    });
    renderApp('/');
    const pick = async (name: RegExp) => {
      openSelect(await screen.findByRole('combobox', { name: 'Színtér' }));
      fireEvent.keyDown(await screen.findByRole('option', { name }), { key: 'Enter' });
    };
    await pick(/Fejlesztés/);
    await waitFor(() => expect(calls).toBe(1));
    await pick(/Általános/);
    await waitFor(() => expect(calls).toBe(2));
    first(problem(500, 'internal_error'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('combobox', { name: 'Színtér' }).textContent).toContain('Általános');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
