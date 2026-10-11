import { expect, test } from '@playwright/test';
for (const base of ['/', '/LocalCut/']) {
  test(`durable task API polls retries escalates and recovers after reload ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const namespace = `queue-${crypto.randomUUID()}`;
    const ids = await page.evaluate(
      async ({ base, namespace }) => {
        const { TaskQueue } = await import(base + 'editor.js');
        const queue = new TaskQueue(namespace, { pollMs: 10, retryDelayMs: 5 });
        let calls = 0;
        queue.register('retry', {
          lane: 'local',
          recovery: 'safe',
          retryCodes: ['WORKER_FAILED'],
          maxAttempts: 2,
          execute: async () => {
            calls++;
            if (calls === 1)
              throw Object.assign(new Error('private body'), {
                code: 'WORKER_FAILED',
              });
            return {
              file: new File(['saved output'], 'result.txt', {
                type: 'text/plain',
              }),
            };
          },
        });
        const successful = queue.enqueue(
          'retry',
          { request: 'keep locally' },
          { label: 'Retrying local work' },
        );
        await successful.completion;
        queue.register('auth', {
          lane: 'remote',
          recovery: 'manual',
          execute: async () => {
            throw Object.assign(new Error('secret-key'), {
              code: 'AUTH_REQUIRED',
            });
          },
        });
        const failed = queue.enqueue(
          'auth',
          {},
          { label: 'Authentication failure' },
        );
        await failed.completion.catch(() => {});
        queue.register('long', {
          lane: 'long',
          recovery: 'manual',
          execute: async (
            _input: unknown,
            context: {
              signal: AbortSignal;
              progress: (event: { stage: string }) => void;
            },
          ) => {
            context.progress({ stage: 'Awaiting provider' });
            await new Promise<void>((_resolve, reject) =>
              context.signal.addEventListener('abort', () =>
                reject(new Error('aborted')),
              ),
            );
          },
        });
        const interrupted = queue.enqueue(
          'long',
          { request: 'original input' },
          { label: 'Interrupted remote work' },
        );
        // Keep the live scheduler reachable across calls; reload kills it without disposal.
        Object.assign(window, { taskQueue: queue });
        return {
          successful: successful.id,
          failed: failed.id,
          interrupted: interrupted.id,
        };
      },
      { base, namespace },
    );
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const queue = (
            window as unknown as {
              taskQueue: { get: (id: string) => Promise<{ stage: string }> };
            }
          ).taskQueue;
          return (await queue.get(id)).stage;
        }, ids.interrupted),
      )
      .toBe('Awaiting provider');
    await page.reload();
    const state = await page.evaluate(
      async ({ base, namespace, ids }) => {
        const { TaskQueue } = await import(base + 'editor.js');
        const queue = new TaskQueue(namespace);
        queue.register('long', {
          lane: 'long',
          recovery: 'manual',
          execute: async (input: unknown) => input,
        });
        queue.start();
        await queue.poll();
        // start obtains an owner Web Lock asynchronously.
        for (
          let i = 0;
          i < 100 && (await queue.get(ids.interrupted)).state === 'running';
          i++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          await queue.poll();
        }
        const successful = await queue.get(ids.successful);
        const failed = await queue.get(ids.failed);
        const interrupted = await queue.get(ids.interrupted);
        const output = await queue.result(ids.successful);
        const retried = await queue.retry(ids.interrupted);
        const retriedResult = await retried.completion;
        await queue.remove(ids.failed);
        const remaining = await queue.list();
        await queue.dispose();
        return {
          successful,
          failed,
          interrupted,
          text: await output.file.text(),
          retriedResult,
          remaining: remaining.map((task: { id: string }) => task.id),
        };
      },
      { base, namespace, ids },
    );
    expect(state.successful).toMatchObject({ state: 'completed', attempts: 2 });
    expect(state.failed).toMatchObject({
      state: 'failed',
      error: {
        code: 'AUTH_REQUIRED',
        action: expect.stringContaining('Reconnect'),
      },
    });
    expect(JSON.stringify(state.failed)).not.toContain('secret-key');
    expect(state.interrupted).toMatchObject({
      state: 'interrupted',
      error: { code: 'INTERRUPTED' },
    });
    expect(state.text).toBe('saved output');
    expect(state.retriedResult).toEqual({ request: 'original input' });
    expect(state.remaining).not.toContain(ids.failed);
  });
}

test('queued engine jobs preserve public event IDs and cross-tab export disposal', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const outcome = await page.evaluate(async () => {
    const { createEditor } = await import(String('/LocalCut/editor.js'));
    const namespace = `queue-facade-${crypto.randomUUID()}`;
    const first = await createEditor({ namespace }),
      second = await createEditor({ namespace });
    const events: { jobId: string; state: string }[] = [];
    const stop = first.events.jobs((event: { jobId: string; state: string }) =>
      events.push(event),
    );
    try {
      const project = await first.projects.create('queued output', {
        width: 32,
        height: 32,
      });
      await first.commands.apply({
        projectId: project.id,
        expectedRevision: 0,
        requestId: 'text',
        operations: [
          { type: 'addTrack', track: { id: 'overlay', kind: 'overlay' } },
          {
            type: 'insertClip',
            trackId: 'overlay',
            clip: {
              id: 'text',
              kind: 'text',
              startUs: 0,
              durationUs: 250000,
              width: 32,
              height: 32,
              text: { text: 'Queue', fontSize: 12 },
            },
          },
        ],
      });
      const job = first.exports.start(project.id, { format: 'webm' });
      const result = await job.completion;
      const recovered = await second.tasks.result(job.id);
      const disposer = typeof result.dispose;
      const recoveredDisposer = typeof recovered.dispose;
      await recovered.dispose();
      const saved = await first.tasks.result(job.id);
      const retainedBytes = (await saved.file.arrayBuffer()).byteLength;
      await first.tasks.remove(job.id);
      return {
        id: job.id,
        events,
        disposer,
        recoveredDisposer,
        size: result.file.size,
        retainedBytes,
      };
    } finally {
      stop();
      await first.dispose();
      await second.dispose();
    }
  });
  expect(outcome.disposer).toBe('function');
  expect(outcome.recoveredDisposer).toBe('function');
  expect(outcome.size).toBeGreaterThan(0);
  expect(outcome.retainedBytes).toBe(outcome.size);
  expect(
    outcome.events.filter((event) => event.state === 'completed'),
  ).toMatchObject([{ jobId: outcome.id, state: 'completed' }]);
});

test('full-engine assistants queue by default and retry without nested queue deadlock', async ({
  page,
}) => {
  await page.goto('/LocalCut/');
  const outcome = await page.evaluate(async () => {
    const { createEditor } = await import(String('/LocalCut/editor.js'));
    const { createAssistant, AiError } = await import(
      String('/LocalCut/ai.js')
    );
    const editor = await createEditor({
      namespace: `assistant-queue-${crypto.randomUUID()}`,
    });
    const project = await editor.projects.create('retry');
    let calls = 0;
    const provider = {
      async *stream() {
        if (calls++ === 0)
          throw new AiError('RATE_LIMITED', 'private echo', { status: 429 });
        yield {
          type: 'complete',
          message: { role: 'assistant', content: 'Recovered reply.' },
        };
      },
    };
    const assistant = createAssistant({
      editor,
      provider,
      projectId: project.id,
      model: 'test',
      context: {},
    });
    try {
      const turn = assistant.run('Give a short idea');
      await turn.completion.catch(() => {});
      const task = (await editor.tasks.list()).find(
        (record: { kind: string }) => record.kind === `assistant:${turn.id}`,
      );
      const before = await editor.tasks.get(task.id);
      const retry = await editor.tasks.retry(task.id);
      const result = await retry.completion;
      return {
        before,
        after: await editor.tasks.get(task.id),
        result,
        calls,
        revision: (await editor.projects.snapshot(project.id)).revision,
        history: assistant.snapshot().historyTurns,
      };
    } finally {
      await assistant.dispose();
      await editor.dispose();
    }
  });
  expect(outcome.before).toMatchObject({
    kind: expect.stringMatching(/^assistant:/),
    state: 'failed',
    error: { code: 'RATE_LIMITED', details: { status: 429 } },
  });
  expect(outcome.after.state).toBe('completed');
  expect(outcome.result).toMatchObject({
    text: 'Recovered reply.',
    proposalIds: [],
  });
  expect(outcome.calls).toBe(2);
  expect(outcome.revision).toBe(0);
  expect(outcome.history).toBe(0);
});
