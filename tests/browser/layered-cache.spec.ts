import { test, expect } from '@playwright/test';
import type { TaskQueue } from '../../src/services/task-queue';
import type { Job } from '../../src/services/jobs';

type CacheWindow = Window & {
  cacheQueue: TaskQueue;
  cacheJob: Job<Float32Array>;
  cacheStage: string;
  releaseCache: () => void;
};

for (const base of ['/', '/LocalCut/']) {
  test(`layered task cache shares two tabs and survives reload ${base}`, async ({
    page,
    context,
  }) => {
    await page.goto(base);
    const namespace = `layered-${crypto.randomUUID()}`;
    const id = await page.evaluate(
      async ({ base, namespace }) => {
        const { TaskQueue, pureTaskCache } = await import(base + 'editor.js');
        const queue = new TaskQueue(namespace, { pollMs: 10 });
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        queue.register('pure', {
          cache: pureTaskCache('v1'),
          lane: 'local',
          recovery: 'safe',
          execute: async (
            input: Float32Array,
            context: { progress: (event: { stage: string }) => void },
          ) => {
            context.progress({ stage: 'Compute held' });
            await held;
            return input.map((value) => value * 2);
          },
        });
        const job = queue.enqueue('pure', new Float32Array([1, 2]), {
          label: 'Reusable',
        });
        Object.assign(window, {
          cacheQueue: queue,
          cacheJob: job,
          releaseCache: release,
        });
        return job.id;
      },
      { base, namespace },
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await (window as unknown as CacheWindow).cacheQueue.get(id))
              ?.stage,
          id,
        ),
      )
      .toBe('Compute held');
    const other = await context.newPage();
    try {
      await other.goto(base);
      const joinedId = await other.evaluate(
        async ({ base, namespace }) => {
          const { TaskQueue, pureTaskCache } = await import(base + 'editor.js');
          const queue = new TaskQueue(namespace, { pollMs: 10 });
          queue.register('pure', {
            cache: pureTaskCache('v1'),
            lane: 'local',
            recovery: 'safe',
            execute: async () => {
              throw new Error('Duplicate computation');
            },
          });
          const job = queue.enqueue('pure', new Float32Array([1, 2]), {
            label: 'Same request',
          });
          Object.assign(window, { cacheQueue: queue, cacheJob: job });
          job.subscribe((event: { stage: string }) => {
            (window as unknown as CacheWindow).cacheStage = event.stage;
          });
          return job.id;
        },
        { base, namespace },
      );
      expect(joinedId).not.toBe(id);
      await expect
        .poll(() =>
          other.evaluate(() => (window as unknown as CacheWindow).cacheStage),
        )
        .toBe('Compute held');
      expect(
        await page.evaluate(
          async () =>
            (await (window as unknown as CacheWindow).cacheQueue.list()).length,
        ),
      ).toBe(1);
      const cancelled = await page.evaluate(async () => {
        const state = window as unknown as CacheWindow;
        state.cacheJob.cancel();
        return state.cacheJob.completion.catch(
          (error: { code: string }) => error.code,
        );
      });
      expect(cancelled).toBe('CANCELLED');
      await page.evaluate(() =>
        (window as unknown as CacheWindow).releaseCache(),
      );
      expect(
        await other.evaluate(async () => [
          ...(await (window as unknown as CacheWindow).cacheJob.completion),
        ]),
      ).toEqual([2, 4]);
      const records = await other.evaluate(async () => {
        const state = window as unknown as CacheWindow;
        const records = await state.cacheQueue.list();
        await state.cacheQueue.dispose();
        return records;
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id,
        state: 'completed',
        attempts: 1,
        cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      await page.evaluate(() =>
        (window as unknown as CacheWindow).cacheQueue.dispose(),
      );
      await page.reload();
      const replay = await page.evaluate(
        async ({ base, namespace }) => {
          const { TaskQueue, pureTaskCache, freshTask } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          const queue = new TaskQueue(namespace, { pollMs: 10 });
          let computations = 0,
            actions = 0;
          const register = (version: string) =>
            queue.register('pure', {
              cache: pureTaskCache(version),
              lane: 'local',
              recovery: 'safe',
              execute: async (input: Float32Array) => {
                computations++;
                return input.map((value) => value * 2);
              },
            });
          register('v1');
          try {
            const hit = queue.enqueue<Float32Array>(
              'pure',
              new Float32Array([1, 2]),
              { label: 'Reloaded hit' },
            );
            const result = await hit.completion;
            result[0] = 99;
            const again = await queue.enqueue<Float32Array>(
              'pure',
              new Float32Array([1, 2]),
              { label: 'Unchanged' },
            ).completion;
            const before = (await queue.list()).length;
            const beforeComputations = computations;
            await queue.enqueue('pure', new Float32Array([1, 3]), {
              label: 'Different bytes',
            }).completion;
            register('v2');
            await queue.enqueue('pure', new Float32Array([1, 2]), {
              label: 'Different algorithm',
            }).completion;
            queue.register('action', {
              cache: freshTask('An explicit action creates a new publication'),
              lane: 'actions',
              recovery: 'manual',
              execute: async () => ++actions,
            });
            await queue.enqueue('action', {}, { label: 'Action' }).completion;
            await queue.enqueue('action', {}, { label: 'Action again' })
              .completion;
            return {
              again: [...again],
              before,
              beforeComputations,
              computations,
              actions,
              total: (await queue.list()).length,
              hitRecord: !!(await queue.get(hit.id)),
            };
          } finally {
            await queue.dispose();
          }
        },
        { base, namespace },
      );
      expect(replay).toEqual({
        again: [2, 4],
        before: 1,
        beforeComputations: 0,
        computations: 2,
        actions: 2,
        total: 5,
        hitRecord: false,
      });
    } finally {
      await other.close();
      await page.evaluate(async () => {
        const state = window as unknown as CacheWindow;
        state.releaseCache?.();
        await state.cacheQueue?.dispose();
      });
    }
  });
}
