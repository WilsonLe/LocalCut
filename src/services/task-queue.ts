import { TaskStore } from '../storage/tasks';
import type { TaskStorage } from '../storage/tasks';
import type { Job, JobEvent, Progress } from './jobs';

export type TaskState =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';
export interface TaskRecord {
  version: 1;
  id: string;
  kind: string;
  label: string;
  lane: string;
  projectId?: string;
  ownerId?: string;
  state: TaskState;
  stage: string;
  progress?: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt?: number;
  cancelRequested?: boolean;
  error?: {
    code: string;
    message: string;
    action: string;
    details?: { status: number };
  };
}
export interface TaskContext {
  id: string;
  signal: AbortSignal;
  progress(event: Progress): void;
}
export interface TaskHandler {
  execute(input: unknown, context: TaskContext): Promise<unknown>;
  lane: string;
  /** Safe local work can resume; network outcomes and non-idempotent commits cannot. */
  recovery: 'safe' | 'manual';
  sessionBound?: boolean;
  retryable?: boolean;
  retryCodes?: readonly string[];
  maxAttempts?: number;
  encodeResult?: (result: unknown) => unknown;
  decodeResult?: (result: unknown) => unknown;
  acceptCommittedResult?: boolean;
  discard?: (result: unknown) => Promise<void> | void;
}
export interface TaskQueueOptions {
  storage?: TaskStorage;
  locks?: Pick<LockManager, 'request'>;
  pollMs?: number;
  retryDelayMs?: number;
}
export const taskTerminal = (state: TaskState) =>
  ['completed', 'failed', 'interrupted', 'cancelled'].includes(state);
export type TaskQueueError = NonNullable<TaskRecord['error']>;
const knownCodes = new Set([
  'INVALID_DOCUMENT',
  'INVALID_COMMAND',
  'REVISION_CONFLICT',
  'REQUEST_CONFLICT',
  'NOT_FOUND',
  'MISSING_ASSET',
  'UNSUPPORTED_CODEC',
  'AMBIGUOUS_STREAM',
  'QUOTA_EXCEEDED',
  'CANCELLED',
  'WORKER_FAILED',
  'PLAYBACK_BLOCKED',
  'MODEL_REQUIRED',
  'MODEL_DOWNLOAD_FAILED',
  'DISPOSED',
  'AUTH_STORAGE',
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'AUTH_STORAGE_UNAVAILABLE',
  'AUTH_FLOW_INVALID',
  'AUTH_EXPIRED',
  'AUTH_CANCELLED',
  'INSUFFICIENT_CREDITS',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'NETWORK_ERROR',
  'TIMEOUT',
  'MODEL_UNSUPPORTED',
  'INVALID_REQUEST',
  'INVALID_RESPONSE',
  'RESPONSE_LIMIT',
  'RESPONSE_INCOMPLETE',
  'PROVIDER_REFUSAL',
  'BUSY',
  'PROPOSAL_NOT_FOUND',
  'PROPOSAL_DISCARDED',
  'CONTEXT_LIMIT',
  'TOOL_LIMIT',
  'TOOL_NOT_ALLOWED',
  'INVALID_TOOL_ARGUMENTS',
  'EDIT_REJECTED',
  'TASK_LOCK_UNAVAILABLE',
  'INTERRUPTED',
  'DICTATION_FAILED',
  'TASK_FAILED',
]);
const taskError = (error: unknown): TaskQueueError => {
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    knownCodes.has(error.code)
      ? error.code
      : error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'QUOTA_EXCEEDED'
        : 'TASK_FAILED';
  const action = code.startsWith('AUTH')
    ? 'Reconnect the configured provider, then retry.'
    : code === 'INSUFFICIENT_CREDITS'
      ? 'Add provider credits, then retry.'
      : code === 'QUOTA_EXCEEDED'
        ? 'Free browser storage, then retry.'
        : code === 'REVISION_CONFLICT'
          ? 'Review the current project and submit a new request.'
          : code === 'INTERRUPTED'
            ? 'The outcome is unknown. Review before retrying; provider charges may apply.'
            : 'Review the request and retry, or dismiss this task.';
  const status =
    error &&
    typeof error === 'object' &&
    'details' in error &&
    error.details &&
    typeof error.details === 'object' &&
    'status' in error.details
      ? error.details.status
      : undefined;
  // Preserve only bounded HTTP metadata; bodies and arbitrary details can contain secrets.
  return {
    ...(typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
      ? { details: { status } }
      : {}),
    code,
    message:
      code === 'INTERRUPTED'
        ? 'Task interrupted before its result was saved.'
        : `Task could not complete (${code}).`,
    action,
  };
};

