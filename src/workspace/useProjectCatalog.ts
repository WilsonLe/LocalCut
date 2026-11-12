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
      // An empty first visit can show the catalog without creating editing storage.
      if (
        !editor &&
        typeof indexedDB.databases === 'function' &&
        !(await indexedDB.databases()).some(
          (database) => database.name === 'localcut-v1',
        )
      ) {
        if (token === generation.current) {
          writeProjectCatalogCache([]);
          update({ projects: [], loaded: true });
        }
        return;
      }
      const engine = await getEditor();
      const entries = await engine.projects.catalog();
      const projects = entries.map((entry) => {
        const clip = entry.project.tracks
          .flatMap((track) => track.clips)
          .find(
            (clip) =>
              clip.assetId && (clip.kind === 'video' || clip.kind === 'image'),
          );
        return {
          ...summarizeProjects([entry.project])[0]!,
          archived: entry.archived,
          revision: entry.project.revision,
          catalogRevision: entry.revision,
          thumbnail: entry.thumbnail,
          thumbnailPosition: entry.thumbnailPosition,
          ...(clip?.assetId
            ? {
                thumbnailSource: {
                  assetId: clip.assetId,
                  timeUs: clip.sourceInUs,
                },
              }
            : {}),
        };
      });
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
  }, [editor, getEditor, onError]);
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
  const rename = useCallback(
    async (project: ProjectSummary, name: string) => {
      try {
        const engine = await getEditor();
        if (project.revision === undefined)
          throw new Error('Project details are loading. Try again.');
        await engine.commands.apply({
          projectId: project.id,
          requestId: crypto.randomUUID(),
          expectedRevision: project.revision,
          operations: [{ type: 'renameProject', name }],
        });
        await refresh();
      } catch (error) {
        await refresh();
        throw error;
      }
    },
    [getEditor, refresh],
  );
  const updateDetails = useCallback(
    async (
      project: ProjectSummary,
      patch: import('../storage/store').ProjectCatalogPatch,
    ) => {
      try {
        const engine = await getEditor();
        if (project.catalogRevision === undefined)
          throw new Error('Project details are loading. Try again.');
        await engine.projects.updateCatalog(
          project.id,
          project.catalogRevision,
          patch,
        );
        await refresh();
      } catch (error) {
        await refresh();
        throw error;
      }
    },
    [getEditor, refresh],
  );
  return { ...state, refresh, rename, updateDetails };
}
