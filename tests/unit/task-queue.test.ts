import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskQueue } from '../../src/services/task-queue';
import type { TaskRecord } from '../../src/services/task-queue';
import type { TaskStorage } from '../../src/storage/tasks';

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
  return {
    request: async (
      name: string,
      _options: unknown,
      callback: (lock: unknown) => Promise<unknown>,
    ) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
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
  it('retries safe transient errors with bounded attempts, then escalates without leaking error bodies', async () => {
    const q = queue();
    let calls = 0;
    q.register('download', {
      lane: 'download',
      recovery: 'safe',
      maxAttempts: 3,
      retryCodes: ['MODEL_DOWNLOAD_FAILED'],
      execute: async () => {
        calls++;
        throw Object.assign(new Error('secret echoed body'), {
          code: 'MODEL_DOWNLOAD_FAILED',
        });
      },
    });
    const job = q.enqueue('download', {}, { label: 'Prepare' });
    await expect(job.completion).rejects.toMatchObject({
      code: 'MODEL_DOWNLOAD_FAILED',
    });
    const task = await q.get(job.id);
    expect(calls).toBe(3);
    expect(task).toMatchObject({ state: 'failed', attempts: 3 });
    expect(JSON.stringify(task)).not.toContain('secret');
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
  expect(JSON.stringify(task)).not.toMatch(
    /secret-token|private provider echo/,
  );
});
