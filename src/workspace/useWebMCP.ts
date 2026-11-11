import { useLayoutEffect, useRef } from 'react';
import type { ModelContext, SiteToolHost } from './webmcp/types';
import type { Editor, Project, ProjectVersion } from '../editor';
import type { PlaybackPosition } from './playback-position';
import type { RefObject } from 'react';
import type { PreviewControls } from './Preview';
import type { ProjectRoute } from './project-route';

interface Props {
  editor: Editor | null;
  project: Project | null;
  route: ProjectRoute;
  version: ProjectVersion | null;
  selectedClipIds: string[];
  position: PlaybackPosition;
  busy: boolean;
  seek(timeUs: number): void;
  setSelection(ids: string[]): void;
  setSelected(id: string | undefined): void;
  preview: RefObject<PreviewControls | null>;
  onError(error: unknown): void;
  refresh(): Promise<void>;
}
export default function WebMCPBridge(props: Props) {
  const { editor, project, route } = props;
  useWebMCP(
    editor &&
      project &&
      route.screen === 'editor' &&
      route.projectId === project.id
      ? {
          editor,
          projectId: project.id,
          getView: () => ({
            project,
            version: props.version,
            selectedClipIds: props.selectedClipIds,
            playheadUs: props.position.getSnapshot(),
            busy: props.busy,
          }),
          seek: props.seek,
          select: (ids) => {
            props.setSelection(ids);
            props.setSelected(ids[0]);
          },
          playback: (action) => {
            if (!props.preview.current)
              throw new Error('Open the Editor tab for playback.');
            props.preview.current[action]();
          },
          onError: props.onError,
          refresh: props.refresh,
        }
      : null,
    props.version?.id ?? 'current',
  );
  return null;
}

/** Unsupported browsers and bare startup never import schemas or open storage. */
export function useWebMCP(host: SiteToolHost | null, viewKey: string) {
  const latest = useRef(host);
  useLayoutEffect(() => {
    latest.current = host;
  });
  const editor = host?.editor;
  const projectId = host?.projectId;
  useLayoutEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool || !editor || !projectId) return;
    let closed = false;
    const href = window.location.href;
    const pending = import('./webmcp/register').then(
      ({ registerProjectTools }) => {
        if (closed) return;
        return registerProjectTools(context, {
          editor,
          projectId,
          getView: () =>
            !closed && href === window.location.href
              ? (latest.current?.getView() ?? null)
              : null,
          seek: (timeUs) => latest.current?.seek(timeUs),
          select: (clipIds) => latest.current?.select(clipIds),
          playback: (action) => latest.current?.playback(action),
          onError: (error) => latest.current?.onError(error),
          refresh: async () => {
            await latest.current?.refresh();
          },
        });
      },
    );
    void pending.catch((error: unknown) => {
      if (!closed) latest.current?.onError(error);
    });
    return () => {
      closed = true;
      void pending
        .then((registration) => registration?.dispose())
        .catch((error: unknown) => latest.current?.onError(error));
    };
  }, [editor, projectId, viewKey]);
}
