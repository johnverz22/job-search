import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { Layout } from './Layout';

// Pages are lazy so the sanitizer (JobPage) and status code stay out of the initial bundle.
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, lazy: () => import('./pages/SearchPage') },
      { path: 'jobs/:id', lazy: () => import('./pages/JobPage') },
      { path: 'status', lazy: () => import('./pages/StatusPage') },
      { path: '*', lazy: () => import('./pages/NotFound') },
    ],
  },
];

export const router = () => createBrowserRouter(routes);
