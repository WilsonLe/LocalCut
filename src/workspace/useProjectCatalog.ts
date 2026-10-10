import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Editor, Project } from '../editor';

interface CatalogState {
  projects: Project[];
  loaded: boolean;
  pending: boolean;
}
export function useProjectCatalog(
  open: boolean,
  editor: Editor | null,
  getEditor: () => Promise<Editor>,
  onError: (error: unknown) => void,
) {
  const [state, update] = useReducer(
    (previous: CatalogState, patch: Partial<CatalogState>) => ({
      ...previous,
      ...patch,
    }),
    { projects: [], loaded: false, pending: false },
  );
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    update({ pending: true });
    try {
      const engine = await getEditor();
      const projects = await engine.projects.list();
      if (token === generation.current) update({ projects, loaded: true });
    } catch (error) {
      if (token === generation.current) onError(error);
    } finally {
      if (token === generation.current) update({ pending: false });
    }
  }, [getEditor, onError]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    if (!open) return;
    void refresh();
    return invalidate;
  }, [open, refresh, invalidate]);
  useEffect(() => {
    if (!open || !editor) return;
    const stop = editor.events.projects(() => {
      void refresh();
    });
    return () => {
      stop();
    };
  }, [open, editor, refresh]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  return { ...state, refresh };
}
