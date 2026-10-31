import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  GENERAL,
  TEAM,
  detailOf,
  makeMe,
  members,
  mockApi,
  openMenu,
  problem,
  renderApp,
  summaries,
  userRef,
} from '../test/helpers';
import type { SpaceMember, SpaceSummary } from '@taltos/shared';

const team = summaries.find((space) => space.id === TEAM) as SpaceSummary;
const list: SpaceMember[] = [
  { user: userRef('u-boss', 'Nagy Béla'), role: 'space_manager' },
  { user: userRef('u-me', 'Kovács Anna'), role: 'space_manager' },
  { user: userRef('u-x', 'Szabó Csilla'), role: 'author' },
  { user: userRef('u-y', 'Tóth Dóra'), role: 'author' },
];

describe('SpaceSettings review-javítások', () => {
  it('a korábbi hibaüzenet eltűnik, ha a következő művelet sikeres', async () => {
    mockApi({
      'GET /api/v1/me': () =>
        Response.json(
          makeMe({
            spaces: [
              { id: GENERAL, name: 'Általános', type: 'general', role: 'author' },
              { id: TEAM, name: 'Fejlesztés', type: 'team', role: 'space_manager' },
            ],
          }),
        ),
      'GET /api/v1/spaces': () => Response.json(summaries),
      [`GET /api/v1/spaces/${TEAM}`]: () => Response.json(detailOf(team)),
      [`GET /api/v1/spaces/${TEAM}/members`]: () => Response.json(list.length ? list : members),
      [`DELETE /api/v1/spaces/${TEAM}/members/u-x`]: () => problem(409, 'owner_handover_required'),
      [`PATCH /api/v1/spaces/${TEAM}/members/u-y`]: () => Response.json({}),
    });
    renderApp(`/spaces/${TEAM}/settings`);
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Szabó Csilla' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eltávolítás' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eltávolítás' }),
    );
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    openMenu(await screen.findByRole('button', { name: 'Műveletek: Tóth Dóra' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Legyen Színtérgazda' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('érvénytelen spaceId: „nem található” állapot, és nem megy kérés a színtér-végpontokra', async () => {
    const api = mockApi({
      'GET /api/v1/me': () => Response.json(makeMe()),
      'GET /api/v1/spaces': () => Response.json(summaries),
    });
    renderApp('/spaces/..%2Fadmin%2Fusers/settings');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'A színtér nem található' }),
    ).toBeTruthy();
    expect(api.calls.filter((call) => call.path.startsWith('/api/v1/spaces/'))).toHaveLength(0);
    expect(api.calls.some((call) => call.path.includes('admin'))).toBe(false);
  });
});
