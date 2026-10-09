import { Store } from '../storage/store';
import { Jobs, checkAbort } from '../services/jobs';
import type { JobEvent } from '../services/jobs';
import { WorkerClient } from '../services/worker-client';
import { EditorError, invariant } from '../core/errors';
import { newProject, validateProject, assetIds } from '../core/model';
import type { Asset, Project, Transcript } from '../core/model';
import { applyOperations, parseBatch } from '../core/commands';
import type { CommandBatch } from '../core/commands';
import type { ExportOptions, ExportResult } from '../media/export';
import { modelStatus } from '../services/transcription-status';
import { createPreviewSession } from '../services/preview';
import type { FrameResult, PreviewSession } from '../services/preview';
export * from '../core/model';
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
export interface EditorOptions {
  namespace?: string;
}
export interface ProjectEvent {
  projectId: string;
  revision?: number;
  type: 'changed' | 'deleted';
}
export async function createEditor(options: EditorOptions = {}) {
  const namespace = options.namespace ?? 'localcut',
    store = await Store.open(namespace),
    jobs = new Jobs();
  let disposed = false;
  const sessions = new Set<PreviewSession>();
  const projectListeners = new Set<(event: ProjectEvent) => void>();
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
  let speechQueue = Promise.resolve();
  const active = () => {
    invariant(!disposed, 'DISPOSED', 'Editor disposed');
  };
  const notify = (event: ProjectEvent, send = true) => {
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
    return jobs.start<T>((signal, progress, jobId) =>
      client.run(operation, { ...payload, namespace, jobId }, signal, progress),
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
  return {
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
        return store.getProject(id);
      },
      async snapshot(id: string) {
        active();
        return store.getProject(id);
      },
      async delete(id: string) {
        active();
        await store.deleteProject(id);
        notify({ projectId: id, type: 'deleted' });
      },
      async exportJSON(id: string) {
        active();
        return JSON.stringify(await store.getProject(id), null, 2);
      },
      async importJSON(text: string) {
        active();
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          throw new EditorError('INVALID_DOCUMENT', 'Invalid project JSON');
        }
        const p = validateProject(value);
        p.id = crypto.randomUUID();
        p.revision = 0;
        return store.create(p);
      },
    },
    assets: {
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
      ) {
        active();
        return jobs.start(async (signal, progress, id) => {
          invariant(
            Number.isSafeInteger(timeUs) && timeUs >= 0,
            'INVALID_COMMAND',
            'Invalid frame timestamp',
          );
          const p = await store.getProject(projectId);
          return interactive.run<FrameResult>(
            'frame',
            { namespace, jobId: id, project: p, timeUs, ...size },
            signal,
            progress,
          );
        });
      },
      session(
        projectId: string,
        canvas: HTMLCanvasElement,
        audioContext: AudioContext,
      ) {
        active();
        const session = createPreviewSession(
          () => store.getProject(projectId),
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
        return jobs.start(async (signal, progress, id) => {
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
        });
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
        options: { language?: string; startUs?: number; endUs?: number } = {},
      ) {
        active();
        return jobs.start(async (signal, progress, id) => {
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
          const task = speechRun<Transcript>('transcribe', {
            audio,
            assetId,
            language: options.language,
            startUs,
          });
          const abort = () => task.cancel();
          signal.addEventListener('abort', abort, { once: true });
          const unsubscribe = task.subscribe((e) =>
            progress({ stage: e.stage, progress: e.progress }),
          );
          try {
            checkAbort(signal);
            const transcript = await task.completion;
            checkAbort(signal);
            await store.saveTranscript(transcript);
            return transcript;
          } finally {
            unsubscribe();
            signal.removeEventListener('abort', abort);
          }
        });
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
      jobs(listener: (event: JobEvent) => void) {
        active();
        return jobs.subscribe(listener);
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
      await jobs.dispose();
      interactive.reset();
      background.reset();
      speech.reset();
      broadcast.close();
      projectListeners.clear();
      store.close();
    },
  };
}
export type Editor = Awaited<ReturnType<typeof createEditor>>;
