import type { Job, JobEvent } from '../../editor';
import { invariant } from '../../core/errors';
import { downloadFile } from '../helpers';

interface FileLink {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}
interface OwnedJob {
  job: Job<unknown>;
  event: JobEvent;
  result?: unknown;
  error?: { code: string; message: string };
  files: { blob: Blob; link: FileLink }[];
  cleanup?: () => Promise<void>;
  settled: Promise<void>;
  unsubscribe(): void;
  released: boolean;
  cancel(): void;
}
interface ResultOptions<T> {
  /** Engine publication wins cancellation for committed data by default. */
  publication?: 'engine' | 'disposable';
  encode?(
    value: T,
    file: (blob: Blob, name: string) => FileLink,
    signal: AbortSignal,
  ): Promise<unknown>;
  dispose?(value: T): void | Promise<void>;
}

/** Own transport artifacts, never a second task queue or persisted job model. */
export class SiteToolJobs {
  private jobs = new Map<string, OwnedJob>();
  private closed = false;
  track<T>(job: Job<T>, options: ResultOptions<T> = {}) {
    invariant(!this.closed, 'DISPOSED', 'Project tools closed');
    const controller = new AbortController();
    const encode = options.encode ?? (async (value: T) => value);
    const row: OwnedJob = {
      job,
      event: { jobId: job.id, state: 'running', stage: 'queued' },
      files: [],
      settled: Promise.resolve(),
      unsubscribe: () => {},
      released: false,
      cancel: () => {
        job.cancel();
        if (
          options.publication === 'disposable' &&
          row.event.state === 'running'
        ) {
          controller.abort();
          row.event = { jobId: job.id, state: 'cancelled', stage: 'cancelled' };
          row.result = undefined;
          this.revoke(row);
        }
      },
    };
    this.jobs.set(job.id, row);
    row.unsubscribe = job.subscribe((event) => {
      if (controller.signal.aborted) return;
      row.event =
        event.state === 'completed'
          ? { ...event, state: 'running', stage: 'Preparing tool result' }
          : event;
    });
    row.settled = job.completion
      .then(async (value) => {
        row.cleanup = options.dispose
          ? async () => {
              await options.dispose!(value);
            }
          : undefined;
        try {
          invariant(
            !controller.signal.aborted,
            'CANCELLED',
            'Operation cancelled',
          );
          const result = await encode(
            value,
            (blob, name) => {
              invariant(
                !controller.signal.aborted,
                'CANCELLED',
                'Operation cancelled',
              );
              invariant(!row.released, 'DISPOSED', 'Project tools closed');
              const link = {
                url: URL.createObjectURL(blob),
                name,
                mimeType: blob.type,
                size: blob.size,
              };
              row.files.push({ blob, link });
              return link;
            },
            controller.signal,
          );
          invariant(
            !controller.signal.aborted,
            'CANCELLED',
            'Operation cancelled',
          );
          row.result = result;
          row.event = {
            jobId: job.id,
            state: 'completed',
            stage: 'completed',
            progress: 1,
          };
        } finally {
          if (row.released || controller.signal.aborted) await this.clean(row);
        }
      })
      .catch((error: unknown) => {
        row.error = {
          code:
            error &&
            typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'string'
              ? error.code
              : 'WORKER_FAILED',
          message: error instanceof Error ? error.message : 'Job failed',
        };
        row.event = {
          jobId: job.id,
          state: row.error.code === 'CANCELLED' ? 'cancelled' : 'failed',
          stage: row.error.code === 'CANCELLED' ? 'cancelled' : 'failed',
        };
      })
      .finally(() => row.unsubscribe());
    return { jobId: job.id, state: 'running' };
  }
  async act(
    id: string,
    action: 'status' | 'wait' | 'cancel' | 'download' | 'release',
    signal: AbortSignal,
  ) {
    const row = this.jobs.get(id);
    invariant(
      row && !row.released,
      'NOT_FOUND',
      'Unknown job in this project view',
    );
    if (action === 'cancel') row.cancel();
    if (action === 'release') {
      row.released = true;
      row.cancel();
      await row.settled;
      await this.clean(row);
      this.jobs.delete(id);
      return { jobId: id, released: true };
    }
    if (action === 'wait') {
      const abort = () => row.cancel();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      try {
        await row.settled;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    }
    if (action === 'download') {
      invariant(
        row.event.state === 'completed' && row.files.length,
        'INVALID_COMMAND',
        'Wait for a downloadable result first',
      );
      signal.throwIfAborted();
      invariant(
        !row.released,
        'DISPOSED',
        'Project view closed before download',
      );
      for (const { blob, link } of row.files) downloadFile(blob, link.name);
    }
    return { ...row.event, result: row.result, error: row.error };
  }
  private revoke(row: OwnedJob) {
    for (const { link } of row.files.splice(0)) URL.revokeObjectURL(link.url);
  }
  private async clean(row: OwnedJob) {
    this.revoke(row);
    const cleanup = row.cleanup;
    row.cleanup = undefined;
    await cleanup?.();
  }
  async dispose() {
    this.closed = true;
    for (const row of this.jobs.values()) {
      row.released = true;
      row.cancel();
    }
    await Promise.all(
      [...this.jobs.values()].map(async (row) => {
        await row.settled;
        await this.clean(row);
      }),
    );
    this.jobs.clear();
  }
}
