import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { hasPendingCallback } from './oauth-callback';
import { parseProjectRoute, projectRoutePath } from './project-route';
import { readRecentProject } from './recent-project';

/** React Router owns history; components consume validated route identity and actions. */
export function useWorkspaceRoute({
  restoreRecent = false,
}: { restoreRecent?: boolean } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const startupConsumed = useRef(false);
  const [startup] = useState(() => ({
    key: location.key,
    projectId:
      restoreRecent &&
      !hasPendingCallback() &&
      location.pathname === '/' &&
      !location.search
        ? readRecentProject()
        : undefined,
  }));
  useEffect(() => {
    if (startupConsumed.current) return;
    startupConsumed.current = true;
    if (
      startup.projectId &&
      location.key === startup.key &&
      location.pathname === '/' &&
      !location.search
    ) {
      void navigate(projectRoutePath('editor', startup.projectId), {
        replace: true,
      });
    }
  }, [startup, location.key, location.pathname, location.search, navigate]);
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
