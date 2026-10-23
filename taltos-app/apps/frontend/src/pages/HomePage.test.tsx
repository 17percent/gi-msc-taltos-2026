import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../auth/types';
import { routes } from '../routes';

const me: MeResponse = {
  id: 'u1',
  displayName: 'Kovács Anna',
  email: 'anna@example.test',
  avatarUrl: null,
  systemRole: 'user',
  spaces: [],
  csrfToken: 'csrf-123',
};

const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ status, code }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function mockFetch(handler: Handler) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve().then(() => handler(urlOf(input), init)),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function withMe(meResponse: () => Response, extra?: Handler): Handler {
  return (url, init) => {
    if (url === '/api/v1/me') return meResponse();
    if (extra) return extra(url, init);
    return Response.json({ status: 'ok', version: '1.2.3' });
  };
}

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('betöltés', () => {
  it('a /me válaszáig betöltés-állapotot mutat', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    renderAt('/');
    expect(screen.getByRole('status').textContent).toBe('Betöltés…');
  });
});

describe('bejelentkezett állapot', () => {
  it('köszönti a felhasználót, kiírja a nevét, és jelzi a backend elérhetőségét', async () => {
    mockFetch(withMe(() => Response.json(me)));
    renderAt('/');
    expect(await screen.findByText(/Szia, Kovács Anna!/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Az alkalmazás váza fut');
    expect(screen.getByText('Kovács Anna')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kijelentkezés' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Bejelentkezés' })).toBeNull();
    expect((await screen.findByText(/Elérhető/)).textContent).toContain('Elérhető');
    expect(screen.getByText('verzió: 1.2.3')).toBeTruthy();
  });

  it('jelzi, ha a backend nem érhető el', async () => {
    mockFetch(
      withMe(
        () => Response.json(me),
        () => {
          throw new TypeError('network');
        },
      ),
    );
    renderAt('/');
    expect(await screen.findByText(/Nem érhető el/)).toBeTruthy();
  });

  it('avatarUrl esetén képet, egyébként monogramot mutat', async () => {
    mockFetch(withMe(() => Response.json({ ...me, avatarUrl: 'https://img.example.test/a.png' })));
    const { container } = render(
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />,
    );
    await screen.findByText(/Szia, /);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.example.test/a.png',
    );
    cleanup();

    mockFetch(withMe(() => Response.json(me)));
    const second = render(
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />,
    );
    await screen.findByText(/Szia, /);
    expect(second.container.querySelector('img')).toBeNull();
    expect(screen.getByText('KA')).toBeTruthy();
  });

  it('kijelentkezéskor CSRF-fejléccel POST-ol, majd a kijelentkezett állapotot mutatja', async () => {
    const fetchMock = mockFetch(
      withMe(
        () => Response.json(me),
        (url, init) =>
          url === '/auth/logout' && init?.method === 'POST'
            ? new Response(null, { status: 204 })
            : Response.json({ status: 'ok', version: '1.2.3' }),
      ),
    );
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Kijelentkezés' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Jelentkezz be a Táltosba' }),
    ).toBeTruthy();

    const call = fetchMock.mock.calls.find(([url]) => urlOf(url) === '/auth/logout');
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'csrf-123' },
    });
  });

  it('sikertelen kijelentkezést jelez, és bejelentkezve marad', async () => {
    mockFetch(
      withMe(
        () => Response.json(me),
        (url) =>
          url === '/auth/logout'
            ? problem(403, 'csrf_invalid')
            : Response.json({ status: 'ok', version: '1.2.3' }),
      ),
    );
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Kijelentkezés' }));
    expect((await screen.findByRole('alert')).textContent).toContain('nem sikerült');
    expect(screen.getByText(/Szia, Kovács Anna!/)).toBeTruthy();
  });
});

describe('kijelentkezett állapot', () => {
  it('401-nél magyarázatot és Bejelentkezés gombot mutat, hibaüzenet nélkül', async () => {
    mockFetch(withMe(() => problem(401, 'unauthenticated')));
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Jelentkezz be a Táltosba' }),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const links = screen.getAllByRole('link', { name: 'Bejelentkezés' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.getAttribute('href')).toBe('/auth/login');
  });

  it('a /me lekérdezés same-origin sütivel megy', async () => {
    const fetchMock = mockFetch(withMe(() => problem(401, 'unauthenticated')));
    renderAt('/');
    await screen.findByRole('heading', { level: 1 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/me');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin' });
  });
});

describe('nem jogosult cím', () => {
  it('?error=not_on_allowlist esetén figyelmeztetést ad a Rendszeradminisztrátorról', async () => {
    mockFetch(withMe(() => problem(401, 'unauthenticated')));
    renderAt('/?error=not_on_allowlist');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Rendszeradminisztrátor');
    expect(alert.textContent).toContain('nincs a jogosultak listáján');
    expect(screen.getByRole('link', { name: 'Bejelentkezés másik fiókkal' })).toBeTruthy();
  });

  it('403 not_on_allowlist a /me-n ugyanezt mutatja', async () => {
    mockFetch(withMe(() => problem(403, 'not_on_allowlist')));
    renderAt('/');
    expect((await screen.findByRole('alert')).textContent).toContain('Rendszeradminisztrátor');
  });
});

describe('hibaállapot', () => {
  it('váratlan szerverhibánál hibát és újratöltést kínál', async () => {
    mockFetch(withMe(() => problem(500, 'internal')));
    renderAt('/');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nem sikerült ellenőrizni');
    expect(screen.getByRole('button', { name: 'Oldal újratöltése' })).toBeTruthy();
  });

  it('hálózati hibánál is hibát mutat', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network'))),
    );
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});

describe('útvonalak', () => {
  it('ismeretlen útvonalon a hiányzó oldal jelenik meg', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    renderAt('/nincs-ilyen');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ez az oldal nem létezik');
  });
});
