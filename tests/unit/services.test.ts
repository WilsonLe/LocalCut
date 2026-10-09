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
