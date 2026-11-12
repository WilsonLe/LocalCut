import { useLayoutEffect, useRef } from 'react';
import type { ModelContext } from './webmcp/types';
import { browserAgentConnection } from './webmcp/connection';
import type {
  WorkspaceToolHost,
  WorkspaceToolState,
} from './webmcp/workspace-tool';

interface Props extends Omit<WorkspaceToolHost, 'getState'> {
  state: Omit<WorkspaceToolState, 'url'>;
  onError(error: unknown): void;
}

/** The application-level entry point stays available across project navigation. */
export function useWorkspaceWebMCP(props: Props) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  useLayoutEffect(() => {
    const registration = browserAgentConnection.register(
      'workspace',
      () =>
        (document as Document & { modelContext?: ModelContext }).modelContext,
      async (signal) => {
        const [{ workspaceTool }, { skillsTool }] = await Promise.all([
          import('./webmcp/workspace-tool'),
          import('./webmcp/skills-tool'),
        ]);
        return {
          tools: [
            skillsTool(
              signal,
              new URL(
                `${import.meta.env.BASE_URL}skills/`,
                window.location.href,
              ).href,
            ),
            workspaceTool(
              {
                getState: () =>
                  signal.aborted
                    ? null
                    : { ...latest.current.state, url: window.location.href },
                getEditor: () => latest.current.getEditor(),
                openProject: (project, signal) =>
                  latest.current.openProject(project, signal),
                selectFiles: (scope) => latest.current.selectFiles(scope),
              },
              signal,
            ),
          ],
        };
      },
      (error) => latest.current.onError(error),
    );
    return () => {
      void registration
        .dispose()
        .catch((error: unknown) => latest.current.onError(error));
    };
  }, []);
}
