import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { parseProjectRoute, projectRoutePath } from './project-route';

/** React Router owns history; components consume validated route identity and actions. */
export function useWorkspaceRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const go = useCallback(
    (screen: 'editor' | 'projects', id?: string, replace = false) => {
      const path = projectRoutePath(screen, id);
      if (path !== location.pathname + location.search)
        void navigate(path, { replace });
    },
    [navigate, location.pathname, location.search],
  );
  return {
    route: parseProjectRoute(location.pathname, location.search),
    routeKey: location.key,
    go,
  };
}
