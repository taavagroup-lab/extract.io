import { useSyncExternalStore } from 'react';

export type Route = 'menu' | 'play' | 'inventory' | 'marketplace' | 'leaderboard' | 'profile';
const ROUTES: Route[] = ['menu', 'play', 'inventory', 'marketplace', 'leaderboard', 'profile'];

function current(): Route {
  const h = window.location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(h) ? h : 'menu';
}

function subscribe(fn: () => void): () => void {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current, current);
}

export function navigate(route: Route): void {
  const target = route === 'menu' ? '#/' : `#/${route}`;
  if (window.location.hash !== target) window.location.hash = target;
}
