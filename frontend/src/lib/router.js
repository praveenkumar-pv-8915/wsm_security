/**
 * Minimal hash router — no dependency, because the app has three routes.
 *
 * Hash routing (not history/pushState) is deliberate: the client is served by Catalyst web client
 * hosting, which serves index.html at /app/ and does not rewrite deep paths back to it. A real
 * path like /app/connections would 404 on reload; /app/#/connections never leaves the server's view
 * of the URL.
 *
 * It also has to survive the OAuth callback. functions/welcome/index.js redirects to
 * `/app/#/connections?status=connected&detail=…` — the query sits AFTER the hash, so
 * window.location.search is empty and the params have to be parsed out of the hash itself.
 */

import { useEffect, useState } from 'react';

export const ROUTES = ['/', '/connections'];

export function parseHash(hash) {
  const raw = String(hash === undefined ? window.location.hash : hash).replace(/^#/, '');
  const [rawPath, rawQuery = ''] = raw.split('?');
  const path = !rawPath || rawPath === '/' ? '/' : (rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
  return {
    path: ROUTES.includes(path) ? path : '/',
    params: new URLSearchParams(rawQuery),
  };
}

export function navigate(path) {
  window.location.hash = path;
}

/** Drop the query string off the current route, keeping the path — used to clear callback params. */
export function clearRouteParams() {
  const { path } = parseHash();
  window.history.replaceState({}, document.title, `${window.location.pathname}#${path}`);
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
