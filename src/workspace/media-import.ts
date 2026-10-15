import type { RefObject, Dispatch, SetStateAction } from 'react';
import type { Asset, Editor, Project } from '../editor';
import type { ImportBatch, ImportProgress } from './ImportProgressDialog';

export interface MediaImportState {
  visibleBatchId: string | null;
  placement: Promise<void>;
}

export interface MediaImportEditor {
  projects: Pick<Editor['projects'], 'create'>;
  assets: Pick<Editor['assets'], 'import'>;
  library: {
    forProject(
      projectId: string,
    ): Pick<ReturnType<Editor['library']['forProject']>, 'place'>;
  };
}

export interface MediaImportHost {
  busy: boolean;
  browsing: RefObject<boolean>;
  alive: RefObject<boolean>;
  lock: RefObject<boolean>;
  state: RefObject<MediaImportState>;
  setImportBatch: Dispatch<SetStateAction<ImportBatch | null>>;
  action(work: () => Promise<void>): Promise<boolean>;
  ensureEditor(): Promise<MediaImportEditor>;
  getProjectId(): string | null;
  openProject(project: Project): Promise<void>;
  refresh(): Promise<void>;
  error(failure: unknown): void;
  revealMedia(): void;
}

/** Coordinate one selection through engine-owned durable jobs and serialized placement.
 * Calls capture the initiating host view; shared refs remain live across later renders. */
export function createMediaImporter({
  busy,
  browsing,
  alive,
  lock,
  state,
  setImportBatch,
  action,
  ensureEditor,
  getProjectId,
  openProject,
  refresh,
  error,
  revealMedia,
}: MediaImportHost) {
  const importMedia = async (
    files: File[],
    targetFolderId: string | null = null,
    directories: string[] = [],
  ) => {
    if (
      (!files.length && !directories.length) ||
      browsing.current ||
      busy ||
      lock.current
    )
      return false;
    const batchId = crypto.randomUUID();
    let added = 0;
    let skipped = 0;
    let engine: MediaImportEditor | undefined;
    let targetProjectId: string | undefined;
    const jobs: {
      index: number;
      stop: () => void;
      result: Promise<{ asset: Asset } | { failure: unknown }>;
    }[] = [];
    const updateBatch = (update: (batch: ImportBatch) => ImportBatch) => {
      if (alive.current)
        setImportBatch((batch) =>
          batch?.id === batchId ? update(batch) : batch,
        );
    };
    const updateFile = (index: number, patch: Partial<ImportProgress>) => {
      updateBatch((batch) => ({
        ...batch,
        files: batch.files.map((file, position) =>
          position === index ? { ...file, ...patch } : file,
        ),
      }));
    };
    const started = await action(async () => {
      targetProjectId = getProjectId() ?? undefined;
      const { uploadSkipReason } = await import('./folder-upload-reader');
      skipped = files.filter((file) => uploadSkipReason(file)).length;
      state.current.visibleBatchId = batchId;
      setImportBatch({
        id: batchId,
        running: true,
        files: files.map((file) => {
          const reason = uploadSkipReason(file);
          return {
            name: file.name,
            status: reason ? 'skipped' : 'queued',
            reason,
          };
        }),
      });
      engine = await ensureEditor();
      if (!targetProjectId) {
        const created = await engine.projects.create('Untitled project');
        targetProjectId = created.id;
        await openProject(created);
      }
      if (!targetProjectId) throw new Error('Open a project to import media.');
      for (const directory of directories)
        await engine.library
          .forProject(targetProjectId)
          .place(null, directory.split('/'), targetFolderId);
      if (directories.length && !files.length) await refresh();
      // Enqueue the entire selection before waiting. The engine owns scheduling,
      // persistence and cancellation; closing this dialog changes only view state.
      for (const [index, file] of files.entries()) {
        if (uploadSkipReason(file)) continue;
        const job = engine.assets.import(file);
        const stop = job.subscribe((event) => {
          if (event.state === 'running')
            updateFile(index, {
              status: event.stage === 'Queued' ? 'queued' : 'importing',
              fraction: event.progress,
            });
        });
        const result = job.completion.then(
          (asset) => ({ asset }),
          (failure: unknown) => {
            const cancelled =
              (failure as { code?: string })?.code === 'CANCELLED';
            updateFile(index, {
              status: cancelled ? 'cancelled' : 'failed',
              error: cancelled
                ? undefined
                : failure instanceof Error
                  ? failure.message
                  : 'Could not import this file.',
            });
            return { failure };
          },
        );
        jobs.push({ index, stop, result });
      }
    });
    if (!started) {
      updateBatch((batch) => ({
        ...batch,
        running: false,
        files: batch.files.map((file) => ({
          ...file,
          status: 'failed',
          error: 'Import could not start.',
        })),
      }));
      for (const job of jobs) job.stop();
      return false;
    }
    try {
      for (const { index, ...job } of jobs) {
        const result = await job.result;
        if ('failure' in result) {
          if (
            alive.current &&
            (result.failure as { code?: string })?.code !== 'CANCELLED'
          )
            error(result.failure);
          continue;
        }
        // Serialize placements across batches, using the initiating project even
        // if the user edits or navigates while media jobs run in the background.
        let committed = false;
        const placement = state.current.placement.then(async () => {
          if (!alive.current) return;
          const relative = files[index]!.webkitRelativePath;
          await engine!.library
            .forProject(targetProjectId!)
            .place(
              result.asset.id,
              relative ? relative.split('/').slice(0, -1) : [],
              targetFolderId,
            );
          added++;
          committed = true;
          updateFile(index, { status: 'completed', fraction: 1 });
          if (getProjectId() !== targetProjectId || browsing.current) return;
          await refresh();
          if (getProjectId() !== targetProjectId || browsing.current) return;
          if (state.current.visibleBatchId !== batchId) return;
          revealMedia();
        });
        state.current.placement = placement.catch(() => {});
        try {
          await placement;
        } catch (failure) {
          if (!committed)
            updateFile(index, {
              status: 'failed',
              error:
                failure instanceof Error
                  ? failure.message
                  : 'Could not add this asset.',
            });
          if (alive.current) error(failure);
        }
      }
    } finally {
      for (const job of jobs) job.stop();
      updateBatch((batch) => ({ ...batch, running: false }));
    }
    return added + skipped === files.length;
  };
  return importMedia;
}