/** Browser-owned durable task scheduler. Construction is inert; start is explicit. */
export class TaskQueue {
  private storage: TaskStorage;
  private locks?: Pick<LockManager, 'request'>;
  private handlers = new Map<string, TaskHandler>();
  private errorListeners = new Set<(error: TaskQueueError) => void>();
  private volatileFailures = new Map<string, TaskRecord>();
  private listeners = new Set<(task: TaskRecord) => void>();
  private active = new Map<string, AbortController>();
  private work = new Set<Promise<void>>();
  private lanes = new Set<string>();
  private results = new Map<string, unknown>();
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private disposal?: Promise<void>;
  private scanning = false;
  private scanDone?: Promise<void>;
  private ownerId = crypto.randomUUID();
  private ownerReady = false;
  private ownerWork?: Promise<unknown>;
  private releaseOwner?: () => void;
  private owned = new Set<string>();
  private pendingWrites = new Set<Promise<unknown>>();
  private lastSeen = new Map<string, string>();
  constructor(
    private namespace: string,
    private options: TaskQueueOptions = {},
  ) {
    this.storage = options.storage ?? new TaskStore(namespace);
    this.locks = options.locks ?? globalThis.navigator?.locks;
  }
  register(kind: string, handler: TaskHandler) {
    this.handlers.set(kind, handler);
    return () => {
      if (this.handlers.get(kind) === handler) this.handlers.delete(kind);
    };
  }
  start() {
    if (this.disposed || this.timer) return;
    if (this.locks && !this.ownerWork) {
      const lifetime = new Promise<void>((resolve) => {
        this.releaseOwner = resolve;
      });
      this.ownerWork = this.locks.request(
        `${this.namespace}-tasks-owner-${this.ownerId}`,
        {},
        async () => {
          this.ownerReady = true;
          void this.poll().catch((error) => this.reportError(error));
          await lifetime;
        },
      );
      void this.ownerWork.catch((error) => {
        this.ownerReady = true;
        this.reportError(error);
      });
    } else if (!this.locks) this.ownerReady = true;
    this.timer = setInterval(() => {
      void this.poll().catch((error) => this.reportError(error));
    }, this.options.pollMs ?? 500);
    void this.poll().catch((error) => this.reportError(error));
  }
  async list() {
    return (await this.storage.list())
      .map((task) => this.volatileFailures.get(task.id) ?? task)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  get(id: string) {
    return this.volatileFailures.has(id)
      ? Promise.resolve(this.volatileFailures.get(id))
      : this.storage.get(id);
  }
  checkpoint(id: string) {
    return this.storage.result(id);
  }
  saveCheckpoint(id: string, value: unknown) {
    return this.storage.checkpoint(id, value);
  }
  input(id: string) {
    return this.storage.input(id);
  }
  async result<T = unknown>(id: string): Promise<T> {
    const task = await this.get(id);
    if (task?.state !== 'completed')
      throw new Error('Task has no completed result.');
    if (this.results.has(id)) return this.results.get(id) as T;
    const saved = await this.storage.result(id);
    return (this.handlers.get(task.kind)?.decodeResult?.(saved) ?? saved) as T;
  }
  subscribeErrors(listener: (error: TaskQueueError) => void) {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }
  private reportError(error: unknown) {
    const safe = taskError(error);
    for (const listener of this.errorListeners) {
      try {
        listener(safe);
      } catch {
        /* isolation */
      }
    }
  }
  subscribe(listener: (task: TaskRecord) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(task: TaskRecord) {
    const signature = JSON.stringify(task);
    if (this.lastSeen.get(task.id) === signature) return;
    this.lastSeen.set(task.id, signature);
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(task));
      } catch {
        /* isolate consumers */
      }
    }
  }
  enqueue<T>(
    kind: string,
    input: unknown,
    options: { label: string; projectId?: string },
  ): Job<T> {
    if (this.disposed) throw new Error('Task queue disposed.');
    const handler = this.handlers.get(kind);
    if (!handler) throw new Error('No task handler is available.');
    const id = crypto.randomUUID(),
      now = Date.now();
    const task: TaskRecord = {
      version: 1,
      id,
      kind,
      label: options.label,
      projectId: options.projectId,
      lane: handler.lane,
      ownerId: handler.sessionBound ? this.ownerId : undefined,
      state: 'queued',
      stage: 'Queued',
      attempts: 0,
      maxAttempts: handler.maxAttempts ?? 3,
      createdAt: now,
      updatedAt: now,
    };
    this.owned.add(id);
    const saved = this.storage.create(task, structuredClone(input));
    this.pendingWrites.add(saved);
    void saved.finally(() => this.pendingWrites.delete(saved)).catch(() => {});
    this.start();
    const job = this.job<T>(id, saved);
    void saved
      .then(() => {
        this.publish(task);
        return this.poll();
      })
      .catch((error) => this.reportError(error));
    return job;
  }
  private job<T>(
    id: string,
    saved: Promise<unknown> = Promise.resolve(),
  ): Job<T> {
    const listeners = new Set<(event: JobEvent) => void>();
    let latest: JobEvent = { jobId: id, state: 'running', stage: 'Queued' };
    let settle!: (value: T) => void, reject!: (error: unknown) => void;
    let finished = false;
    const completion = new Promise<T>((resolve, fail) => {
      settle = resolve;
      reject = fail;
    });
    const unsubscribe = this.subscribe((task) => {
      if (task.id !== id || finished) return;
      const terminal = taskTerminal(task.state);
      latest = {
        jobId: id,
        state:
          task.state === 'completed'
            ? 'completed'
            : task.state === 'cancelled'
              ? 'cancelled'
              : terminal
                ? 'failed'
                : 'running',
        stage: task.stage,
        progress: task.progress,
        error: task.error,
      };
      for (const listener of listeners) {
        try {
          listener(latest);
        } catch {
          /* consumer isolation */
        }
      }
      if (!terminal) return;
      finished = true;
      unsubscribe();
      if (task.state === 'completed')
        void this.result<T>(id).then(settle, reject);
      else
        reject(
          Object.assign(
            new Error(task.error?.message ?? 'Operation cancelled'),
            {
              code: task.error?.code ?? 'CANCELLED',
              details: task.error?.details,
            },
          ),
        );
    });
    void saved.catch((error) => {
      finished = true;
      unsubscribe();
      reject(error);
    });
    completion.catch(() => {});
    return {
      id,
      completion,
      cancel: () => {
        this.active.get(id)?.abort();
        void saved.then(() => this.cancel(id)).catch(() => {});
      },
      subscribe: (listener) => {
        listeners.add(listener);
        try {
          listener(latest);
        } catch {
          /* isolation */
        }
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }
  async canRetry(id: string) {
    const task = await this.get(id);
    const handler =
      task &&
      (!task.ownerId || task.ownerId === this.ownerId) &&
      this.handlers.get(task.kind);
    return (
      !!task &&
      ['failed', 'interrupted', 'cancelled'].includes(task.state) &&
      !!handler &&
      handler.retryable !== false
    );
  }
  async retry(id: string) {
    const task = await this.get(id);
    if (!task || !['failed', 'interrupted', 'cancelled'].includes(task.state))
      throw new Error('Only stopped tasks can be retried.');
    if (
      (task.ownerId && task.ownerId !== this.ownerId) ||
      !this.handlers.has(task.kind) ||
      this.handlers.get(task.kind)?.retryable === false
    )
      throw new Error(
        'Reopen the owning workflow and reconnect before retrying this task.',
      );
    const job = this.job<unknown>(id);
    this.results.delete(id);
    this.publish(
      await this.storage.update(id, {
        state: 'queued',
        stage: 'Queued',
        attempts: 0,
        cancelRequested: false,
        nextAttemptAt: undefined,
        error: undefined,
      }),
    );
    this.volatileFailures.delete(id);
    this.start();
    void this.poll().catch((error) => this.reportError(error));
    return job;
  }
  async cancel(id: string) {
    this.active.get(id)?.abort();
    const task = await this.get(id);
    if (!task || taskTerminal(task.state)) return;
    const updated = await this.storage.update(id, (current) =>
      taskTerminal(current.state)
        ? {}
        : current.state === 'running'
          ? { cancelRequested: true }
          : { state: 'cancelled', stage: 'Cancelled', cancelRequested: true },
    );
    this.publish(updated);
    this.active.get(id)?.abort();
  }
  async remove(id: string) {
    const task = await this.get(id);
    if (task && !taskTerminal(task.state))
      throw new Error('Cancel a task before removing it.');
    if (task?.state === 'completed') {
      const handler = this.handlers.get(task.kind);
      if (handler?.discard) await handler.discard(await this.result(id));
    }
    await this.storage.remove(id);
    this.results.delete(id);
    this.volatileFailures.delete(id);
    this.lastSeen.delete(id);
  }
  private async lock(name: string, work: () => Promise<void>) {
    if (!this.locks)
      throw Object.assign(
        new Error('Web Locks are required for durable tasks.'),
        { code: 'TASK_LOCK_UNAVAILABLE' },
      );
    await this.locks.request(
      `${this.namespace}-tasks-${name}`,
      { ifAvailable: true },
      async (lock) => {
        if (lock) await work();
      },
    );
  }
  /** Public poll refreshes subscribers and schedules available queued work. */
  async poll() {
    if (this.disposed || this.scanning || !this.ownerReady) return;
    this.scanning = true;
    let finishScan!: () => void;
    this.scanDone = new Promise<void>((resolve) => {
      finishScan = resolve;
    });
    try {
      const tasks = await this.list();
      for (const task of tasks) {
        if (this.disposed) return;
        this.publish(task);
        if (task.cancelRequested) this.active.get(task.id)?.abort();
        if (this.active.has(task.id)) continue;
        const handler =
          task.ownerId && task.ownerId !== this.ownerId
            ? undefined
            : this.handlers.get(task.kind);
        if (!handler && task.ownerId && !taskTerminal(task.state)) {
          await this.lock(`owner-${task.ownerId}`, async () => {
            const current = await this.get(task.id);
            if (current && !taskTerminal(current.state))
              this.publish(
                await this.storage.update(task.id, {
                  state: 'interrupted',
                  stage: 'Needs attention',
                  error: taskError({ code: 'INTERRUPTED' }),
                }),
              );
          });
          continue;
        }
        if (task.state === 'running') {
          await this.lock(`task-${task.id}`, async () => {
            const current = await this.get(task.id);
            if (current?.state !== 'running') return;
            this.publish(
              await this.storage.update(
                task.id,
                current.cancelRequested
                  ? { state: 'cancelled', stage: 'Cancelled' }
                  : handler?.recovery === 'safe'
                    ? { state: 'queued', stage: 'Recovered', error: undefined }
                    : {
                        state: 'interrupted',
                        stage: 'Needs attention',
                        error: taskError({ code: 'INTERRUPTED' }),
                      },
              ),
            );
          });
          continue;
        }
        if (
          !handler ||
          !['queued', 'retrying'].includes(task.state) ||
          (task.nextAttemptAt ?? 0) > Date.now() ||
          this.lanes.has(handler.lane)
        )
          continue;
        this.lanes.add(handler.lane);
        const work = this.lock(`lane-${handler.lane}`, () =>
          this.lock(`task-${task.id}`, () => this.execute(task.id, handler)),
        )
          .catch(async (error) => {
            try {
              this.publish(
                await this.storage.update(task.id, {
                  state: 'failed',
                  stage: 'Needs attention',
                  error: taskError(error),
                }),
              );
            } catch (failure) {
              this.reportError(failure);
              const stopped = {
                ...task,
                state: 'failed' as const,
                stage: 'Needs attention',
                error: taskError(failure),
                updatedAt: Date.now(),
              };
              this.volatileFailures.set(task.id, stopped);
              this.publish(stopped);
            }
          })
          .finally(() => {
            this.lanes.delete(handler.lane);
            this.work.delete(work);
          });
        this.work.add(work);
      }
    } finally {
      this.scanning = false;
      finishScan();
    }
  }
  private async execute(id: string, handler: TaskHandler) {
    let task = await this.get(id);
    if (this.disposed || !task || !['queued', 'retrying'].includes(task.state))
      return;
    const controller = new AbortController();
    this.active.set(id, controller);
    task = await this.storage.update(id, (current) =>
      ['queued', 'retrying'].includes(current.state) && !current.cancelRequested
        ? {
            state: 'running',
            stage: 'Starting',
            attempts: current.attempts + 1,
            nextAttemptAt: undefined,
            error: undefined,
          }
        : {},
    );
    if (task.state !== 'running') {
      this.active.delete(id);
      return;
    }
    this.publish(task);
    let progressWrites = Promise.resolve();
    let lastProgressAt = 0,
      lastStage = '';
    const progress = (event: Progress) => {
      if (controller.signal.aborted) return;
      if (event.stage === lastStage && Date.now() - lastProgressAt < 100)
        return;
      lastStage = event.stage;
      lastProgressAt = Date.now();
      progressWrites = progressWrites
        .then(async () => {
          this.publish(
            await this.storage.update(id, {
              stage: event.stage,
              progress: event.progress,
            }),
          );
        })
        .catch((error) => this.reportError(error));
    };
    try {
      const result = await handler.execute(await this.storage.input(id), {
        id,
        signal: controller.signal,
        progress,
      });
      await progressWrites;
      let encoded: unknown;
      try {
        encoded = handler.encodeResult
          ? await handler.encodeResult(result)
          : result;
      } catch (error) {
        await handler.discard?.(result);
        throw error;
      }
      const current = await this.get(id);
      if (
        (controller.signal.aborted ||
          current?.cancelRequested ||
          this.disposed) &&
        !handler.acceptCommittedResult
      ) {
        await handler.discard?.(result);
        throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
      }
      // Encoded native artifacts are read from the durable blob, so a caller
      // disposing the original OPFS file cannot invalidate the saved result.
      if (!handler.encodeResult || !handler.decodeResult)
        this.results.set(id, result);
      this.publish(await this.storage.complete(id, encoded));
    } catch (error) {
      await progressWrites;
      const failure = taskError(error);
      const current = await this.get(id);
      const cancelled =
        (controller.signal.aborted ||
          current?.cancelRequested ||
          failure.code === 'CANCELLED') &&
        !this.disposed;
      const retry =
        !cancelled &&
        !this.disposed &&
        handler.retryCodes?.includes(failure.code) &&
        task.attempts < task.maxAttempts;
      const state: TaskState = cancelled
        ? 'cancelled'
        : this.disposed
          ? 'interrupted'
          : retry
            ? 'retrying'
            : 'failed';
      const retryAfter =
        error &&
        typeof error === 'object' &&
        'details' in error &&
        error.details &&
        typeof error.details === 'object' &&
        'retryAfterSeconds' in error.details &&
        typeof error.details.retryAfterSeconds === 'number' &&
        Number.isFinite(error.details.retryAfterSeconds)
          ? Math.max(0, Math.min(86400, error.details.retryAfterSeconds)) * 1000
          : 0;
      this.publish(
        await this.storage.update(id, {
          state,
          stage: retry
            ? 'Retry scheduled'
            : cancelled
              ? 'Cancelled'
              : 'Needs attention',
          error: this.disposed ? taskError({ code: 'INTERRUPTED' }) : failure,
          nextAttemptAt: retry
            ? Date.now() +
              Math.max(
                retryAfter,
                Math.min(
                  60_000,
                  (this.options.retryDelayMs ?? 1000) *
                    2 ** (task.attempts - 1),
                ),
              )
            : undefined,
        }),
      );
    } finally {
      this.active.delete(id);
    }
  }
  dispose() {
    return (this.disposal ??= this.retire());
  }
  private async retire() {
    this.disposed = true;
    clearInterval(this.timer);
    for (const controller of this.active.values()) controller.abort();
    await this.scanDone;
    await Promise.allSettled([...this.pendingWrites, ...this.work]);
    try {
      for (const id of this.owned) {
        const task = await this.get(id);
        if (task && !taskTerminal(task.state))
          this.publish(
            await this.storage.update(id, {
              state: 'interrupted',
              stage: 'Needs attention',
              error: taskError({ code: 'INTERRUPTED' }),
            }),
          );
      }
    } finally {
      this.releaseOwner?.();
      await this.ownerWork;
    }
    this.listeners.clear();
    this.errorListeners.clear();
    this.results.clear();
    await this.storage.close();
  }
}
/** Adopt a shared-engine job without changing its cancellation/publication contract. */
export async function runQueuedJob<T>(
  job: Job<T>,
  context: TaskContext,
): Promise<T> {
  const abort = () => job.cancel();
  context.signal.addEventListener('abort', abort, { once: true });
  if (context.signal.aborted) abort();
  const stop = job.subscribe(context.progress);
  try {
    return await job.completion;
  } finally {
    stop();
    context.signal.removeEventListener('abort', abort);
  }
}
