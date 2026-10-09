import { resampleAt } from '../core/resample';
import { Store } from '../storage/store';
import type { Renderer } from '../media/composition';
import type { ExportOptions } from '../media/export';
import type { Project } from '../core/model';
import { asEditorError } from '../core/errors';
import { checkAbort } from '../services/jobs';
import type { Progress } from '../services/jobs';
interface Payload {
  namespace: string;
  file: Blob;
  name: string;
  jobId: string;
  assetId: string;
  project: Project;
  timeUs: number;
  width?: number;
  height?: number;
  timesUs: number[];
  bins?: number;
  kind: 'pcm' | 'proxy';
  options: ExportOptions;
  startFrame: number;
  count: number;
  relinkId?: string;
}
interface Request {
  id: string;
  operation: string;
  payload: Payload;
}
const controllers = new Map<string, AbortController>();
let queue: Promise<void> = Promise.resolve();
let preview: Renderer | undefined;
self.onmessage = ({ data }: MessageEvent<Request>) => {
  if (data.operation === 'cancel') {
    controllers.get(data.id)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(data.id, controller);
  const execute = async () => {
    let store: Store | undefined;
    let result: unknown;
    const progress = (p: Progress) =>
      self.postMessage({ id: data.id, kind: 'progress', data: p });
    try {
      checkAbort(controller.signal);
      const { importAsset, thumbnails, waveform, convertCache, pcmWindow } =
        await import('../media/assets');
      const { Renderer } = await import('../media/composition');
      const { exportProject, preflight } = await import('../media/export');
      checkAbort(controller.signal);
      const p = data.payload;
      store = await Store.open(p.namespace, false);
      let transfer: Transferable[] = [];
      switch (data.operation) {
        case 'import':
          result = await importAsset(
            store,
            p.file,
            p.name,
            controller.signal,
            progress,
            p.jobId,
            p.relinkId,
          );
          break;
        case 'thumbnail':
          result = await thumbnails(
            store,
            p.assetId,
            p.timesUs,
            controller.signal,
            p.width,
          );
          break;
        case 'waveform':
          result = await waveform(
            store,
            p.assetId,
            controller.signal,
            progress,
            p.jobId,
            p.bins,
          );
          break;
        case 'derivative':
          result = await convertCache(
            store,
            p.assetId,
            p.kind,
            controller.signal,
            progress,
            p.jobId,
          );
          break;
        case 'preflight':
          result = await preflight(p.project, p.options);
          break;
        case 'export':
          result = await exportProject(
            store,
            p.project,
            p.options,
            controller.signal,
            progress,
            p.jobId,
          );
          break;
        case 'frame':
        case 'audio': {
          if (
            !preview ||
            preview.project.id !== p.project.id ||
            preview.project.revision !== p.project.revision ||
            preview.store.namespace !== p.namespace ||
            preview.canvas.width !== (p.width ?? p.project.width) ||
            preview.canvas.height !== (p.height ?? p.project.height)
          ) {
            preview?.dispose();
            preview?.store.close();
            preview = new Renderer(store, p.project, p.width, p.height);
            store = undefined;
          }
          if (data.operation === 'frame') {
            const canvas = await preview.frame(p.timeUs, controller.signal),
              image = canvas.transferToImageBitmap();
            result = { timeUs: p.timeUs, image, revision: p.project.revision };
            transfer = [image];
          } else {
            await preview.prepareAudio(controller.signal, progress);
            result = await preview.audio(
              p.startFrame,
              p.count,
              controller.signal,
            );
          }
          break;
        }
        case 'speechAudio': {
          const file = await convertCache(
              store,
              p.assetId,
              'pcm',
              controller.signal,
              progress,
              p.jobId,
            ),
            asset = await store.getAsset(p.assetId);
          const start = p.startFrame ?? 0,
            count = p.count ?? Math.ceil((asset.durationUs * 16000) / 1e6);
          const audio = new Float32Array(count);
          for (let offset = 0; offset < count; offset += 16000) {
            checkAbort(controller.signal);
            const amount = Math.min(16000, count - offset),
              channels = await pcmWindow(
                file,
                (start + offset) * 3 - 32,
                amount * 3 + 64,
              );
            for (let i = 0; i < amount; i++)
              audio[offset + i] =
                (resampleAt(channels[0]!, i * 3 + 32, 3) +
                  resampleAt(channels[1]!, i * 3 + 32, 3)) /
                2;
            await new Promise((r) => setTimeout(r, 0));
          }
          result = audio;
          transfer = [audio.buffer];
          break;
        }
        default:
          throw new Error('Unknown worker operation');
      }
      // An import's atomic commit is its publication point. Late cancellation
      // must not turn a successfully committed original into an unclaimed asset.
      if (data.operation !== 'import') checkAbort(controller.signal);
      self.postMessage({ id: data.id, kind: 'result', data: result }, transfer);
    } catch (error) {
      if (result && typeof result === 'object') {
        if ('image' in result && result.image instanceof ImageBitmap)
          result.image.close();
        if (
          data.operation === 'export' &&
          'path' in result &&
          typeof result.path === 'string'
        )
          await store?.remove(result.path);
      }
      if (data.operation === 'frame' || data.operation === 'audio') {
        preview?.dispose();
        preview?.store.close();
        preview = undefined;
      }
      const e = asEditorError(error);
      self.postMessage({
        id: data.id,
        kind: 'error',
        error: { code: e.code, message: e.message, details: e.details },
      });
    } finally {
      store?.close();
      controllers.delete(data.id);
    }
  };
  queue = queue.then(execute, execute);
};
