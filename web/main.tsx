import { type ComponentType, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, redirect, RouterProvider } from 'react-router-dom';
import { Shell } from './components/Shell.tsx';
import { Root } from './components/WallDeck.tsx';
import { SnapshotProvider } from './lib/store.tsx';
import { Home } from './views/Home.tsx';
import { initAppearance } from './lib/appearance.ts';
import { NotFound } from './views/NotFound.tsx';
import { RouteError, reloadForNewBuild } from './components/RouteError.tsx';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/dm-sans';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import '@fontsource/dm-serif-display/400.css';
import './styles.css';

// Home loads with the app; every other page loads the first time it opens,
// so a phone opening Home doesn't download Settings and the editors.
const page = <M extends Record<string, any>>(load: () => Promise<M>, name: keyof M) => async () => ({ Component: (await load())[name] as ComponentType });

const router = createBrowserRouter([
  {
    // A household device's swipe pages stay alive between swipes: see WallDeck.
    element: <Root />,
    HydrateFallback: () => null,
    errorElement: <RouteError />,
    children: [
      {
        element: <Shell />,
        // Pages load lazily; nothing to show for the instant before the first one does.
        HydrateFallback: () => null,
        children: [
          {
            // A page that fails shows why inside the nav, so the rest stays a tap away.
            errorElement: <RouteError />,
            children: [
              { path: '/', element: <Home /> },
              { path: '/b/:board', element: <Home /> },
              { path: '/server', lazy: page(() => import('./views/Server.tsx'), 'Server') },
              { path: '/stacks', lazy: page(() => import('./views/Stacks.tsx'), 'Stacks') },
              { path: '/c/:name', lazy: page(() => import('./views/Container.tsx'), 'ContainerPage') },
              { path: '/reading', lazy: page(() => import('./views/Feeds.tsx'), 'Feeds') },
              // The page was /feeds before it was Reading; old bookmarks still land.
              { path: '/feeds', loader: ({ request }) => redirect(`/reading${new URL(request.url).search}`) },
              { path: '/upcoming', lazy: page(() => import('./views/Upcoming.tsx'), 'Upcoming') },
              { path: '/weather', lazy: page(() => import('./views/Weather.tsx'), 'Weather') },
              { path: '/logs', lazy: page(() => import('./views/Logs.tsx'), 'Logs') },
              { path: '/logs/:name', lazy: page(() => import('./views/Logs.tsx'), 'Logs') },
              { path: '/apps', lazy: page(() => import('./views/Apps.tsx'), 'Apps') },
              { path: '/downloads', lazy: page(() => import('./views/Downloads.tsx'), 'Downloads') },
              { path: '/library', lazy: page(() => import('./views/Library.tsx'), 'Library') },
              { path: '/media', lazy: page(() => import('./views/Media.tsx'), 'Media') },
              { path: '/blocking', lazy: page(() => import('./views/Blocking.tsx'), 'Blocking') },
              { path: '/requests', lazy: page(() => import('./views/Requests.tsx'), 'Requests') },
              { path: '/settings', lazy: page(() => import('./views/Settings.tsx'), 'Settings') },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
      // Full screen, without the nav: the server on one screen for a wall tablet.
      { path: '/monitor', HydrateFallback: () => null, lazy: page(() => import('./views/Monitor.tsx'), 'Monitor') },
      // One widget, full screen, for a small display or a page on a wall tablet.
      { path: '/w/:board/:widget', HydrateFallback: () => null, lazy: page(() => import('./views/WidgetPage.tsx'), 'WidgetPage') },
    ],
  },
]);

initAppearance();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SnapshotProvider>
      <RouterProvider router={router} />
    </SnapshotProvider>
  </StrictMode>,
);

// iOS ignores user-scalable=no for pinches; its own gesture events can still be refused.
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

// A file the page preloads is gone after an update: reload onto the new build.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewBuild()) e.preventDefault();
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js');
}
