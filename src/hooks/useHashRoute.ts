import { useCallback, useEffect, useState } from 'react';

/**
 * Minimal hash router. The app previously held the active view in a
 * `useState`, which meant no deep links, no browser back/forward, and
 * a reload always dropped you on the dashboard. Hash routing gets all
 * three without adding a routing dependency or a server rewrite rule
 * (this is a static build served from `dist/`).
 */
export function useHashRoute<T extends string>(routes: readonly T[], fallback: T) {
  const parse = useCallback((): T => {
    const raw = window.location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
    return (routes as readonly string[]).includes(raw) ? (raw as T) : fallback;
  }, [routes, fallback]);

  const [route, setRoute] = useState<T>(parse);

  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    // Normalise a missing/unknown hash so the URL always reflects the view.
    if (window.location.hash.replace(/^#\/?/, '') !== route) {
      window.history.replaceState(null, '', `#/${route}`);
    }
    return () => window.removeEventListener('hashchange', onChange);
  }, [parse, route]);

  const navigate = useCallback((next: T) => {
    // Pushing to history is what makes Back work between views.
    window.location.hash = `#/${next}`;
  }, []);

  return [route, navigate] as const;
}
