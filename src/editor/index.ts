import { Store } from '../storage/store';
import { AssetIndexStore } from '../storage/asset-index';
import type {
  AssetIndexRun,
  IndexLabel,
  IndexRequestManifest,
} from '../core/asset-index';
export type * from '../core/asset-index';
import { Autosave } from '../services/autosave';
export type { ProjectVersion, ProjectVersionInfo } from '../storage/store';
import { Jobs, checkAbort } from '../services/jobs';
import { TaskQueue, runQueuedJob, taskTerminal } from '../services/task-queue';
import type { TaskHandler, TaskContext } from '../services/task-queue';
export { TaskQueue } from '../services/task-queue';
export type {
  TaskRecord,
  TaskState,
  TaskContext,
  TaskHandler,
  TaskQueueError,
} from '../services/task-queue';
import type { JobEvent } from '../services/jobs';
import { WorkerClient } from '../services/worker-client';
import { EditorError, invariant, asEditorError } from '../core/errors';
import { newProject, validateProject, assetIds } from '../core/model';
import type { Asset, Project, Transcript } from '../core/model';
import { applyOperations, parseBatch } from '../core/commands';
import { repairLegacyIdentities } from '../core/legacy-identities';
import type { CommandBatch } from '../core/commands';
import type { ExportOptions, ExportResult } from '../media/export';
import { modelStatus } from '../services/transcription-status';
import { createPreviewSession } from '../services/preview';
import type { FrameResult, PreviewSession } from '../services/preview';
export * from '../core/model';
export { rampPreset, averageSpeed, sourceDurationUs } from '../core/speed';
export type { SpeedPoint, SpeedRamp } from '../core/speed';
export { TEXT_FONTS, TEXT_TEMPLATES } from '../core/text-library';
export type {
  FontId,
  TextTemplate,
  TextStyleInput,
} from '../core/text-library';
export type {
  CommandBatch,
  EditOperation,
  EditReceipt,
} from '../core/commands';
export { importCaptions, exportCaptions } from '../core/captions';
export { EditorError } from '../core/errors';
export type { Job, JobEvent, Progress } from '../services/jobs';
export type { ExportOptions, ExportResult } from '../media/export';
export type { PreviewSession, FrameResult } from '../services/preview';
export { readWorkspaceArchive } from '../storage/workspace-transfer';
export type {
  WorkspaceArchive,
  WorkspaceBackup,
  WorkspaceSelection,
  WorkspaceSettings,
} from '../storage/workspace-transfer';
import type {
  WorkspaceArchive,
  WorkspaceSelection,
  WorkspaceSettings,
} from '../storage/workspace-transfer';
/** Per-job, consumer-owned route. Called only by an explicit transcription action. */
export type TranscriptionExecutor = (
  audio: Float32Array,
  context: {
    assetId: string;
    startUs: number;
    endUs: number;
    language?: string;
  },
  local: () => Promise<Transcript>,
  signal: AbortSignal,
) => Promise<Transcript>;
export interface EditorOptions {
  namespace?: string;
}
export interface ProjectImportOptions {
  repairLegacyIdentities?: boolean;
}
export interface VersionEvent {
  projectId: string;
  error?: unknown;
}
export interface ProjectEvent {
  projectId: string;
  revision?: number;
  type: 'changed' | 'deleted';
}
export async function createEditor(options: EditorOptions = {}) {
  const namespace = options.namespace ?? 'localcut',
    store = await Store.open(namespace),
    jobs = new Jobs(),
    tasks = new TaskQueue(namespace);
  let disposed = false;
  const sessions = new Set<PreviewSession>();
  const projectListeners = new Set<(event: ProjectEvent) => void>();
  const versionListeners = new Set<(event: VersionEvent) => void>();
  const versionNotify = (event: VersionEvent) => {
    for (const listener of versionListeners) {
      try {
        listener(event);
      } catch {
        /* Consumer isolation. */
      }
    }
  };
  const autosave = new Autosave(
    async (id) => {
      await store.saveVersion(id);
      versionNotify({ projectId: id });
    },
    (projectId, error) => versionNotify({ projectId, error }),
  );
  const broadcast = new BroadcastChannel(`${namespace}-projects`);
  const interactive = new WorkerClient(
    () =>
      new Worker(new URL('../workers/media.worker.ts', import.meta.url), {
        type: 'module',
      }),
  );
  const background = new WorkerClient(
    () =>
      new Worker(new URL('../workers/media.worker.ts', import.meta.url), {
        type: 'module',
      }),
  );
  const speech = new WorkerClient(
    () =>
      new Worker(
        new URL('../workers/transcription.worker.ts', import.meta.url),
        { type: 'module' },
      ),
  );
  const indexing = new WorkerClient(
    () =>
      new Worker(new URL('../workers/media.worker.ts', import.meta.url), {
        type: 'module',
      }),
  );
  const withIndexStore = async <T>(
    work: (index: AssetIndexStore) => Promise<T>,
  ) => {
    active();
    let index: AssetIndexStore | undefined;
    try {
      index = await AssetIndexStore.open(namespace);
      active();
      return await work(index);
    } catch (error) {
      throw asEditorError(error);
    } finally {
      index?.close();
    }
  };
  let speechQueue = Promise.resolve();
  const active = () => {
    invariant(!disposed, 'DISPOSED', 'Editor disposed');
  };
  const notify = (event: ProjectEvent, send = true) => {
    if (event.type === 'deleted') autosave.cancel(event.projectId);
    else autosave.schedule(event.projectId);
    for (const listener of projectListeners) {
      try {
        listener(event);
      } catch {
        /* Consumer isolation. */
      }
    }
    if (send) broadcast.postMessage(event);
  };
  broadcast.onmessage = ({ data }: MessageEvent<ProjectEvent>) =>
    notify(data, false);
  const run = <T>(client: WorkerClient, operation: string, payload: object) => {
    active();
    return jobs.start<T>(
      (signal, progress, jobId) =>
        client.run(
          operation,
          { ...payload, namespace, jobId },
          signal,
          progress,
        ),
      { acceptCommittedResult: operation === 'import' },
    );
  };
  const render = async (p: Project, t: number, signal: AbortSignal) =>
    interactive.run<FrameResult>(
      'frame',
      { namespace, project: p, timeUs: t },
      signal,
      () => {},
    );
  const mix = async (
    p: Project,
    start: number,
    count: number,
    signal: AbortSignal,
  ) =>
    interactive.run<Float32Array[]>(
      'audio',
      { namespace, project: p, startFrame: start, count },
      signal,
      () => {},
    );
  const speechRun = <T>(operation: string, payload: object) => {
    active();
    return jobs.start<T>((signal, progress) => {
      const execute = async () => {
        checkAbort(signal);
        const abort = () =>
          speech.reset(new EditorError('CANCELLED', 'Transcription cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        try {
          return await speech.run<T>(
            operation,
            { ...payload, namespace },
            signal,
            progress,
          );
        } finally {
          signal.removeEventListener('abort', abort);
        }
      };
      const completion = speechQueue.then(execute, execute);
      speechQueue = completion.then(
        () => {},
        () => {},
      );
      return completion;
    });
  };
  const queuedRawJobs = new Set<string>();
  const adoptQueuedJob = <T>(
    job: import('../services/jobs').Job<T>,
    context: TaskContext,
  ) => {
    queuedRawJobs.add(job.id);
    return runQueuedJob(job, context).finally(() =>
      queuedRawJobs.delete(job.id),
    );
  };
  const api = {
    tasks,
    workspace: {
      async snapshot(
        projectIds: string[],
        includeVersions = true,
        settings?: WorkspaceSettings,
      ) {
        active();
        const { snapshotWorkspace } =
          await import('../storage/workspace-transfer');
        return snapshotWorkspace(store, projectIds, includeVersions, settings);
      },
      export(selection: WorkspaceSelection, settings?: WorkspaceSettings) {
        active();
        return jobs.start(async (signal, progress) => {
          const { exportWorkspace } =
            await import('../storage/workspace-transfer');
          return exportWorkspace(store, selection, settings, signal, progress);
        });
      },
      import(archive: WorkspaceArchive, selection: WorkspaceSelection) {
        active();
        return jobs.start(
          async (signal, progress) => {
            const { restoreWorkspace } =
              await import('../storage/workspace-transfer');
            const projects = await restoreWorkspace(
              store,
              archive,
              selection,
              signal,
              progress,
            );
            for (const project of projects)
              notify({
                projectId: project.id,
                revision: project.revision,
                type: 'changed',
              });
            return projects;
          },
          { acceptCommittedResult: true },
        );
      },
    },
    projects: {
      async create(
        name: string,
        settings: Partial<Pick<Project, 'width' | 'height' | 'frameRate'>> = {},
      ) {
        active();
        const p = await store.create(newProject(name, settings));
        notify({ projectId: p.id, revision: p.revision, type: 'changed' });
        return p;
      },
      async list() {
        active();
        return store.list();
      },
      async open(id: string) {
        active();
        const project = await store.getProject(id);
        await autosave.flush(id);
        return project;
      },
      async snapshot(id: string) {
        active();
        return store.getProject(id);
      },
      versions: {
        async list(projectId: string) {
          active();
          return store.versions(projectId);
        },
        async snapshot(projectId: string, versionId: string) {
          active();
          return store.version(projectId, versionId);
        },
        async save(projectId: string) {
          active();
          await autosave.flush(projectId);
        },
        async restore(
          projectId: string,
          versionId: string,
          requestId: string,
          expectedRevision: number,
        ) {
          active();
          const receipt = await store.restoreVersion(
            projectId,
            versionId,
            requestId,
            expectedRevision,
          );
          notify({
            projectId,
            revision: receipt.appliedRevision,
            type: 'changed',
          });
          versionNotify({ projectId });
          return receipt;
        },
      },
      async delete(id: string) {
        active();
        await store.deleteProject(id);
        notify({ projectId: id, type: 'deleted' });
      },
      async exportJSON(id: string) {
        active();
        return JSON.stringify(await store.backup(id), null, 2);
      },
      async importJSON(text: string, options: ProjectImportOptions = {}) {
        active();
        invariant(
          options !== null &&
            typeof options === 'object' &&
            Object.keys(options).every(
              (key) => key === 'repairLegacyIdentities',
            ) &&
            (options.repairLegacyIdentities === undefined ||
              typeof options.repairLegacyIdentities === 'boolean'),
          'INVALID_DOCUMENT',
          'Invalid project import options',
        );
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          throw new EditorError('INVALID_DOCUMENT', 'Invalid project JSON');
        }
        let p: Project;
        if (value && typeof value === 'object' && 'backupVersion' in value)
          p = await store.restore(value, options.repairLegacyIdentities);
        else {
          if (options.repairLegacyIdentities)
            value = repairLegacyIdentities([value])[0];
          p = validateProject(value);
          p.id = crypto.randomUUID();
          p.revision = 0;
          p = await store.create(p);
        }
        notify({ projectId: p.id, revision: p.revision, type: 'changed' });
        return p;
      },
    },
    assets: {
      analyze(assetId: string, indexRunId?: string) {
        return run<AssetIndexRun>(indexing, 'analyzeAsset', {
          assetId,
          indexRunId,
        });
      },
      indexes: {
        list(assetId?: string) {
          return withIndexStore((index) => index.list(assetId));
        },
        get(runId: string) {
          return withIndexStore((index) => index.get(runId));
        },
        artifact(runId: string, artifactId: string) {
          return withIndexStore((index) => index.artifact(runId, artifactId));
        },
        remove(runId: string) {
          return withIndexStore((index) => index.remove(runId));
        },
        withRun<T>(runId: string, work: () => Promise<T>, signal: AbortSignal) {
          return withIndexStore((index) => index.active(runId, work, signal));
        },
        recordRequest(
          runId: string,
          manifest: IndexRequestManifest,
          signal: AbortSignal,
        ) {
          return withIndexStore((index) =>
            index.request(runId, manifest, signal),
          );
        },
        recordResponse(
          runId: string,
          requestId: string,
          response: string,
          label: IndexLabel | undefined,
          sceneId: string | undefined,
          model: string | undefined,
          usage: IndexRequestManifest['usage'],
          signal: AbortSignal,
        ) {
          return withIndexStore(async (index) => {
            const run = await index.get(runId),
              asset = await store.getAsset(run.assetId),
              file = await store.file(run.assetId);
            invariant(
              asset.status === 'ready' &&
                file.lastModified === run.source.lastModified &&
                file.size === run.source.size,
              'MISSING_ASSET',
              'Index source changed',
            );
            return index.response(
              runId,
              requestId,
              response,
              label,
              sceneId,
              model,
              usage,
              signal,
            );
          });
        },
        status(runId: string, status: 'failed' | 'cancelled', error: string) {
          return withIndexStore((index) =>
            index.update(runId, (r) => {
              r.status = status;
              r.error = error;
            }),
          );
        },
      },
      import(file: Blob, name = file instanceof File ? file.name : 'media') {
        return run<Asset>(background, 'import', { file, name });
      },
      async inspect(id: string) {
        active();
        return store.getAsset(id);
      },
      relink(
        assetId: string,
        file: Blob,
        name = file instanceof File ? file.name : 'media',
      ) {
        return run<Asset>(background, 'import', {
          file,
          name,
          relinkId: assetId,
        });
      },
      thumbnails(assetId: string, timesUs: number[], width = 320) {
        return run<{ timeUs: number; blob: Blob }[]>(background, 'thumbnail', {
          assetId,
          timesUs,
          width,
        });
      },
      contactSheet(assetId: string, timesUs: number[], width = 320) {
        active();
        return jobs.start(async (signal, progress, id) => {
          const items = await background.run<{ timeUs: number; blob: Blob }[]>(
            'thumbnail',
            { namespace, jobId: id, assetId, timesUs, width },
            signal,
            progress,
          );
          invariant(
            items.length,
            'INVALID_COMMAND',
            'Contact sheet needs timestamps',
          );
          const columns = Math.ceil(Math.sqrt(items.length)),
            images = await Promise.all(
              items.map((i) => createImageBitmap(i.blob)),
            );
          try {
            const canvas = new OffscreenCanvas(
                columns * width,
                Math.ceil(items.length / columns) * images[0]!.height,
              ),
              ctx = canvas.getContext('2d')!;
            for (let i = 0; i < images.length; i++) {
              checkAbort(signal);
              ctx.drawImage(
                images[i]!,
                (i % columns) * width,
                Math.floor(i / columns) * images[0]!.height,
              );
            }
            return {
              blob: await canvas.convertToBlob({ type: 'image/png' }),
              timesUs,
            };
          } finally {
            for (const image of images) image.close();
          }
        });
      },
      waveform(assetId: string, bins = 1000) {
        return run<Float32Array>(background, 'waveform', { assetId, bins });
      },
      derivative(assetId: string, kind: 'pcm' | 'proxy') {
        return run<File>(background, 'derivative', { assetId, kind });
      },
    },
    commands: {
      async validate(input: CommandBatch) {
        active();
        const batch = parseBatch(input),
          p = await store.getProject(batch.projectId);
        invariant(
          p.revision === batch.expectedRevision,
          'REVISION_CONFLICT',
          'Stale project revision',
        );
        const result = applyOperations(p, batch.operations);
        await store.validateAssets(result.project);
        return result;
      },
      async apply(input: CommandBatch) {
        active();
        const receipt = await store.apply(input);
        notify({
          projectId: receipt.projectId,
          revision: receipt.appliedRevision,
          type: 'changed',
        });
        return receipt;
      },
      async undo(
        projectId: string,
        requestId: string,
        expectedRevision: number,
      ) {
        active();
        const receipt = await store.history(
          projectId,
          requestId,
          expectedRevision,
          'undo',
        );
        notify({
          projectId,
          revision: receipt.appliedRevision,
          type: 'changed',
        });
        return receipt;
      },
      async redo(
        projectId: string,
        requestId: string,
        expectedRevision: number,
      ) {
        active();
        const receipt = await store.history(
          projectId,
          requestId,
          expectedRevision,
          'redo',
        );
        notify({
          projectId,
          revision: receipt.appliedRevision,
          type: 'changed',
        });
        return receipt;
      },
    },
    preview: {
      frame(
        projectId: string,
        timeUs: number,
        size?: { width: number; height: number },
        versionId?: string,
      ) {
        active();
        return jobs.start(
          async (signal, progress, id) => {
            invariant(
              Number.isSafeInteger(timeUs) && timeUs >= 0,
              'INVALID_COMMAND',
              'Invalid frame timestamp',
            );
            const p = versionId
              ? (await store.version(projectId, versionId)).project
              : await store.getProject(projectId);
            return interactive.run<FrameResult>(
              'frame',
              { namespace, jobId: id, project: p, timeUs, ...size },
              signal,
              progress,
            );
          },
          { discard: (result) => result.image.close() },
        );
      },
      session(
        projectId: string,
        canvas: HTMLCanvasElement,
        audioContext: AudioContext,
        versionId?: string,
      ) {
        active();
        const session = createPreviewSession(
          () =>
            versionId
              ? store.version(projectId, versionId).then((v) => v.project)
              : store.getProject(projectId),
          canvas,
          audioContext,
          render,
          mix,
        );
        sessions.add(session);
        return session;
      },
    },
    exports: {
      preflight(projectId: string, options: ExportOptions) {
        active();
        return jobs.start(async (signal, progress, id) =>
          background.run<
            Awaited<ReturnType<(typeof import('../media/export'))['preflight']>>
          >(
            'preflight',
            {
              namespace,
              jobId: id,
              project: await store.getProject(projectId),
              options,
            },
            signal,
            progress,
          ),
        );
      },
      start(projectId: string, options: ExportOptions) {
        active();
        return jobs.start(
          async (signal, progress, id) => {
            const p = await store.getProject(projectId);
            return store.lock('project-assets-' + p.id, 'shared', async () => {
              for (const assetId of assetIds(p)) await store.file(assetId);
              const result = await background.run<ExportResult>(
                'export',
                { namespace, jobId: id, project: p, options },
                signal,
                progress,
              );
              return { ...result, dispose: () => store.remove(result.path) };
            });
          },
          { discard: (result) => result.dispose() },
        );
      },
    },
    transcription: {
      async status() {
        active();
        return modelStatus(namespace);
      },
      prepare() {
        return speechRun<Awaited<ReturnType<typeof modelStatus>>>(
          'prepare',
          {},
        );
      },
      transcribe(
        assetId: string,
        options: {
          language?: string;
          startUs?: number;
          endUs?: number;
          provider?: TranscriptionExecutor;
        } = {},
      ) {
        active();
        options = { ...options };
        return jobs.start(
          async (signal, progress, id) => {
            const asset = await store.getAsset(assetId);
            invariant(
              asset.audioCodec,
              'UNSUPPORTED_CODEC',
              'Asset has no audio',
            );
            const startUs = options.startUs ?? 0,
              endUs = options.endUs ?? asset.durationUs;
            invariant(
              Number.isSafeInteger(startUs) &&
                Number.isSafeInteger(endUs) &&
                startUs >= 0 &&
                endUs > startUs &&
                endUs <= asset.durationUs,
              'INVALID_COMMAND',
              'Invalid transcription range',
            );
            if (!options.provider)
              invariant(
                (await modelStatus(namespace)).ready,
                'MODEL_REQUIRED',
                'Prepare transcription before inference',
              );
            const audio = await background.run<Float32Array>(
              'speechAudio',
              {
                namespace,
                jobId: id,
                assetId,
                startFrame: Math.round((startUs * 16000) / 1e6),
                count: Math.ceil(((endUs - startUs) * 16000) / 1e6),
              },
              signal,
              progress,
            );
            const local = async () => {
              invariant(
                (await modelStatus(namespace)).ready,
                'MODEL_REQUIRED',
                'Prepare transcription before inference',
              );
              const task = speechRun<Transcript>('transcribe', {
                audio,
                assetId,
                language: options.language,
                startUs,
                endUs,
              });
              const abort = () => task.cancel();
              signal.addEventListener('abort', abort, { once: true });
              const unsubscribe = task.subscribe((e) =>
                progress({ stage: e.stage, progress: e.progress }),
              );
              try {
                checkAbort(signal);
                return await task.completion;
              } finally {
                unsubscribe();
                signal.removeEventListener('abort', abort);
              }
            };
            checkAbort(signal);
            const transcript = options.provider
              ? await options.provider(
                  audio,
                  { assetId, startUs, endUs, language: options.language },
                  local,
                  signal,
                )
              : await local();
            checkAbort(signal);
            invariant(
              transcript.assetId === assetId &&
                transcript.cues.every(
                  (cue) => cue.timeUs >= startUs && cue.endUs <= endUs,
                ),
              'INVALID_DOCUMENT',
              'Transcription provider returned cues outside the requested source range',
            );
            await store.saveTranscript(transcript, signal);
            return transcript;
          },
          { acceptCommittedResult: true },
        );
      },
      async transcript(id: string) {
        active();
        return store.transcript(id);
      },
      async clearModelCache() {
        active();
        speech.reset();
        await caches.delete(`${namespace}-asr-v1`);
      },
    },
    events: {
      versions(listener: (event: VersionEvent) => void) {
        active();
        versionListeners.add(listener);
        return () => versionListeners.delete(listener);
      },
      jobs(listener: (event: JobEvent) => void) {
        active();
        const stopRaw = jobs.subscribe((event) => {
          if (!queuedRawJobs.has(event.jobId)) listener(event);
        });
        const stopTasks = tasks.subscribe((task) =>
          listener({
            jobId: task.id,
            stage: task.stage,
            progress: task.progress,
            error: task.error,
            state:
              task.state === 'completed'
                ? 'completed'
                : task.state === 'cancelled'
                  ? 'cancelled'
                  : taskTerminal(task.state)
                    ? 'failed'
                    : 'running',
          }),
        );
        return () => {
          stopRaw();
          stopTasks();
        };
      },
      projects(listener: (event: ProjectEvent) => void) {
        active();
        projectListeners.add(listener);
        return () => projectListeners.delete(listener);
      },
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const session of sessions) session.dispose();
      let saveError: unknown;
      try {
        await autosave.flushAll();
      } catch (error) {
        saveError = error;
      }
      await tasks.dispose();
      await jobs.dispose();
      interactive.reset();
      background.reset();
      speech.reset();
      indexing.reset();
      broadcast.close();
      projectListeners.clear();
      versionListeners.clear();
      store.close();
      if (saveError) throw saveError;
    },
  };
  // Public long-running operations share durable scheduling; internal preview and
  // transcription sub-jobs keep their dedicated workers and never queue behind themselves.
  const queued = <A extends unknown[], R>(
    kind: string,
    operation: (...args: A) => import('../services/jobs').Job<R>,
    policy: Partial<Omit<TaskHandler, 'execute'>> = {},
  ): ((...args: A) => import('../services/jobs').Job<R>) => {
    tasks.register(kind, {
      lane: 'media',
      recovery: 'safe',
      retryCodes: ['WORKER_FAILED'],
      ...policy,
      execute: (input, context) =>
        adoptQueuedJob(operation(...(input as A)), context),
    });
    return (...args) =>
      tasks.enqueue<R>(kind, args, { label: kind.replaceAll('.', ' ') });
  };
  api.assets.import = queued('media.import', api.assets.import, {
    recovery: 'manual',
    acceptCommittedResult: true,
    retryCodes: [],
  });
  api.assets.relink = queued('media.relink', api.assets.relink, {
    recovery: 'manual',
    acceptCommittedResult: true,
    retryCodes: [],
  });
  api.assets.analyze = queued('media.analyze', api.assets.analyze, {
    lane: 'index',
  });
  api.assets.thumbnails = queued('media.thumbnails', api.assets.thumbnails, {
    lane: 'derivatives',
  });
  api.assets.contactSheet = queued(
    'media.contactSheet',
    api.assets.contactSheet,
    { lane: 'derivatives' },
  );
  api.assets.waveform = queued('media.waveform', api.assets.waveform, {
    lane: 'derivatives',
  });
  api.assets.derivative = queued('media.derivative', api.assets.derivative, {
    lane: 'derivatives',
  });
  api.exports.preflight = queued('export.preflight', api.exports.preflight, {
    lane: 'export',
  });
  api.exports.start = queued('export.video', api.exports.start, {
    lane: 'export',
    recovery: 'manual',
    retryCodes: [],
    encodeResult: async (result) => {
      const saved = {
        ...(result as ExportResult & { dispose?: () => Promise<void> }),
      };
      delete saved.dispose;
      // Detach the durable take from the disposable OPFS export. Streaming into
      // a browser Blob avoids buffering a large export in a JS ArrayBuffer.
      const blob = await new Response(saved.file.stream()).blob();
      saved.file = new File([blob], saved.file.name, {
        type: saved.file.type,
        lastModified: saved.file.lastModified,
      });
      return saved;
    },
    decodeResult: (value) => {
      const result = value as ExportResult;
      return { ...result, dispose: () => store.remove(result.path) };
    },
    discard: (result) =>
      (result as ExportResult & { dispose: () => Promise<void> }).dispose(),
  });
  api.workspace.export = queued('workspace.export', api.workspace.export, {
    lane: 'transfer',
    recovery: 'manual',
    retryCodes: [],
  });
  api.workspace.import = queued('workspace.import', api.workspace.import, {
    lane: 'transfer',
    recovery: 'manual',
    acceptCommittedResult: true,
    retryCodes: [],
  });
  api.transcription.prepare = queued(
    'transcription.prepare',
    api.transcription.prepare,
    {
      lane: 'transcription',
      retryCodes: ['MODEL_DOWNLOAD_FAILED', 'WORKER_FAILED'],
    },
  );
  const transcribe = api.transcription.transcribe;
  const localTranscribe = queued('transcription.local', transcribe, {
    lane: 'transcription',
    recovery: 'manual',
    acceptCommittedResult: true,
    retryCodes: [],
  });
  api.transcription.transcribe = (assetId, options = {}) => {
    if (!options.provider) return localTranscribe(assetId, options);
    const kind = `transcription.remote:${crypto.randomUUID()}`;
    tasks.register(kind, {
      lane: 'transcription',
      recovery: 'manual',
      sessionBound: true,
      acceptCommittedResult: true,
      execute: (_input, context) =>
        adoptQueuedJob(transcribe(assetId, options), context),
    });
    const saved = { ...options };
    delete saved.provider;
    return tasks.enqueue<Transcript>(
      kind,
      { assetId, options: saved },
      { label: 'Transcribing audio' },
    );
  };
  tasks.register('speech.timing', {
    lane: 'speech-timing',
    recovery: 'safe',
    execute: async (input, context) => {
      const { renderSpeech } = await import('../ai/speech-audio');
      const value = input as {
        audio: import('../ai').SpeechAudio;
        timing: import('../ai').SpeechTiming;
      };
      return renderSpeech(value.audio, value.timing, context.signal);
    },
  });
  tasks.start();
  return api;
}
export type Editor = Awaited<ReturnType<typeof createEditor>>;
