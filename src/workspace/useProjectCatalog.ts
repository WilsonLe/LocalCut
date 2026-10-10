import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Editor } from '../editor';
import {
  readProjectCatalogCache,
  summarizeProjects,
  writeProjectCatalogCache,
} from './project-catalog-cache';
import type { ProjectSummary } from './project-catalog-cache';

interface CatalogState {
  projects: ProjectSummary[];
  loaded: boolean;
  pending: boolean;
  failed: boolean;
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
    undefined,
    () => {
      const cached = readProjectCatalogCache();
      return {
        projects: cached ?? [],
        loaded: cached !== null,
        pending: false,
        failed: false,
      };
    },
  );
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    update({ pending: true, failed: false });
    try {
      const engine = await getEditor();
      const projects = summarizeProjects(await engine.projects.list());
      if (token === generation.current) {
        writeProjectCatalogCache(projects);
        update({ projects, loaded: true });
      }
    } catch (error) {
      if (token === generation.current) {
        update({ failed: true });
        onError(error);
      }
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
