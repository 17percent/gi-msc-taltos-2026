import { Navigate, type RouteObject } from 'react-router';
import { RootLayout } from './layout/RootLayout';
import { AdminAdminsPage } from './pages/AdminAdminsPage';
import { AdminKindsPage } from './pages/AdminKindsPage';
import { AdminLayout } from './pages/AdminLayout';
import { AdminSpacesPage } from './pages/AdminSpacesPage';
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
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <Navigate to="/admin/spaces" replace /> },
          { path: 'spaces', element: <AdminSpacesPage /> },
          { path: 'admins', element: <AdminAdminsPage /> },
          { path: 'kinds', element: <AdminKindsPage /> },
        ],
      },
      { path: 'spaces/:spaceId/settings', element: <SpaceSettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
