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
}

/** Own transport artifacts, never a second task queue or persisted job model. */
export class SiteToolJobs {
  private jobs = new Map<string, OwnedJob>();
  private closed = false;
  track<T>(
    job: Job<T>,
    encode: (
      value: T,
      file: (blob: Blob, name: string) => FileLink,
    ) => Promise<unknown> = async (value) => value,
    cleanup?: (value: T) => Promise<void>,
  ) {
    invariant(!this.closed, 'DISPOSED', 'Project tools closed');
    const row: OwnedJob = {
      job,
      event: { jobId: job.id, state: 'running', stage: 'queued' },
      files: [],
      settled: Promise.resolve(),
      unsubscribe: () => {},
      released: false,
    };
    this.jobs.set(job.id, row);
    row.unsubscribe = job.subscribe((event) => {
      row.event =
        event.state === 'completed'
          ? { ...event, state: 'running', stage: 'Preparing tool result' }
          : event;
    });
    row.settled = job.completion
      .then(async (value) => {
        row.cleanup = cleanup ? () => cleanup(value) : undefined;
        try {
          row.result = await encode(value, (blob, name) => {
            invariant(!row.released, 'DISPOSED', 'Project tools closed');
            const link = {
              url: URL.createObjectURL(blob),
              name,
              mimeType: blob.type,
              size: blob.size,
            };
            row.files.push({ blob, link });
            return link;
          });
          row.event = {
            jobId: job.id,
            state: 'completed',
            stage: 'completed',
            progress: 1,
          };
        } finally {
          if (row.released) await this.clean(row);
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
          stage: 'failed',
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
    if (action === 'cancel') row.job.cancel();
    if (action === 'release') {
      row.released = true;
      row.job.cancel();
      await row.settled;
      await this.clean(row);
      this.jobs.delete(id);
      return { jobId: id, released: true };
    }
    if (action === 'wait') {
      const abort = () => row.job.cancel();
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
  private async clean(row: OwnedJob) {
    for (const { link } of row.files.splice(0)) URL.revokeObjectURL(link.url);
    const cleanup = row.cleanup;
    row.cleanup = undefined;
    await cleanup?.();
  }
  async dispose() {
    this.closed = true;
    for (const row of this.jobs.values()) {
      row.released = true;
      row.job.cancel();
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
