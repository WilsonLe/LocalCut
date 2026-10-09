import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jobs } from '../../src/services/jobs';
import { sourceCues } from '../../src/services/transcript-cues';
import { importAsset } from '../../src/media/assets';
import { Store } from '../../src/storage/store';
import { commitWithSignal } from '../../src/storage/transaction';

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('publication and cancellation', () => {
  it('disposes a finished but unclaimed resource before reporting cancellation', async () => {
    const jobs = new Jobs();
    const produced = deferred<{ dispose(): Promise<void> }>();
    const dispose = vi.fn(async () => {});
    const states: string[] = [];
    const job = jobs.start(() => produced.promise, {
      discard: (value) => value.dispose(),
    });
    job.subscribe((event) => states.push(event.state));
    job.cancel();
    produced.resolve({ dispose });
    await expect(job.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(dispose).toHaveBeenCalledOnce();
    expect(states).not.toContain('completed');
    await jobs.dispose();
  });

  it('returns a successful committed result when cancellation loses the commit race', async () => {
    const jobs = new Jobs();
    const committed = deferred<number>();
    const job = jobs.start(() => committed.promise, {
      acceptCommittedResult: true,
    });
    await Promise.resolve();
    committed.resolve(42);
    job.cancel();
    await expect(job.completion).resolves.toBe(42);
    await jobs.dispose();
  });

  it('aborts an IndexedDB transaction while its writes are pending', async () => {
    const done = deferred<void>(),
      write = deferred<void>();
    const controller = new AbortController();
    const transaction = {
      done: done.promise,
      abort: vi.fn(() => {
        const error = new DOMException('aborted', 'AbortError');
        write.reject(error);
        done.reject(error);
      }),
    };
    const result = commitWithSignal(
      transaction,
      controller.signal,
      () => write.promise,
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(transaction.abort).toHaveBeenCalled();
  });

  it.each(['before', 'after'] as const)(
    'keeps original bytes and ready metadata consistent when cancellation arrives %s commit',
    async (when) => {
      const controller = new AbortController();
      const files = new Set<string>(),
        records = new Map<string, unknown>(),
        journals = new Map<string, unknown>();
      vi.stubGlobal('createImageBitmap', async () => ({
        width: 2,
        height: 2,
        close() {},
      }));
      const store = Object.assign(Object.create(Store.prototype) as Store, {
        evict: async () => {},
        lock: async (
          _key: string,
          _mode: string,
          work: () => Promise<unknown>,
        ) => work(),
        write: async (path: string) => {
          files.add(path);
        },
        remove: async (path: string) => {
          files.delete(path);
        },
        journal: async (entry: { id: string }) => {
          journals.set(entry.id, entry);
        },
        finishJournal: async (id: string) => {
          journals.delete(id);
        },
        db: {
          transaction: () => {
            const done = deferred<void>();
            const staged = new Map<string, { id: string }>();
            let aborted = false,
              committed = false;
            return {
              done: done.promise,
              abort() {
                if (committed)
                  throw new DOMException('finished', 'InvalidStateError');
                aborted = true;
                done.reject(new DOMException('aborted', 'AbortError'));
              },
              objectStore(name: string) {
                return {
                  async put(value: { id: string }) {
                    if (when === 'before' && name === 'assets')
                      controller.abort();
                    if (aborted)
                      throw new DOMException('aborted', 'AbortError');
                    staged.set(name, value);
                    if (name === 'journal')
                      queueMicrotask(() => {
                        if (aborted) return;
                        committed = true;
                        const asset = staged.get('assets')!;
                        records.set(asset.id, asset);
                        journals.set(value.id, value);
                        done.resolve();
                        if (when === 'after') controller.abort();
                      });
                  },
                };
              },
            };
          },
        },
      });
      const jobs = new Jobs();
      const image = new Blob([
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      ]);
      const job = jobs.start(
        () =>
          importAsset(
            store,
            image,
            'image.png',
            controller.signal,
            () => {},
            'import-job',
          ),
        { acceptCommittedResult: true },
      );
      if (when === 'before') {
        await expect(job.completion).rejects.toMatchObject({
          code: 'CANCELLED',
        });
        expect(records.size).toBe(0);
        expect(files.size).toBe(0);
      } else {
        const asset = await job.completion;
        expect(asset.status).toBe('ready');
        expect(records.has(asset.id)).toBe(true);
        expect(files.has(asset.id)).toBe(true);
      }
      expect(journals.size).toBe(0);
      await jobs.dispose();
    },
  );
});

it('bounds source cues to exact microsecond ranges despite padded 16 kHz samples', () => {
  const cues = sourceCues(
    [
      { timestamp: [-1, 0.25], text: ' first ' },
      { timestamp: [0.5, 2], text: 'last' },
      { timestamp: [0.8, null], text: 'unknown end' },
      { timestamp: [2, 3], text: 'outside' },
      { timestamp: [null, null], text: 'unknown start' },
    ],
    3,
    1_000_004,
  );
  expect(
    cues.map(({ timeUs, endUs, text }) => ({ timeUs, endUs, text })),
  ).toEqual([
    { timeUs: 3, endUs: 250003, text: 'first' },
    { timeUs: 500003, endUs: 1000004, text: 'last' },
    { timeUs: 800003, endUs: 1000004, text: 'unknown end' },
  ]);
  expect(new Set(cues.map((cue) => cue.id)).size).toBe(cues.length);
});
