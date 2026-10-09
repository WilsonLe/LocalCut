import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jobs } from '../../src/services/jobs';
import { Store } from '../../src/storage/store';
import type { Journal } from '../../src/storage/store';

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settlesPromptly<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error('Operation remained blocked on an asset lock')),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

describe('recovery journal races', () => {
  it.each(['committed', 'deleted'] as const)(
    'preserves an import whose journal becomes %s before recovery acquires its lock',
    async (completion) => {
      const snapshot: Journal = {
        id: 'import-job',
        target: 'original-media',
        kind: 'import',
      };
      let current: Journal | undefined = snapshot;
      let locked = false;
      const files = new Set(['original-media']);
      const reads: string[] = [];
      const deletions: string[] = [];
      vi.stubGlobal('navigator', {
        locks: {
          request: async (
            name: string,
            options: { ifAvailable?: boolean },
            callback: (lock: object | null) => Promise<void>,
          ) => {
            expect(name).toBe('race:job:import-job');
            expect(options.ifAvailable).toBe(true);
            // Import completion occurs after recovery's getAll snapshot and
            // before its nonblocking lock request can run the callback.
            current =
              completion === 'committed'
                ? { ...snapshot, committed: true }
                : undefined;
            locked = true;
            try {
              await callback({});
            } finally {
              locked = false;
            }
          },
        },
      });
      const store = Object.assign(Object.create(Store.prototype) as Store, {
        namespace: 'race',
        db: {
          getAll: async () => [structuredClone(snapshot)],
          get: async (table: string, id: string) => {
            expect(locked).toBe(true);
            reads.push(table + ':' + id);
            return table === 'journal'
              ? current
              : { id: 'original-media', status: 'ready' };
          },
          delete: async (table: string, id: string) => {
            deletions.push(table + ':' + id);
            current = undefined;
          },
        },
        root: {
          removeEntry: async (path: string) => {
            files.delete(path);
          },
        },
      });

      await store.recover();

      expect(reads[0]).toBe('journal:import-job');
      expect([...files]).toEqual(['original-media']);
      if (completion === 'committed') {
        expect(reads).toContain('assets:original-media');
        expect(deletions).toEqual(['journal:import-job']);
      } else {
        expect(reads).toEqual(['journal:import-job']);
        expect(deletions).toEqual([]);
      }
    },
  );
});

describe('asset lease cancellation', () => {
  it.each(['cancel', 'dispose'] as const)(
    '%s settles while an exclusive asset lock remains occupied',
    async (action) => {
      const requested = deferred<AbortSignal | undefined>();
      vi.stubGlobal('navigator', {
        locks: {
          request: (
            name: string,
            options: { mode: string; signal?: AbortSignal },
          ) => {
            expect(name).toBe('lease:asset:source');
            expect(options.mode).toBe('shared');
            requested.resolve(options.signal);
            // No lock grant occurs in this test. Only cancellation can finish.
            return new Promise<never>((_resolve, reject) => {
              const abort = () =>
                reject(new DOMException('Request aborted', 'AbortError'));
              if (options.signal?.aborted) abort();
              else
                options.signal?.addEventListener('abort', abort, {
                  once: true,
                });
            });
          },
        },
      });
      const store = Object.assign(Object.create(Store.prototype) as Store, {
        namespace: 'lease',
      });
      const jobs = new Jobs();
      let jobSignal: AbortSignal | undefined;
      let acquired = false;
      const job = jobs.start(async (signal) => {
        jobSignal = signal;
        const release = await store.lease('asset:source', signal);
        acquired = true;
        release();
      });
      const observedSignal = await requested.promise;
      const completion = job.completion.catch((error: unknown) => error);
      let disposal: Promise<void> | undefined;
      if (action === 'cancel') job.cancel();
      else disposal = jobs.dispose();

      expect(observedSignal).toBe(jobSignal);
      expect(observedSignal?.aborted).toBe(true);
      expect(await settlesPromptly(completion)).toMatchObject({
        code: 'CANCELLED',
      });
      await settlesPromptly(disposal ?? jobs.dispose());
      expect(acquired).toBe(false);
    },
  );

  it('propagates lock acquisition failure instead of waiting forever', async () => {
    const failure = new Error('Lock service failed');
    vi.stubGlobal('navigator', {
      locks: { request: async () => Promise.reject(failure) },
    });
    const store = Object.assign(Object.create(Store.prototype) as Store, {
      namespace: 'lease',
    });

    await expect(
      settlesPromptly(
        store.lease('asset:source', new AbortController().signal),
      ),
    ).rejects.toThrow('Lock service failed');
  });
});
