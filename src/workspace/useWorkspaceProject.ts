import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { RefObject } from 'react';
import type { Asset, Editor, Project } from '../editor';

interface ProjectState {
  project: Project | null;
  assets: Asset[];
}
const emptyState: ProjectState = { project: null, assets: [] };

export async function readWorkspaceProject(engine: Editor, id: string) {
  const project = await engine.projects.snapshot(id);
  const ids = [
    ...new Set(
      project.tracks.flatMap((track) =>
        track.clips.flatMap((clip) => (clip.assetId ? [clip.assetId] : [])),
      ),
    ),
  ];
  const assets = await Promise.all(ids.map((id) => engine.assets.inspect(id)));
  return { project, assets };
}

/** A snapshot of the engine document and its assets publishes atomically. */
export function useWorkspaceProject(editor: RefObject<Editor | null>) {
  const [state, publish] = useReducer(
    (_previous: ProjectState, next: ProjectState) => next,
    emptyState,
  );
  const projectId = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const activate = useCallback((next: ProjectState) => {
    generation.current++;
    projectId.current = next.project?.id ?? null;
    publish(next);
  }, []);
  const getProjectId = useCallback(() => projectId.current, []);
  const clear = useCallback(() => activate(emptyState), [activate]);
  const refresh = useCallback(async () => {
    const id = projectId.current;
    const engine = editor.current;
    const token = ++generation.current;
    if (!id || !engine) return;
    const next = await readWorkspaceProject(engine, id);
    if (token !== generation.current || id !== projectId.current) return;
    publish(next);
    return next.project;
  }, [editor]);
  return { ...state, getProjectId, activate, clear, refresh };
}
