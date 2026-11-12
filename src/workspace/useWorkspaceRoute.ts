import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { parseProjectRoute, projectRoutePath } from './project-route';

/** React Router owns history; components consume validated route identity and actions. */
export function useWorkspaceRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const legacyHash = location.hash.startsWith('#/');
  const [pathname, search = ''] = legacyHash
    ? location.hash.slice(1).split('?')
    : [location.pathname, location.search];
  const route = parseProjectRoute(pathname!, search);
  const screen = route.screen;
  const projectId = route.screen === 'invalid' ? undefined : route.projectId;
  useEffect(() => {
    if (screen === 'invalid') return;
    if (
      !legacyHash &&
      location.pathname !== '/projects' &&
      !location.pathname.startsWith('/project/')
    )
      return;
    const target = new URL(
      projectRoutePath(screen, projectId),
      'https://localcut.invalid',
    );
    const query = new URLSearchParams(location.search);
    query.delete('project');
    for (const [key, value] of target.searchParams) query.set(key, value);
    void navigate(target.pathname + (query.size ? `?${query}` : ''), {
      replace: true,
    });
  }, [
    legacyHash,
    location.pathname,
    location.search,
    navigate,
    screen,
    projectId,
  ]);
  const go = useCallback(
    (screen: 'editor' | 'projects', id?: string, replace = false) => {
      const path = projectRoutePath(screen, id);
      if (path !== location.pathname + location.search + location.hash)
        void navigate(path, { replace });
    },
    [navigate, location.pathname, location.search, location.hash],
  );
  return {
    route,
    routeKey: location.key,
    go,
  };
}
