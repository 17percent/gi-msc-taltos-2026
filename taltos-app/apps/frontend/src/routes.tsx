import type { RouteObject } from 'react-router';
import { RootLayout } from './layout/RootLayout';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SpaceSettingsPage } from './pages/SpaceSettingsPage';

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      {
        // A szerkesztő (CodeMirror, Yjs, unified) külön csomagba kerül: a kezdőoldal nem tölti le.
        path: 'documents/:documentId',
        lazy: async () => ({ Component: (await import('./pages/DocumentPage')).DocumentPage }),
      },
      { path: 'spaces/:spaceId/settings', element: <SpaceSettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
