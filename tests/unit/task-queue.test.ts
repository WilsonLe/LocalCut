import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskQueue } from '../../src/services/task-queue';
import type { TaskRecord } from '../../src/services/task-queue';
import type { TaskStorage } from '../../src/storage/tasks';
import { pureTaskCache } from '../../src/services/task-cache';
import { transcriptionSegments } from '../../src/ai/transcription';
import { asEditorError } from '../../src/core/errors';
import { errorDiagnostic } from '../../src/core/error-diagnostics';

class MemoryStore implements TaskStorage {
  tasks = new Map<string, TaskRecord>();
  inputs = new Map<string, unknown>();
  results = new Map<string, unknown>();
  async list() {
    return structuredClone([...this.tasks.values()]);
  }
  async get(id: string) {
    return structuredClone(this.tasks.get(id));
  }
  async create(task: TaskRecord, input: unknown) {
    this.tasks.set(task.id, structuredClone(task));
    this.inputs.set(task.id, structuredClone(input));
  }
  async update(
    id: string,
    patch: Partial<TaskRecord> | ((current: TaskRecord) => Partial<TaskRecord>),
  ) {
    const next = {
      ...this.tasks.get(id)!,
      ...(typeof patch === 'function' ? patch(this.tasks.get(id)!) : patch),
      updatedAt: Date.now(),
    };
    this.tasks.set(id, structuredClone(next));
    return structuredClone(next);
  }
  async input(id: string) {
    return structuredClone(this.inputs.get(id));
  }
  async result(id: string) {
    return structuredClone(this.results.get(id));
  }
  async checkpoint(id: string, result: unknown) {
    this.results.set(id, structuredClone(result));
  }
  async complete(id: string, result: unknown) {
    await this.checkpoint(id, result);
    return this.update(id, {
      state: 'completed',
      stage: 'Completed',
      progress: 1,
      error: undefined,
    });
  }
  async remove(id: string) {
    this.tasks.delete(id);
    this.inputs.delete(id);
    this.results.delete(id);
  }
  async close() {}
}
function locks() {
  const held = new Set<string>();
  const released = new Map<string, Promise<void>>();
  return {
    request: async (
      name: string,
      options: { ifAvailable?: boolean; signal?: AbortSignal },
      callback: (lock: unknown) => Promise<unknown>,
    ) => {
      if (held.has(name) && options.ifAvailable) return callback(null);
      while (held.has(name)) await released.get(name);
      if (options.signal?.aborted)
        throw new DOMException('Aborted', 'AbortError');
      let release!: () => void;
      released.set(
        name,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
        release();
      }
    },
  } as Pick<LockManager, 'request'>;
}
const queues: TaskQueue[] = [];
const queue = (storage = new MemoryStore(), lock = locks()) => {
  const result = new TaskQueue('test-queue', {
    storage,
    locks: lock,
    pollMs: 10,
    retryDelayMs: 5,
  });
  queues.push(result);
  return result;
};
const wait = async (predicate: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Task did not settle');
};
afterEach(async () => {
  await Promise.all(queues.splice(0).map((queue) => queue.dispose()));
  vi.restoreAllMocks();
});
describe('durable task queue', () => {
  it('retains original error messages, causes and every frame through nested measurement/generation queues and reopening', async () => {
    const storage = new MemoryStore(),
      q = queue(storage);
    q.register('measurement-diagnostic', {
      cache: pureTaskCache('measurement-v1'),
      lane: 'transcription',
      recovery: 'manual',
      execute: async () => {
        try {
          transcriptionSegments(
            { segments: [{ text: 'private transcript', start: 2, end: 1 }] },
            3,
          );
        } catch (error) {
          (error as Error).cause = new Error(
            'Provider rejected segment 17\nBearer test-credential',
          );
          (error as Error).stack =
            'AiError: STT returned invalid or unordered timestamps.\n' +
            Array.from(
              { length: 200 },
              (_, i) => `    at frame${i} (ai.js:${i}:1)`,
            ).join('\n');
          throw asEditorError(error);
        }
      },
    });
    q.register('speech-diagnostic', {
      cache: pureTaskCache('speech-v1'),
      lane: 'speech',
      recovery: 'manual',
      execute: async () =>
        q.enqueue('measurement-diagnostic', {}, { label: 'Measure speech' })
          .completion,
    });
    const job = q.enqueue(
      'speech-diagnostic',
      {},
      { label: 'Generating speech' },
    );
    await expect(job.completion).rejects.toMatchObject({
      code: 'WORKER_FAILED',
      message: 'STT returned invalid or unordered timestamps.',
    });
    const saved = await q.get(job.id);
    let validation = saved?.error?.diagnostic;
    while (validation && validation.code !== 'INVALID_RESPONSE')
      validation = validation.cause;
    expect(validation?.message).toBe(
      'STT returned invalid or unordered timestamps.',
    );
    expect(JSON.stringify(saved?.error?.diagnostic)).toContain(
      'STT returned invalid or unordered timestamps.',
    );
    expect(JSON.stringify(saved?.error?.diagnostic)).toContain(
      'INVALID_RESPONSE',
    );
    expect(JSON.stringify(saved?.error?.diagnostic)).toContain('frame199');
    expect(JSON.stringify(saved)).toContain('Provider rejected segment 17');
    expect(JSON.stringify(saved)).not.toMatch(
      /private transcript|test-credential/,
    );
    const restored = await queue(storage).get(job.id);
    expect(restored?.error?.diagnostic?.stack).toContain(
      'STT returned invalid or unordered timestamps.',
    );
    const reserialized = errorDiagnostic(restored?.error?.diagnostic);
    expect(JSON.stringify(reserialized)).toContain(
      'STT returned invalid or unordered timestamps.',
    );
    expect(JSON.stringify(reserialized)).toContain('frame199');
    expect(JSON.stringify(reserialized)).toContain(
      'Provider rejected segment 17',
    );
    expect(JSON.stringify(reserialized)).not.toContain('test-credential');
    const failure = await job.completion.catch((error: unknown) => error);
    const report = errorDiagnostic(failure);
    expect(JSON.stringify(report)).toContain(
      'STT returned invalid or unordered timestamps.',
    );
    expect(JSON.stringify(report)).toContain('frame199');
    expect(JSON.stringify(report)).toContain('Provider rejected segment 17');
    expect(JSON.stringify(report)).not.toContain('test-credential');
  });
  it('isolates reusable cache values from public result reads, retry completion and retained handler objects', async () => {
    const storage = new MemoryStore(),
      q = queue(storage);
    const produced = { samples: new Float32Array([0.25]) };
    let calls = 0;
    q.register('pure', {
      cache: pureTaskCache('v1'),
      lane: 'local',
      recovery: 'safe',
      execute: async () => {
        if (++calls === 1) throw new Error('Retry needed');
        return produced;
      },
    });
    const failed = q.enqueue('pure', {}, { label: 'Initial' });
    await failed.completion.catch(() => {});
    const retry = await q.retry(failed.id);
    const retried = (await retry.completion) as typeof produced;
    retried.samples[0] = 0.75;
    const exposed = await q.result<typeof produced>(failed.id);
    expect([...exposed.samples]).toEqual([0.25]);
    exposed.samples[0] = 0.9;
    produced.samples[0] = 1;
    const repeat = await q.enqueue<typeof produced>(
      'pure',
      {},
      { label: 'Reusable hit' },
    ).completion;
    expect([...repeat.samples]).toEqual([0.25]);
    expect([
      ...((await storage.result(failed.id)) as typeof produced).samples,
    ]).toEqual([0.25]);
    expect(calls).toBe(2);
    expect(await q.list()).toHaveLength(1);
  });
  it('falls through a stale memory claim to newer work admitted by another owner', async () => {
    const storage = new MemoryStore(),
      lock = locks(),
      first = queue(storage, lock),
      second = queue(storage, lock);
    let calls = 0,
      release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = {
      cache: pureTaskCache('v1'),
      lane: 'local',
      recovery: 'safe' as const,
      execute: async (
        _input: unknown,
        context: { progress: (event: { stage: string }) => void },
      ) => {
        if (++calls === 1) throw new Error('Initial failure');
        context.progress({ stage: 'Held' });
        await held;
        return 'shared';
      },
    };
    first.register('pure', handler);
    second.register('pure', handler);
    await first
      .enqueue('pure', {}, { label: 'Failed' })
      .completion.catch(() => {});
    const newer = second.enqueue('pure', {}, { label: 'Other owner' });
    await wait(async () => (await second.get(newer.id))?.stage === 'Held');
    const joined = first.enqueue('pure', {}, { label: 'Stale index owner' });
    let stage = '';
    joined.subscribe((event) => {
      stage = event.stage;
    });
    await wait(async () => stage === 'Held');
    expect(await first.list()).toHaveLength(2);
    release();
    expect(await Promise.all([newer.completion, joined.completion])).toEqual([
      'shared',
      'shared',
    ]);
    expect(calls).toBe(2);
  });
  it('does not execute or retry an old cache claim using a different algorithm version', async () => {
    const storage = new MemoryStore();
    await storage.create(
      {
        version: 1,
        id: 'obsolete',
        kind: 'pure',
        label: 'Old work',
        lane: 'pure',
        cacheKey: 'old-key',
        cacheVersion: 'v1',
        state: 'queued',
        stage: 'Queued',
        attempts: 0,
        maxAttempts: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {},
    );
    const q = queue(storage);
    const execute = vi.fn(async () => 'wrong version');
    q.register('pure', {
      cache: pureTaskCache('v2'),
      lane: 'pure',
      recovery: 'safe',
      execute,
    });
    q.start();
    await wait(async () => (await q.get('obsolete'))?.state === 'interrupted');
    expect(execute).not.toHaveBeenCalled();
    expect(await q.canRetry('obsolete')).toBe(false);
    await expect(q.retry('obsolete')).rejects.toThrow();
    expect(
      await q.enqueue('pure', {}, { label: 'New version' }).completion,
    ).toBe('wrong version');
  });
  it('rebuilds a completed queue entry whose persisted result is missing', async () => {
    const storage = new MemoryStore(),
      lock = locks();
    let calls = 0;
    const handler = {
      cache: pureTaskCache('v1'),
      lane: 'pure',
      recovery: 'safe' as const,
      execute: async () => ++calls,
    };
    const first = queue(storage, lock);
    first.register('pure', handler);
    const job = first.enqueue('pure', {}, { label: 'Initial' });
    expect(await job.completion).toBe(1);
    await first.dispose();
    storage.results.delete(job.id);
    const second = queue(storage, lock);
    second.register('pure', handler);
    expect(
      await second.enqueue('pure', {}, { label: 'Repair' }).completion,
    ).toBe(2);
    expect(await second.list()).toHaveLength(2);
  });
  it('checks result caches before admission and writes computed caches before completion', async () => {
    const storage = new MemoryStore(),
      q = queue(storage);
    let cached: unknown,
      executions = 0;
    const key = vi.fn(async () => 'request');
    q.register('cached', {
      cache: {
        ...pureTaskCache('v1'),
        mode: 'reuse',
        version: 'v1',
        reuseCompleted: true,
        key,
        read: async () =>
          cached === undefined ? undefined : { value: cached },
        write: async (_input, result) => {
          cached = result;
          expect([...storage.tasks.values()][0]?.state).toBe('running');
        },
      },
      lane: 'media',
      recovery: 'safe',
      execute: async () => {
        executions++;
        return { pixels: [1, 2] };
      },
    });
    const first = await q.enqueue('cached', {}, { label: 'First' }).completion;
    expect(first).toEqual({ pixels: [1, 2] });
    expect(storage.tasks.size).toBe(1);
    key.mockClear();
    const hit = q.enqueue('cached', {}, { label: 'Again' });
    expect(await hit.completion).toEqual(first);
    expect(await q.get(hit.id)).toBeUndefined();
    expect(storage.tasks.size).toBe(1);
    expect(executions).toBe(1);
    expect(key).not.toHaveBeenCalled();
  });

  it('shares matching work across queue owners and consumer cancellation only detaches', async () => {
    const storage = new MemoryStore(),
      lock = locks(),
      first = queue(storage, lock),
      second = queue(storage, lock);
    let executions = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = {
      cache: pureTaskCache('shared-v1'),
      lane: 'media',
      recovery: 'safe' as const,
      execute: async () => {
        executions++;
        await barrier;
        return new Float32Array([0.5]);
      },
    };
    first.register('shared', handler);
    second.register('shared', handler);
    const a = first.enqueue(
      'shared',
      { samples: new Uint8Array([1, 2]) },
      { label: 'A' },
    );
    const b = second.enqueue<Float32Array>(
      'shared',
      { samples: new Uint8Array([1, 2]) },
      { label: 'B' },
    );
    await wait(async () => executions === 1 && storage.tasks.size === 1);
    a.cancel();
    await expect(a.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    expect([...storage.tasks.values()][0]?.cancelRequested).not.toBe(true);
    release();
    expect([...(await b.completion)]).toEqual([0.5]);
    expect(executions).toBe(1);
    expect(storage.tasks.size).toBe(1);
  });

  it('reuses completed pure results across a fresh queue while version and inputs invalidate', async () => {
    const storage = new MemoryStore(),
      lock = locks(),
      a = queue(storage, lock);
    let executions = 0;
    const handler = {
      cache: pureTaskCache('v1'),
      lane: 'pure',
      recovery: 'safe' as const,
      execute: async () => {
        executions++;
        return { samples: new Float32Array([0.25]) };
      },
    };
    a.register('pure', handler);
    const first = await a.enqueue<{ samples: Float32Array }>(
      'pure',
      { bytes: new Uint8Array([1]), option: 1 },
      { label: 'First' },
    ).completion;
    first.samples[0] = 0.9;
    await a.dispose();
    const b = queue(storage, lock);
    b.register('pure', handler);
    const replay = await b.enqueue<{ samples: Float32Array }>(
      'pure',
      { option: 1, bytes: new Uint8Array([1]) },
      { label: 'Replay' },
    ).completion;
    expect([...replay.samples]).toEqual([0.25]);
    expect(executions).toBe(1);
    await b.enqueue(
      'pure',
      { bytes: new Uint8Array([2]), option: 1 },
      { label: 'Changed bytes' },
    ).completion;
    b.register('pure', { ...handler, cache: pureTaskCache('v2') });
    await b.enqueue(
      'pure',
      { bytes: new Uint8Array([1]), option: 1 },
      { label: 'Changed version' },
    ).completion;
    expect(executions).toBe(3);
    expect(storage.tasks.size).toBe(3);
  });

  it('commits one admission claim before a matching request can create another task', async () => {
    const storage = new MemoryStore(),
      original = storage.create.bind(storage);
    let unblock!: () => void,
      creates = 0,
      executions = 0;
    const writing = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    storage.create = async (task, input) => {
      creates++;
      await writing;
      await original(task, input);
    };
    const q = queue(storage);
    q.register('pure', {
      cache: pureTaskCache('v1'),
      lane: 'pure',
      recovery: 'safe',
      execute: async () => {
        executions++;
        return 42;
      },
    });
    const a = q.enqueue('pure', {}, { label: 'A' }),
      b = q.enqueue('pure', {}, { label: 'B' });
    await wait(async () => creates === 1);
    expect(storage.tasks.size).toBe(0);
    expect(executions).toBe(0);
    unblock();
    expect(await Promise.all([a.completion, b.completion])).toEqual([42, 42]);
    expect(creates).toBe(1);
    expect(executions).toBe(1);
    expect([...storage.tasks.values()][0]?.cacheKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not resurrect owner artifacts from completed queue results after eviction', async () => {
    const q = queue();
    let executions = 0;
    const cache = pureTaskCache('v1');
    q.register('artifact', {
      cache: {
        ...cache,
        mode: 'reuse',
        version: 'v1',
        key: async () => 'source',
        reuseCompleted: false,
        read: async () => undefined,
      },
      lane: 'media',
      recovery: 'safe',
      execute: async () => ++executions,
    });
    expect(await q.enqueue('artifact', {}, { label: 'A' }).completion).toBe(1);
    expect(await q.enqueue('artifact', {}, { label: 'B' }).completion).toBe(2);
  });

  it('recomputes failed reusable tasks and respects explicit global cancellation and removal', async () => {
    const q = queue();
    let executions = 0;
    q.register('pure', {
      cache: pureTaskCache('v1'),
      lane: 'pure',
      recovery: 'safe',
      execute: async () => {
        if (++executions === 1) throw new Error('Failure');
        return 7;
      },
    });
    await expect(
      q.enqueue('pure', {}, { label: 'Failure' }).completion,
    ).rejects.toBeDefined();
    const successful = q.enqueue('pure', {}, { label: 'Retry new request' });
    expect(await successful.completion).toBe(7);
    await q.remove(successful.id);
    expect(await q.enqueue('pure', {}, { label: 'Removed' }).completion).toBe(
      7,
    );
    expect(executions).toBe(3);
    q.register('long', {
      cache: pureTaskCache('v1'),
      lane: 'long',
      recovery: 'safe',
      execute: async (_input, context) =>
        new Promise((_resolve, reject) =>
          context.signal.addEventListener(
            'abort',
            () =>
              reject(
                Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }),
              ),
            { once: true },
          ),
        ),
    });
    const job = q.enqueue('long', {}, { label: 'Cancel globally' });
    await wait(async () => (await q.get(job.id))?.state === 'running');
    await q.cancel(job.id);
    await expect(job.completion).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('rejects reusable policies for session authority or committed/disposable side effects', () => {
    const q = queue();
    for (const guard of [
      { sessionBound: true },
      { acceptCommittedResult: true },
      { discard: async () => {} },
    ])
      expect(() =>
        q.register('invalid', {
          ...guard,
          cache: pureTaskCache('v1'),
          lane: 'x',
          recovery: 'safe',
          execute: async () => 1,
        }),
      ).toThrow(/local computations/);
  });
  it('keeps a facade job ID when a cache miss enters durable scheduling', async () => {
    const q = queue();
    q.register('thumbnail', {
      lane: 'derivatives',
      recovery: 'safe',
      execute: async () => 'pixels',
    });
    const id = crypto.randomUUID();
    const job = q.enqueue('thumbnail', {}, { id, label: 'Thumbnail' });
    expect(job.id).toBe(id);
    await expect(job.completion).resolves.toBe('pixels');
    expect(await q.result(id)).toBe('pixels');
    expect((await q.get(id))?.state).toBe('completed');
  });
  it('cancels a navigation-interrupted request without retaining its network error', async () => {
    const q = queue();
    let started = false;
    q.register('chat', {
      lane: 'chat',
      recovery: 'manual',
      execute: async (_input, task) => {
        started = true;
        return new Promise((_resolve, reject) => {
          task.signal.addEventListener(
            'abort',
            () => {
              reject(
                Object.assign(new Error('connection lost'), {
                  code: 'NETWORK_ERROR',
                }),
              );
            },
            { once: true },
          );
        });
      },
    });
    const job = q.enqueue('chat', {}, { label: 'Assistant response' });
    await wait(async () => started);
    job.cancel();
    await expect(job.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(await q.get(job.id)).toMatchObject({
      state: 'cancelled',
      error: undefined,
    });
    await q.poll();
    expect((await q.list())[0]?.error).toBeUndefined();
  });
  it('cancels while encoding a saved artifact and discards its native output', async () => {
    const q = queue();
    let release!: () => void;
    const discard = vi.fn();
    q.register('export', {
      lane: 'export',
      recovery: 'manual',
      execute: async () => ({ output: 'temporary' }),
      encodeResult: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { output: 'saved' };
      },
      discard,
    });
    const job = q.enqueue('export', {}, { label: 'Export' });
    await wait(async () => !!release);
    job.cancel();
    release();
    await expect(job.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    expect((await q.get(job.id))?.state).toBe('cancelled');
    expect(discard).toHaveBeenCalledWith({ output: 'temporary' });
  });
  it('polls progress/results and serializes a lane across tabs', async () => {
    const storage = new MemoryStore(),
      lock = locks(),
      first = queue(storage, lock),
      second = queue(storage, lock);
    let release!: () => void,
      calls = 0,
      active = 0,
      peak = 0;
    const execute = async (
      input: unknown,
      context: {
        progress: (event: { stage: string; progress: number }) => void;
      },
    ) => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      context.progress({ stage: 'Working', progress: 0.5 });
      if (input === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      active--;
      return { value: input };
    };
    for (const q of [first, second])
      q.register('local', { lane: 'local', recovery: 'safe', execute });
    const a = first.enqueue<{ value: number }>('local', 1, { label: 'One' });
    const b = first.enqueue<{ value: number }>('local', 2, { label: 'Two' });
    second.start();
    await wait(async () => !!release);
    await first.poll();
    await second.poll();
    expect((await second.get(a.id))?.state).toBe('running');
    expect((await second.get(b.id))?.state).toBe('queued');
    release();
    expect(await a.completion).toEqual({ value: 1 });
    expect(await b.completion).toEqual({ value: 2 });
    expect(calls).toBe(2);
    expect(peak).toBe(1);
    expect(await second.result(b.id)).toEqual({ value: 2 });
  });
  it('retries safe transient errors with bounded attempts, then retains the original failure while redacting credentials', async () => {
    const q = queue();
    let calls = 0;
    q.register('download', {
      lane: 'download',
      recovery: 'safe',
      maxAttempts: 3,
      retryCodes: ['MODEL_DOWNLOAD_FAILED'],
      execute: async () => {
        calls++;
        throw Object.assign(
          new Error('Download rejected: Bearer test-credential'),
          {
            code: 'MODEL_DOWNLOAD_FAILED',
          },
        );
      },
    });
    const job = q.enqueue('download', {}, { label: 'Prepare' });
    await expect(job.completion).rejects.toMatchObject({
      code: 'MODEL_DOWNLOAD_FAILED',
    });
    const task = await q.get(job.id);
    expect(calls).toBe(3);
    expect(task).toMatchObject({ state: 'failed', attempts: 3 });
    expect(task?.error?.diagnostic?.message).toBe(
      'Download rejected: [REDACTED]',
    );
    expect(JSON.stringify(task)).not.toContain('test-credential');
    expect(task?.error?.action).toContain('retry');
  });
  it('requires explicit retry for uncertain remote outcomes and reuses saved checkpoints', async () => {
    const storage = new MemoryStore(),
      q = queue(storage);
    let calls = 0;
    q.register('speech', {
      lane: 'speech',
      recovery: 'manual',
      maxAttempts: 1,
      execute: async (_input, context) => {
        calls++;
        const cached = await q.checkpoint(context.id);
        if (!cached) {
          await q.saveCheckpoint(context.id, { audio: 'saved take' });
          throw Object.assign(new Error('render failed'), {
            code: 'INVALID_REQUEST',
          });
        }
        return cached;
      },
    });
    const job = q.enqueue('speech', { voice: 'Kore' }, { label: 'Speech' });
    await expect(job.completion).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await q.poll();
    expect(calls).toBe(1);
    const retried = await q.retry(job.id);
    expect(await retried.completion).toEqual({ audio: 'saved take' });
    expect(calls).toBe(2);
    expect((await q.get(job.id))?.attempts).toBe(1);
  });
  it('recovers abandoned safe work but escalates interrupted submissions without replay', async () => {
    const storage = new MemoryStore(),
      q = queue(storage);
    let remoteCalls = 0;
    const task = (id: string, kind: string): TaskRecord => ({
      version: 1,
      id,
      kind,
      label: kind,
      lane: kind,
      state: 'running',
      stage: 'Working',
      attempts: 1,
      maxAttempts: 3,
      createdAt: 1,
      updatedAt: 1,
    });
    await storage.create(task('safe', 'local'), { value: 42 });
    await storage.create(task('remote', 'remote'), {});
    q.register('local', {
      lane: 'local',
      recovery: 'safe',
      execute: async (input) => input,
    });
    q.register('remote', {
      lane: 'remote',
      recovery: 'manual',
      execute: async () => {
        remoteCalls++;
        return 'audio';
      },
    });
    q.start();
    await wait(async () => (await q.get('safe'))?.state === 'completed');
    expect(await q.result('safe')).toEqual({ value: 42 });
    expect(await q.get('remote')).toMatchObject({
      state: 'interrupted',
      error: { code: 'INTERRUPTED' },
    });
    expect(remoteCalls).toBe(0);
    expect(await q.canRetry('remote')).toBe(true);
  });
  it('cancels queued work before it executes and retains committed results after late cancellation', async () => {
    const q = queue();
    let calls = 0;
    q.register('local', {
      lane: 'local',
      recovery: 'manual',
      acceptCommittedResult: true,
      execute: async (_input, context) => {
        calls++;
        await q.cancel(context.id);
        return { committed: true };
      },
    });
    const committed = q.enqueue('local', {}, { label: 'Commit' });
    expect(await committed.completion).toEqual({ committed: true });
    expect((await q.get(committed.id))?.state).toBe('completed');
    q.register('never', {
      lane: 'local',
      recovery: 'safe',
      execute: async () => {
        calls++;
        return 2;
      },
    });
    const cancelled = q.enqueue('never', {}, { label: 'Cancel' });
    cancelled.cancel();
    await expect(cancelled.completion).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(calls).toBe(1);
  });
  it('retires queued jobs on disposal instead of leaving their promises unresolved', async () => {
    const q = queue();
    q.register('local', {
      lane: 'local',
      recovery: 'manual',
      execute: async (_input, context) =>
        new Promise((_resolve, reject) => {
          const fail = () =>
            reject(Object.assign(new Error('stopped'), { code: 'CANCELLED' }));
          context.signal.addEventListener('abort', fail, { once: true });
          if (context.signal.aborted) fail();
        }),
    });
    const a = q.enqueue('local', {}, { label: 'A' }),
      b = q.enqueue('local', {}, { label: 'B' });
    await wait(async () => (await q.get(a.id))?.state === 'running');
    await q.dispose();
    await expect(a.completion).rejects.toMatchObject({ code: 'INTERRUPTED' });
    await expect(b.completion).rejects.toMatchObject({ code: 'INTERRUPTED' });
  });
});

it('protects live session-bound queued work and escalates abandoned queued sessions', async () => {
  const storage = new MemoryStore(),
    lock = locks(),
    owner = queue(storage, lock),
    observer = queue(storage, lock);
  let release!: () => void;
  owner.register('session', {
    lane: 'session',
    recovery: 'manual',
    sessionBound: true,
    execute: async () =>
      new Promise((resolve) => {
        release = () => resolve('done');
      }),
  });
  const first = owner.enqueue('session', {}, { label: 'First' });
  const second = owner.enqueue('session', {}, { label: 'Second' });
  await wait(async () => !!release);
  observer.start();
  await observer.poll();
  expect((await observer.get(second.id))?.state).toBe('queued');
  release();
  await first.completion;
  await wait(async () => (await owner.get(second.id))?.state === 'running');
  release();
  await second.completion;
  const record = (await owner.get(second.id))!;
  await storage.create(
    { ...record, id: 'abandoned', ownerId: 'missing-session', state: 'queued' },
    {},
  );
  await observer.poll();
  expect(await observer.get('abandoned')).toMatchObject({
    state: 'interrupted',
    error: { code: 'INTERRUPTED' },
  });
});

it('retains safe HTTP metadata for actionable endpoint errors and removes private details', async () => {
  const q = queue();
  q.register('remote', {
    lane: 'remote',
    recovery: 'manual',
    execute: async () => {
      throw Object.assign(new Error('private provider echo'), {
        code: 'INVALID_REQUEST',
        details: { status: 404, body: 'secret-token' },
      });
    },
  });
  const job = q.enqueue('remote', {}, { label: 'Endpoint error' });
  await expect(job.completion).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
    details: { status: 404 },
  });
  const task = await q.get(job.id);
  expect(task?.error?.details).toEqual({ status: 404 });
  expect(task?.error?.diagnostic?.message).toBe('private provider echo');
  expect(JSON.stringify(task)).not.toContain('secret-token');
});

it.each([
  ['RESPONSE_INCOMPLETE', 'output_limit', { reason: 'output_limit' }],
  ['RESPONSE_INCOMPLETE', 'empty_response', { reason: 'empty_response' }],
  ['RESPONSE_INCOMPLETE', 'secret-token', undefined],
  ['INVALID_REQUEST', 'output_limit', undefined],
])(
  'retains only known incomplete-response diagnostics for %s/%s',
  async (code, reason, expected) => {
    const q = queue();
    q.register('remote', {
      lane: 'remote',
      recovery: 'manual',
      execute: async () => {
        throw Object.assign(new Error('private provider echo'), {
          code,
          details: { reason, body: 'private-body-marker' },
        });
      },
    });
    const job = q.enqueue('remote', {}, { label: 'Response error' });
    await expect(job.completion).rejects.toMatchObject({
      code,
      details: expected,
    });
    const task = await q.get(job.id);
    expect(task?.error?.details).toEqual(expected);
    expect(task?.attempts).toBe(1);
    expect(task?.error?.diagnostic?.message).toBe('private provider echo');
    expect(JSON.stringify(task)).not.toContain('private-body-marker');
  },
);
