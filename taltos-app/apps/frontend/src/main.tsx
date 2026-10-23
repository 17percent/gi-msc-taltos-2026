import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { routes } from './routes';
import { applyInitialTheme } from './theme';
import './styles/index.css';

applyInitialTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Hiányzik a #root elem.');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
  </StrictMode>,
);
