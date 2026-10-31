import type { SpaceDetail, SpaceMember, SpaceSummary } from '@taltos/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { MeResponse } from '../auth/types';
import { routes } from '../routes';

export const GENERAL = '11111111-1111-4111-8111-111111111111';
export const TEAM = '22222222-2222-4222-8222-222222222222';
export const PROJECT = '33333333-3333-4333-8333-333333333333';

export const baseMe: MeResponse = {
  id: 'u-me',
  displayName: 'Kovács Anna',
  email: 'anna@example.test',
  avatarUrl: null,
  systemRole: 'user',
  spaces: [
    { id: GENERAL, name: 'Általános', type: 'general', role: 'author' },
    { id: TEAM, name: 'Fejlesztés', type: 'team', role: 'space_manager' },
  ],
  currentSpaceId: GENERAL,
  csrfToken: 'csrf-123',
};

export function makeMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return { ...baseMe, ...overrides };
}

export const summaries: SpaceSummary[] = [
  {
    id: GENERAL,
    name: 'Általános',
    type: 'general',
    description: 'A közös tér.',
    color: '#3B6FB6',
    closed: false,
  },
  {
    id: TEAM,
    name: 'Fejlesztés',
    type: 'team',
    description: 'A fejlesztők tere.\nMásodik sor.',
    color: '#2E8B6F',
    closed: false,
  },
  {
    id: PROJECT,
    name: 'Atlasz-pilot',
    type: 'project',
    description: 'Időben korlátos projekt.',
    color: '#B5651D',
    closed: false,
  },
];

export const userRef = (id: string, displayName: string) => ({ id, displayName, avatarUrl: null });

export function detailOf(summary: SpaceSummary, extra: Partial<SpaceDetail> = {}): SpaceDetail {
  return {
    ...summary,
    managers: [userRef('u-boss', 'Nagy Béla')],
    memberCount: 3,
    ...extra,
  };
}

export const members: SpaceMember[] = [
  { user: userRef('u-boss', 'Nagy Béla'), role: 'space_manager' },
  { user: userRef('u-me', 'Kovács Anna'), role: 'author' },
  { user: userRef('u-x', 'Szabó Csilla'), role: 'author' },
];

export function problem(status: number, code: string, details?: unknown): Response {
  return new Response(JSON.stringify({ status, code, title: 'x', details }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

/** `'pending'`: a kérés sosem fejeződik be (betöltés-állapot vizsgálatához). */
export type RouteHandler = (request: {
  url: URL;
  init: RequestInit | undefined;
}) => Response | 'pending';
export type RouteTable = Record<string, Response | RouteHandler>;

export type Call = {
  method: string;
  path: string;
  query: string;
  body: unknown;
  headers: Record<string, string>;
};

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * `fetch` mock útvonal-táblával: a kulcs `"METHOD /út"` (lekérdezés nélkül). Nem egyező kérés 404.
 * A választ `Response`-ként vagy függvényként lehet megadni (függvénynél minden híváskor új válasz).
 */
export function mockApi(table: RouteTable) {
  const calls: Call[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(urlOf(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const handler = table[`${method} ${url.pathname}`];
    calls.push({
      method,
      path: url.pathname,
      query: url.search,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (!handler) return Promise.resolve(problem(404, 'not_found'));
    const response = typeof handler === 'function' ? handler({ url, init }) : handler.clone();
    return response === 'pending'
      ? new Promise<Response>(() => undefined)
      : Promise.resolve(response);
  });
  vi.stubGlobal('fetch', fn);
  return {
    fn,
    calls,
    callsTo: (key: string) => calls.filter((call) => `${call.method} ${call.path}` === key),
  };
}

export function renderApp(path: string) {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

/** Radix menü megnyitása billentyűvel (jsdom-ban a pointer-események nem megbízhatók). */
export function openMenu(trigger: HTMLElement): void {
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

/** Radix Select megnyitása billentyűvel. */
export function openSelect(trigger: HTMLElement): void {
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

export async function openRowMenu(name: string): Promise<void> {
  openMenu(await screen.findByRole('button', { name }));
}
