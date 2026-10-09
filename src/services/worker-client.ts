import { EditorError } from '../core/errors';
import type { Progress } from './jobs';
interface Response {
  id: string;
  kind: 'progress' | 'result' | 'error';
  data?: unknown;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}
export class WorkerClient {
  private worker?: Worker;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
      progress: (event: Progress) => void;
      cleanup: () => void;
    }
  >();
  constructor(private factory: () => Worker) {}
  private getWorker() {
    if (this.worker) return this.worker;
    const worker = this.factory();
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<Response>) => {
      const task = this.pending.get(data.id);
      if (!task) {
        if (data.data instanceof ImageBitmap) data.data.close();
        else if (
          data.data &&
          typeof data.data === 'object' &&
          'image' in data.data &&
          data.data.image instanceof ImageBitmap
        )
          data.data.image.close();
        return;
      }
      if (data.kind === 'progress') task.progress(data.data as Progress);
      else {
        this.pending.delete(data.id);
        task.cleanup();
        if (data.kind === 'error')
          task.reject(
            new EditorError(
              (data.error?.code ?? 'WORKER_FAILED') as EditorError['code'],
              data.error?.message ?? 'Worker error',
              data.error?.details,
            ),
          );
        else task.resolve(data.data);
      }
    };
    worker.onerror = () =>
      this.reset(new EditorError('WORKER_FAILED', 'Worker crashed'));
    worker.onmessageerror = () =>
      this.reset(new EditorError('WORKER_FAILED', 'Invalid worker response'));
    return worker;
  }
  run<T>(
    operation: string,
    payload: unknown,
    signal: AbortSignal,
    progress: (event: Progress) => void,
    transfer: Transferable[] = [],
  ): Promise<T> {
    if (signal.aborted)
      return Promise.reject(
        new EditorError('CANCELLED', 'Operation cancelled'),
      );
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const worker = this.getWorker();
      const abort = () => {
        worker.postMessage({ id, operation: 'cancel' });
      };
      signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        progress,
        cleanup: () => signal.removeEventListener('abort', abort),
      });
      try {
        worker.postMessage({ id, operation, payload }, transfer);
      } catch (e) {
        this.pending.delete(id);
        signal.removeEventListener('abort', abort);
        reject(e);
      }
    });
  }
  reset(error = new EditorError('CANCELLED', 'Worker disposed')) {
    this.worker?.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) {
      p.cleanup();
      p.reject(error);
    }
    this.pending.clear();
  }
}
