import { asEditorError, EditorError } from '../core/errors';
export interface Progress {
  stage: string;
  progress?: number;
  detail?: string;
}
export interface JobEvent extends Progress {
  jobId: string;
  state: 'running' | 'completed' | 'cancelled' | 'failed';
  error?: { code: string; message: string };
}
export interface Job<T> {
  id: string;
  completion: Promise<T>;
  cancel(): void;
  subscribe(listener: (event: JobEvent) => void): () => void;
}
interface JobOptions<T> {
  /** Successful persisted commits are authoritative over a late cancellation. */
  acceptCommittedResult?: boolean;
  /** Release a produced resource when cancellation wins before delivery. */
  discard?: (result: T) => void | Promise<void>;
}
export class Jobs {
  private active = new Map<string, AbortController>();
  private listeners = new Set<(event: JobEvent) => void>();
  private disposed = false;
  private completions = new Set<Promise<unknown>>();
  subscribe(listener: (event: JobEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  start<T>(
    work: (
      signal: AbortSignal,
      progress: (event: Progress) => void,
      id: string,
    ) => Promise<T>,
    options: JobOptions<T> = {},
  ): Job<T> {
    if (this.disposed) throw new EditorError('DISPOSED', 'Engine disposed');
    const id = crypto.randomUUID(),
      controller = new AbortController(),
      listeners = new Set<(event: JobEvent) => void>();
    let latest: JobEvent = { jobId: id, state: 'running', stage: 'queued' };
    const emit = (event: JobEvent) => {
      latest = event;
      for (const l of [...listeners, ...this.listeners]) {
        try {
          l(event);
        } catch {
          /* Consumers cannot break jobs. */
        }
      }
    };
    this.active.set(id, controller);
    const completion = Promise.resolve()
      .then(() =>
        work(
          controller.signal,
          (e) => {
            if (!controller.signal.aborted)
              emit({ ...e, jobId: id, state: 'running' });
          },
          id,
        ),
      )
      .then(
        async (result) => {
          if (controller.signal.aborted && !options.acceptCommittedResult) {
            await options.discard?.(result);
            throw new EditorError('CANCELLED', 'Operation cancelled');
          }
          emit({
            jobId: id,
            state: 'completed',
            stage: 'completed',
            progress: 1,
          });
          return result;
        },
        (error) => {
          throw error;
        },
      )
      .catch((error) => {
        const e = controller.signal.aborted
          ? new EditorError('CANCELLED', 'Operation cancelled')
          : asEditorError(error);
        emit({
          jobId: id,
          state: e.code === 'CANCELLED' ? 'cancelled' : 'failed',
          stage: e.code === 'CANCELLED' ? 'cancelled' : 'failed',
          error: { code: e.code, message: e.message },
        });
        throw e;
      })
      .finally(() => this.active.delete(id));
    this.completions.add(completion);
    void completion
      .finally(() => this.completions.delete(completion))
      .catch(() => {});
    completion.catch(() => {});
    return {
      id,
      completion,
      cancel: () => controller.abort(),
      subscribe: (l) => {
        listeners.add(l);
        try {
          l(latest);
        } catch {
          /* Consumer isolation. */
        }
        return () => listeners.delete(l);
      },
    };
  }
  async dispose() {
    this.disposed = true;
    for (const c of this.active.values()) c.abort();
    await Promise.allSettled([...this.completions]);
    this.listeners.clear();
  }
}
export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new EditorError('CANCELLED', 'Operation cancelled');
}
