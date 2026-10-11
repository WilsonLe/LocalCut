import { expect, test } from '@playwright/test';

type ProgressFixture = {
  advance: (progress: number) => void;
  finish: () => Promise<void>;
};

for (const base of ['/', '/LocalCut/']) {
  test(`task queue table scrolls one column and preserves saved actions ${base}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page.getByLabel('Project name', { exact: true }).fill('Queue table');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'New project', exact: true }),
    ).not.toBeVisible();
    const expand = page.getByRole('button', {
      name: 'Expand media',
      exact: true,
    });
    if (await expand.isVisible()) await expand.click();
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    const queue = page.getByRole('dialog', { name: 'Task queue', exact: true });
    await expect(
      queue.getByText('No tasks yet.', { exact: true }),
    ).toBeVisible();
    await expect(
      queue.getByRole('button', { name: /Scroll one column/ }),
    ).toHaveCount(0);
    await queue.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(async (base) => {
      // Production engine writes actual durable results into this isolated context.
      const { TaskQueue } = await import(base + 'editor.js');
      const tasks = new TaskQueue('localcut', { pollMs: 10 });
      tasks.register('table-result', {
        lane: 'local',
        recovery: 'safe',
        execute: async () => ({
          file: new File(['saved result'], 'result.txt', {
            type: 'text/plain',
          }),
        }),
      });
      await tasks.enqueue('table-result', {}, { label: 'Saved output' })
        .completion;
      await tasks.dispose();
    }, base);
    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    const resize = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });
      const mobileNavigation = page.getByRole('navigation', {
        name: 'Workspace sections',
        includeHidden: true,
      });
      if (width < 600) await expect(mobileNavigation).toBeVisible();
      else await expect(mobileNavigation).toHaveCount(0);
      // Wait for the responsive header to settle before reopening its queue.
      if (!(await queue.isVisible()))
        await page
          .getByRole('button', { name: 'Task queue', exact: true })
          .click();
      await expect(queue).toBeVisible();
    };
    const row = queue.getByRole('row', { name: 'Saved output', exact: true });
    await expect(
      queue.getByRole('table', { name: 'Saved tasks' }),
    ).toBeVisible();
    await expect(queue.getByRole('columnheader')).toHaveText([
      'Task',
      'Status',
      'Progress',
      'Details',
      'Actions',
    ]);
    await expect(row.getByRole('status')).toContainText('completed');
    await expect(row.getByRole('status')).toContainText('100%');
    await page.evaluate(async (base) => {
      const { TaskQueue } = await import(base + 'editor.js');
      const tasks = new TaskQueue('localcut', { pollMs: 10 });
      let advance!: (progress: number) => void;
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      tasks.register('table-progress', {
        lane: 'local',
        recovery: 'safe',
        execute: async (
          _input: unknown,
          context: {
            progress: (event: { stage: string; progress: number }) => void;
          },
        ) => {
          advance = (progress) =>
            context.progress({ stage: 'Processing', progress });
          advance(0.25);
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { text: 'Done' };
        },
      });
      const job = tasks.enqueue(
        'table-progress',
        {},
        { label: 'Progress task' },
      );
      await started;
      Object.assign(window, {
        queueProgressFixture: {
          advance,
          finish: async () => {
            release();
            await job.completion;
            await tasks.remove(job.id);
            await tasks.dispose();
          },
        },
      });
    }, base);
    const live = queue
      .getByRole('row', { name: 'Progress task', exact: true })
      .getByRole('status');
    await expect(live).toContainText('Processing');
    await expect(live).toContainText('25%');
    await page.evaluate(() =>
      (
        window as unknown as { queueProgressFixture: ProgressFixture }
      ).queueProgressFixture.advance(0.75),
    );
    await expect(live).toContainText('Processing');
    await expect(live).toContainText('75%');
    await page.evaluate(() =>
      (
        window as unknown as { queueProgressFixture: ProgressFixture }
      ).queueProgressFixture.finish(),
    );
    await expect(live).toHaveCount(0);
    await expect(
      queue.getByRole('button', { name: /Scroll one column/ }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `.artifacts/task-queue/${base === '/' ? 'root' : 'pages'}-desktop.png`,
    });

    await resize(390, 844);
    const region = queue.getByRole('region', { name: 'Task queue columns' });
    const left = queue.getByRole('button', { name: 'Scroll one column left' });
    const right = queue.getByRole('button', {
      name: 'Scroll one column right',
    });
    const position = () => region.evaluate((element) => element.scrollLeft);
    const boundaries = await region.evaluate((element) => {
      const table = element.querySelector('table')!;
      const scale = element.clientWidth / element.getBoundingClientRect().width;
      return Array.from(
        table.querySelectorAll('thead th'),
        (cell) =>
          (cell.getBoundingClientRect().left -
            table.getBoundingClientRect().left) *
          scale,
      );
    });
    await expect(right).toBeVisible();
    await expect(left).toHaveCount(0);
    await page.screenshot({
      path: `.artifacts/task-queue/${base === '/' ? 'root' : 'pages'}-narrow.png`,
    });
    await right.click();
    await expect.poll(position).toBeCloseTo(boundaries[1]!, 0);
    await expect(left).toBeVisible();
    await right.click();
    await expect.poll(position).toBeCloseTo(boundaries[2]!, 0);
    await left.click();
    await expect.poll(position).toBeCloseTo(boundaries[1]!, 0);
    await region.evaluate((element) => {
      element.scrollLeft = 75;
    });
    await right.click();
    await expect.poll(position).toBeCloseTo(boundaries[1]!, 0);
    await left.click();
    await expect.poll(position).toBe(0);
    await expect(left).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await right.click();
    await expect.poll(position).toBeCloseTo(boundaries[1]!, 0);
    const maximum = await region.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    const remaining = [
      ...new Set(
        boundaries.slice(2).map((boundary) => Math.min(boundary, maximum)),
      ),
    ];
    for (const target of remaining) {
      await expect(right).toBeVisible();
      await right.click();
      await expect.poll(position).toBeCloseTo(target, 0);
    }
    await expect(right).toHaveCount(0);
    await expect(left).toBeVisible();
    await expect.poll(position).toBeCloseTo(maximum, 0);
    // Resize while at the far edge: both controls disappear when every column fits.
    await resize(1440, 1000);
    await expect(
      queue.getByRole('button', { name: /Scroll one column/ }),
    ).toHaveCount(0);
    await row
      .getByRole('button', { name: 'Task details', exact: true })
      .click();
    await expect(row).toContainText('Attempts: 1 / 3');
    const download = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Save result', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('result.txt');
    await row.getByRole('button', { name: 'Remove task', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(
      queue.getByText('No tasks yet.', { exact: true }),
    ).toBeVisible();
    // Polling can populate an already-open empty queue; long queues keep the
    // header and column controls inside a bounded, vertically scrollable region.
    await page.evaluate(async (base) => {
      const { TaskQueue } = await import(base + 'editor.js');
      const tasks = new TaskQueue('localcut', { pollMs: 10 });
      tasks.register('table-many', {
        lane: 'local',
        recovery: 'safe',
        execute: async () => ({ text: 'Done' }),
      });
      for (let i = 0; i < 25; i++)
        await tasks.enqueue('table-many', {}, { label: `Task ${i}` })
          .completion;
      await tasks.dispose();
    }, base);
    await expect(queue.getByRole('row', { name: /^Task \d/ })).toHaveCount(25);
    await expect
      .poll(() =>
        region.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    await resize(390, 844);
    await expect(right).toBeVisible();
    const controlBounds = await right.boundingBox();
    expect(controlBounds!.y + controlBounds!.height).toBeLessThan(844);
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(position).toBeGreaterThan(0);
    await resize(1440, 1000);
    await page.screenshot({
      path: `.artifacts/task-queue/${base === '/' ? 'root' : 'pages'}-long.png`,
    });
    await page.keyboard.press('Escape');
    await expect(queue).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Task queue', exact: true }),
    ).toBeFocused();
  });
}
