import { useEffect, useReducer } from 'react';
import type { ProjectRoute } from './project-route';

interface Options {
  route: ProjectRoute;
  routeKey: string;
  currentProjectId?: string;
  enabled: boolean;
  restore: (id: string | undefined, signal: AbortSignal) => Promise<void>;
}

/** Synchronize external navigation with local storage; superseded loads cannot publish. */
export function useProjectNavigation({
  route,
  routeKey,
  currentProjectId,
  enabled,
  restore,
}: Options) {
  const id = route.screen === 'invalid' ? undefined : route.projectId;
  const invalid = route.screen === 'invalid';
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  const [failure, setFailure] = useReducer(
    (
      _: { key: string; message: string } | null,
      next: { key: string; message: string } | null,
    ) => next,
    null,
  );
  const key = JSON.stringify([routeKey, route.screen, id, attempt]);
  const mismatch = !invalid && id !== currentProjectId;
  const error = invalid
    ? 'This project address is not valid.'
    : failure?.key === key
      ? failure.message
      : null;
  useEffect(() => {
    if (!enabled || invalid || !mismatch) return;
    const controller = new AbortController();
    void restore(id, controller.signal).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const missing = (failure as { code?: string })?.code === 'NOT_FOUND';
      setFailure({
        key,
        message: missing
          ? 'This project is unavailable in this browser. Open another saved project or import a backup.'
          : 'Could not open this project. Allow browser storage and try again.',
      });
    });
    return () => controller.abort();
  }, [enabled, invalid, mismatch, id, key, restore]);
  return {
    loading: mismatch && !error,
    blocked: mismatch || invalid,
    error,
    retry,
  };
}
