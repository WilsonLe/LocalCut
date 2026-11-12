import { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset, Editor, Job } from '../editor';
import type { AssetIndexRun } from '../core/asset-index';
import { showErrorToast } from './error-toast';

export interface AssetIndexState {
  running: boolean;
  stage: string;
  progress?: number;
  result?: { scenes: number; frames: number; audioWindows: number };
  error?: string;
}
const resultSummary = (run: AssetIndexRun) => ({
  scenes: run.analysis.scenes.length,
  frames: run.analysis.frames.length,
  audioWindows: run.analysis.audio?.length ?? 0,
});
const newScope = (editor: Editor | null, projectId: string | undefined) => ({
  editor,
  projectId,
  jobs: new Map<string, { job: Job<AssetIndexRun>; stop: () => void }>(),
  versions: new Map<string, number>(),
});

/** UI subscriptions are disposable; submitted work belongs to the durable queue. */
export function useAssetIndexing(
  editor: Editor | null,
  projectId: string | undefined,
) {
  const current = useRef<ReturnType<typeof newScope> | null>(null);
  const [state, setState] = useState<{
    scope: ReturnType<typeof newScope> | null;
    items: Record<string, AssetIndexState>;
  }>({ scope: null, items: {} });
  const publish = useCallback(
    (
      scope: ReturnType<typeof newScope>,
      id: string,
      value: AssetIndexState,
    ) => {
      if (current.current !== scope) return;
      setState((previous) => ({
        scope,
        items: {
          ...(previous.scope === scope ? previous.items : {}),
          [id]: value,
        },
      }));
    },
    [],
  );
  useEffect(() => {
    const scope = newScope(editor, projectId);
    current.current = scope;
    return () => {
      if (current.current === scope) current.current = null;
      for (const item of scope.jobs.values()) item.stop();
    };
  }, [editor, projectId]);
  const inspect = useCallback(
    async (assetId: string) => {
      const scope = current.current;
      if (
        !editor ||
        !scope ||
        scope.editor !== editor ||
        scope.projectId !== projectId ||
        scope.jobs.has(assetId)
      )
        return;
      const version = scope.versions.get(assetId);
      try {
        const runs = await editor.assets.indexes.list(assetId);
        if (
          current.current !== scope ||
          scope.jobs.has(assetId) ||
          scope.versions.get(assetId) !== version
        )
          return;
        const latest = runs
          .filter(
            (run) =>
              !run.invalidated && ['analyzed', 'complete'].includes(run.status),
          )
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (latest)
          publish(scope, assetId, {
            running: false,
            stage: 'Indexed',
            result: resultSummary(latest),
          });
      } catch (error) {
        if (current.current === scope)
          showErrorToast(error, 'Could not read the saved index.');
      }
    },
    [editor, projectId, publish],
  );
  const start = async (asset: Asset) => {
    const scope = current.current;
    if (
      !editor ||
      !scope ||
      scope.editor !== editor ||
      scope.projectId !== projectId ||
      asset.status !== 'ready' ||
      scope.jobs.has(asset.id)
    )
      return;
    scope.versions.set(asset.id, (scope.versions.get(asset.id) ?? 0) + 1);
    let stop = () => {};
    try {
      const job = editor.assets.analyze(asset.id);
      scope.jobs.set(asset.id, { job, stop: () => stop() });
      publish(scope, asset.id, { running: true, stage: 'Indexing…' });
      stop = job.subscribe((event) => {
        if (event.state === 'running')
          publish(scope, asset.id, {
            running: true,
            stage: event.stage,
            ...(event.progress === undefined
              ? {}
              : { progress: event.progress }),
          });
      });
      const run = await job.completion;
      publish(scope, asset.id, {
        running: false,
        stage: 'Indexed',
        result: resultSummary(run),
      });
    } catch (error) {
      const cancelled =
        !!error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'CANCELLED';
      publish(scope, asset.id, {
        running: false,
        stage: cancelled ? 'Indexing cancelled' : 'Indexing failed',
        ...(!cancelled
          ? {
              error:
                error instanceof Error
                  ? error.message
                  : 'Could not index this asset.',
            }
          : {}),
      });
      if (!cancelled && current.current === scope)
        showErrorToast(error, 'Could not index this asset.');
    } finally {
      stop();
      scope.jobs.delete(asset.id);
    }
  };
  return {
    states:
      state.scope?.editor === editor && state.scope?.projectId === projectId
        ? state.items
        : {},
    start,
    inspect,
    cancel: (assetId: string) =>
      current.current?.jobs.get(assetId)?.job.cancel(),
  };
}
