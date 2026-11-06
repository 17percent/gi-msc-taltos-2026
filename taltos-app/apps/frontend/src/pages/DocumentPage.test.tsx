import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../routes';

const me = {
  id: 'u1',
  displayName: 'Kovács Anna',
  email: 'anna@example.test',
  avatarUrl: null,
  systemRole: 'user',
  spaces: [],
  csrfToken: 'csrf-123',
};

function renderAt(path: string, signedIn: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        signedIn
          ? Response.json(me)
          : new Response(JSON.stringify({ status: 401, code: 'unauthenticated' }), {
              status: 401,
              headers: { 'Content-Type': 'application/problem+json' },
            }),
      ),
    ),
  );
  // Érvénytelen azonosítónál nem szabad kapcsolatot nyitni.
  const socket = vi.fn();
  vi.stubGlobal('WebSocket', socket);
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
  return socket;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('dokumentum-oldal', () => {
  // A szerkesztő külön csomagja lusta betöltésű: terhelés alatt (párhuzamos tesztfájlok) a modul-fordítás
  // lassú lehet, ezért az első megjelenésre hosszabb időkorlát jár (az alapértelmezett 1 s kevés).
  it('kijelentkezve bejelentkezésre hív', async () => {
    renderAt('/documents/3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', false);
    expect(
      await screen.findByRole('heading', { name: 'Jelentkezz be a Táltosba' }, { timeout: 15_000 }),
    ).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Bejelentkezés' }).length).toBeGreaterThan(0);
  }, 20_000);

  it('érvénytelen azonosítónál semleges üzenetet ad, és nem nyit WebSocketet', async () => {
    const socket = renderAt('/documents/nem-uuid', true);
    const alert = await screen.findByRole('alert', {}, { timeout: 15_000 });
    expect(alert.textContent).toBe('Nincs hozzáférésed ehhez a dokumentumhoz, vagy nem létezik.');
    expect(socket).not.toHaveBeenCalled();
  }, 20_000);

  it('a nagybetűs UUID sem érvényes (a szerver kisbetűs nevet vár)', async () => {
    const socket = renderAt('/documents/3F1B2C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D', true);
    expect((await screen.findByRole('alert', {}, { timeout: 15_000 })).textContent).toContain(
      'Nincs hozzáférésed',
    );
    expect(socket).not.toHaveBeenCalled();
  }, 20_000);
});
