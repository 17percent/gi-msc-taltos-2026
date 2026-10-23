import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../routes';

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('kezdőoldal', () => {
  it('jelzi, ha a backend elérhető', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok', version: '1.2.3' }))),
    );
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Az alkalmazás váza fut');
    expect((await screen.findByText(/Elérhető/)).textContent).toContain('Elérhető');
    expect(screen.getByText('verzió: 1.2.3')).toBeTruthy();
  });

  it('jelzi, ha a backend nem érhető el', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network'))),
    );
    renderAt('/');
    expect(await screen.findByText(/Nem érhető el/)).toBeTruthy();
  });

  it('ismeretlen útvonalon a hiányzó oldal jelenik meg', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    renderAt('/nincs-ilyen');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ez az oldal nem létezik');
  });
});
