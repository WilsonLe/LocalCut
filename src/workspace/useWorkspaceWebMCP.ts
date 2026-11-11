import { useLayoutEffect, useRef } from 'react';
import type { ModelContext } from './webmcp/types';
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
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    const pending = import('./webmcp/workspace-tool').then(
      async ({ workspaceTool }) => {
        if (controller.signal.aborted) return;
        const tool = workspaceTool(
          {
            getState: () =>
              controller.signal.aborted
                ? null
                : { ...latest.current.state, url: window.location.href },
            getEditor: () => latest.current.getEditor(),
            openProject: (project, signal) =>
              latest.current.openProject(project, signal),
            selectFiles: (scope) => latest.current.selectFiles(scope),
          },
          controller.signal,
        );
        await context.registerTool(tool, { signal: controller.signal });
      },
    );
    void pending.catch((error: unknown) => {
      if (!controller.signal.aborted) {
        controller.abort();
        latest.current.onError(error);
      }
    });
    return () => controller.abort();
  }, []);
}
