import { describe, it, expect } from 'vitest';
import { Jobs } from '../../src/services/jobs';
import { asEditorError } from '../../src/core/errors';
describe('job lifecycle', () => {
  it('orders progress and exactly one terminal event', async () => {
    const jobs = new Jobs(),
      events: string[] = [];
    const job = jobs.start(async (_signal, progress) => {
      progress({ stage: 'decode', progress: 0 });
      progress({ stage: 'decode', progress: 1 });
      return 42;
    });
    job.subscribe((e) => events.push(e.state + ':' + e.stage));
    expect(await job.completion).toBe(42);
    expect(events).toEqual([
      'running:queued',
      'running:decode',
      'running:decode',
      'completed:completed',
    ]);
    await jobs.dispose();
  });
  it('rejects cancellation without late result publication and awaits cleanup', async () => {
    const jobs = new Jobs(),
      events: string[] = [];
    let finish!: () => void,
      cleaned = false;
    const pending = new Promise<void>((r) => {
      finish = r;
    });
    const job = jobs.start(async () => {
      try {
        await pending;
        return 42;
      } finally {
        cleaned = true;
      }
    });
    job.subscribe((e) => events.push(e.state));
    await Promise.resolve();
    const disposing = jobs.dispose();
    expect(cleaned).toBe(false);
    finish();
    await disposing;
    expect(cleaned).toBe(true);
    await expect(job.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(events).not.toContain('completed');
  });
  it('isolates subscribers and returns stable quota errors', async () => {
    const jobs = new Jobs();
    jobs.subscribe(() => {
      throw new Error('consumer');
    });
    const job = jobs.start(async () => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    await expect(job.completion).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
    expect(asEditorError(new DOMException('abort', 'AbortError')).code).toBe(
      'CANCELLED',
    );
    await jobs.dispose();
  });
});

import { vi } from 'vitest';
import { WorkerClient } from '../../src/services/worker-client';
it('recovers a crashed worker and releases a stale transferable', async () => {
  class Bitmap {
    closed = false;
    close() {
      this.closed = true;
    }
  }
  vi.stubGlobal('ImageBitmap', Bitmap);
  const workers: {
    onmessage: ((event: { data: unknown }) => void) | null;
    onerror: (() => void) | null;
    onmessageerror: (() => void) | null;
    messages: { id: string; operation: string }[];
    postMessage(message: { id: string; operation: string }): void;
    terminate: () => void;
  }[] = [];
  const client = new WorkerClient(() => {
    const worker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      messages: [],
      postMessage(message: { id: string; operation: string }) {
        this.messages.push(message);
      },
      terminate: vi.fn(),
    } as (typeof workers)[number];
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const first = client.run('frame', {}, new AbortController().signal, () => {});
  workers[0]!.onerror!();
  await expect(first).rejects.toMatchObject({ code: 'WORKER_FAILED' });
  expect(workers[0]!.terminate).toHaveBeenCalled();
  const second = client.run<number>(
    'frame',
    {},
    new AbortController().signal,
    () => {},
  );
  workers[1]!.onmessage!({
    data: { id: workers[1]!.messages[0]!.id, kind: 'result', data: 42 },
  });
  expect(await second).toBe(42);
  const bitmap = new Bitmap();
  workers[1]!.onmessage!({
    data: { id: 'stale', kind: 'result', data: { image: bitmap } },
  });
  expect(bitmap.closed).toBe(true);
  client.reset();
  vi.unstubAllGlobals();
});

import { withQuotaRecovery } from '../../src/storage/quota';
import { EditorError } from '../../src/core/errors';
import { createPreviewSession } from '../../src/services/preview';
import { newProject, clipSchema } from '../../src/core/model';
it('reserves space and retries cleaned quota failures once, never cancellations', async () => {
  const order: string[] = [];
  const store = {
    evict: async (bytes?: number) => {
      order.push('evict:' + bytes);
    },
  };
  let attempts = 0;
  const operation = async () => {
    order.push('write');
    attempts++;
    if (attempts === 1) {
      order.push('cleanup');
      throw new DOMException('full', 'QuotaExceededError');
    }
    return 42;
  };
  expect(
    await withQuotaRecovery(
      store,
      123,
      new AbortController().signal,
      operation,
    ),
  ).toBe(42);
  expect(order).toEqual([
    'evict:123',
    'write',
    'cleanup',
    'evict:Infinity',
    'write',
  ]);
  attempts = 0;
  await expect(
    withQuotaRecovery(store, 1, new AbortController().signal, async () => {
      attempts++;
      throw new EditorError('QUOTA_EXCEEDED', 'still full');
    }),
  ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(attempts).toBe(2);
  const abort = new AbortController();
  abort.abort();
  await expect(
    withQuotaRecovery(store, 1, abort.signal, operation),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
});
it('rejects preview startup failures and reports later worker failures', async () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const p = newProject('preview');
  p.tracks = [
    {
      id: 't',
      kind: 'overlay',
      muted: false,
      clips: [
        clipSchema.parse({
          id: 'c',
          kind: 'text',
          startUs: 0,
          durationUs: 1000000,
          text: { text: 'test' },
        }),
      ],
    },
  ];
  const context = {
    state: 'running',
    currentTime: 0,
    createBuffer: () => ({ copyToChannel: vi.fn() }),
    createBufferSource: () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
  } as unknown as AudioContext;
  const canvas = {
    width: 100,
    height: 100,
    getContext: () => ({ drawImage: vi.fn() }),
  } as unknown as HTMLCanvasElement;
  let failure: EditorError | undefined = new EditorError(
    'MISSING_ASSET',
    'missing original',
  );
  const session = createPreviewSession(
    async () => p,
    canvas,
    context,
    async () => {
      if (failure) throw failure;
      return {
        timeUs: 0,
        revision: 0,
        image: { close: vi.fn() } as unknown as ImageBitmap,
      };
    },
    async (_p, _start, count) => [
      new Float32Array(count),
      new Float32Array(count),
    ],
  );
  const errors: string[] = [];
  session.onError((e) => errors.push(e.code));
  await expect(session.play()).rejects.toMatchObject({ code: 'MISSING_ASSET' });
  failure = undefined;
  await session.play();
  failure = new EditorError('WORKER_FAILED', 'worker crash');
  callbacks.pop()!(0);
  await vi.waitFor(() =>
    expect(errors).toEqual(['MISSING_ASSET', 'WORKER_FAILED']),
  );
  session.dispose();
  vi.unstubAllGlobals();
});
it('superseded asynchronous project reads cannot replace a newer seek', async () => {
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const p = newProject('seek');
  p.tracks = [
    {
      id: 't',
      kind: 'overlay',
      muted: false,
      clips: [
        clipSchema.parse({
          id: 'c',
          kind: 'text',
          startUs: 0,
          durationUs: 1000000,
          text: { text: 'test' },
        }),
      ],
    },
  ];
  let resolve!: (value: typeof p) => void,
    reads = 0;
  const frames: number[] = [];
  const session = createPreviewSession(
    () =>
      ++reads === 1
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve(p),
    {
      width: 100,
      height: 100,
      getContext: () => ({ drawImage() {} }),
    } as unknown as HTMLCanvasElement,
    {} as AudioContext,
    async (_p, t) => {
      frames.push(t);
      return {
        timeUs: t,
        revision: 0,
        image: { close() {} } as unknown as ImageBitmap,
      };
    },
    async () => [],
  );
  const old = session.seek(100);
  await session.seek(200);
  resolve(p);
  await old;
  expect(session.currentTimeUs).toBe(200);
  expect(frames).toEqual([200]);
  session.dispose();
  vi.unstubAllGlobals();
});

import { Store } from '../../src/storage/store';
it('owned quota eviction preserves originals, edits and derivatives pinned by active readers', async () => {
  const records = [
    { id: 'idle', assetId: 'a', path: 'cache-idle', size: 100, accessed: 0 },
    {
      id: 'active',
      assetId: 'b',
      path: 'cache-active',
      size: 100,
      accessed: 1,
    },
  ];
  const files = new Set(['a', 'b', 'cache-idle', 'cache-active', 'foreign']);
  const deleted: string[] = [];
  vi.stubGlobal('navigator', {
    storage: { estimate: async () => ({ quota: 500, usage: 450 }) },
    locks: {
      request: async (
        name: string,
        options: { ifAvailable?: boolean },
        callback: (lock: object | null) => Promise<unknown>,
      ) =>
        callback(options.ifAvailable && name.endsWith('asset:b') ? null : {}),
    },
  });
  const store = Object.assign(Object.create(Store.prototype) as Store, {
    namespace: 'test',
    db: {
      getAll: async () => records.filter((r) => !deleted.includes(r.id)),
      delete: async (_table: string, id: string) => {
        deleted.push(id);
      },
    },
    root: {
      removeEntry: async (path: string) => {
        files.delete(path);
      },
    },
  });
  await store.evict(150);
  expect([...files].sort()).toEqual(['a', 'b', 'cache-active', 'foreign']);
  await store.evict(Infinity);
  expect(deleted).toEqual(['idle']);
  vi.unstubAllGlobals();
});

import { modelStatus } from '../../src/services/transcription-status';
import { requiredUrls } from '../../src/services/transcription-config';
it('does not report persistent readiness for valid JSON with a changed pinned checksum', async () => {
  const url = requiredUrls().find((url) => url.endsWith('/config.json'))!;
  vi.stubGlobal('caches', {
    has: async () => true,
    open: async () => ({
      match: async (requested: string) =>
        requested === url
          ? new Response('{"model_type":"tampered"}')
          : undefined,
    }),
  });
  expect((await modelStatus('test')).missing).toContain(url);
  vi.unstubAllGlobals();
});
it('blocks suspended preview playback without user activation', async () => {
  vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const resume = vi.fn();
  const session = createPreviewSession(
    async () => newProject('empty'),
    {} as HTMLCanvasElement,
    { state: 'suspended', resume } as unknown as AudioContext,
    async () => {
      throw new Error('must not render');
    },
    async () => [],
  );
  await expect(session.play()).rejects.toMatchObject({
    code: 'PLAYBACK_BLOCKED',
  });
  expect(resume).not.toHaveBeenCalled();
  session.dispose();
  vi.unstubAllGlobals();
});
