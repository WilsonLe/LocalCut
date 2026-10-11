import { test, expect, type Page } from '@playwright/test';
import { closeMediaImport } from './workspace-import-helper';
import { mediaVideo } from './workspace-video-fixture';
import { openVersions } from './workspace-settings-helper';

async function png(page: Page) {
  return page.evaluate(async () => {
    const canvas = new OffscreenCanvas(32, 32);
    canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
    return [
      ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
    ];
  });
}

async function transfer(
  page: Page,
  files: { name: string; type: string; bytes: number[] }[],
) {
  return page.evaluateHandle((files) => {
    const data = new DataTransfer();
    for (const file of files)
      data.items.add(
        new File([new Uint8Array(file.bytes)], file.name, { type: file.type }),
      );
    return data;
  }, files);
}

async function snapshot(page: Page, base: string) {
  return page.evaluate(async (base) => {
    const { createEditor } = (await import(
      base + 'editor.js'
    )) as typeof import('../../src/editor');
    const engine = await createEditor();
    try {
      const project = (await engine.projects.list())[0]!;
      return await engine.projects.snapshot(project.id);
    } finally {
      await engine.dispose();
    }
  }, base);
}

for (const base of ['/', '/LocalCut/']) {
  test(`asset drop hover, batch results, picker parity and persistence ${base}`, async ({
    page,
  }, info) => {
    await page.goto(base);
    const bytes = await png(page);
    const data = await transfer(page, [
      { name: 'first.png', type: 'image/png', bytes },
      { name: 'broken.mp4', type: 'video/mp4', bytes: [1, 2, 3] },
      { name: 'last.png', type: '', bytes },
    ]);
    const header = page.locator('.workspace-header');
    const indicator = page
      .getByRole('status')
      .filter({ hasText: 'Drop assets to import' });
    // Hover never opens editing storage or loads the editor entry.
    const loaded: string[] = [];
    page.on('request', (request) => loaded.push(request.url()));
    await header.dispatchEvent('dragenter', { dataTransfer: data });
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveCSS('pointer-events', 'none');
    await header
      .locator('.brand')
      .dispatchEvent('dragenter', { dataTransfer: data });
    await header
      .locator('.brand')
      .dispatchEvent('dragleave', { dataTransfer: data });
    await expect(indicator).toBeVisible();
    expect(loaded.some((url) => /editor(?:\.|-).*\.js/.test(url))).toBe(false);
    await page.screenshot({
      path: info.outputPath('asset-drop-indicator.png'),
    });
    await header.dispatchEvent('dragleave', { dataTransfer: data });
    await expect(indicator).not.toBeVisible();
    await header.dispatchEvent('dragenter', { dataTransfer: data });
    await page.keyboard.press('Escape');
    await expect(indicator).not.toBeVisible();
    await header.dispatchEvent('dragover', { dataTransfer: data });
    await expect(indicator).toBeVisible();
    await header.dispatchEvent('drop', { dataTransfer: data });
    const dialog = page.getByRole('dialog', {
      name: 'Import media',
      exact: true,
    });
    const rows = dialog.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('data-status', 'completed');
    await expect(rows.nth(1)).toHaveAttribute('data-status', 'failed');
    await expect(rows.nth(2)).toHaveAttribute('data-status', 'completed');
    await expect(rows.nth(0).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    await expect(rows.nth(1).locator('.text-destructive')).not.toBeEmpty();
    await expect(dialog).toContainText('2 of 3 added');
    await expect(indicator).not.toBeVisible();
    await expect(page.locator('.timeline-clip.image')).toHaveCount(2);
    await page.screenshot({
      path: info.outputPath('asset-import-results.png'),
    });
    // A completed modal blocks new drops until explicitly dismissed.
    const rejected = await header.evaluate((node, data) => {
      const event = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }, data);
    expect(rejected).toBe(true);
    await expect(rows).toHaveCount(3);
    await expect(page.locator('.timeline-clip.image')).toHaveCount(2);
    await closeMediaImport(page);
    await page.reload();
    await expect(page.locator('.timeline-clip.image')).toHaveCount(2);
    expect(
      (await snapshot(page, base)).tracks.flatMap((track) => track.clips),
    ).toHaveLength(2);
    // Media-tab dropping accepts real native video alongside existing assets.
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    const video = await mediaVideo(page);
    const videoData = await transfer(page, [
      { name: video.name, type: video.mimeType, bytes: [...video.buffer] },
    ]);
    const media = page.getByRole('region', { name: 'Project media' });
    await media.dispatchEvent('dragenter', { dataTransfer: videoData });
    await expect(indicator).toBeVisible();
    await media.dispatchEvent('drop', { dataTransfer: videoData });
    await expect(dialog.getByRole('listitem')).toHaveAttribute(
      'data-status',
      'completed',
    );
    await closeMediaImport(page);
    await expect(page.locator('.timeline-clip.video')).toHaveCount(1);
    await page.getByLabel('Import media', { exact: true }).setInputFiles({
      name: 'picker.png',
      mimeType: 'image/png',
      buffer: Buffer.from(bytes),
    });
    await expect(dialog.getByRole('listitem')).toHaveCount(1);
    await expect(dialog.getByRole('listitem')).toHaveAttribute(
      'data-status',
      'completed',
    );
    await expect(dialog).toContainText('picker.png');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.timeline-clip.image')).toHaveCount(3);
    await openVersions(page);
    await page
      .getByRole('group', { name: 'Saved versions' })
      .getByRole('button')
      .first()
      .click();
    await expect(page.getByText(/Version \d+ · Read-only/)).toBeVisible();
    await header.dispatchEvent('dragover', { dataTransfer: videoData });
    await expect(indicator).not.toBeVisible();
    expect(
      await header.evaluate((node, data) => {
        const event = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      }, videoData),
    ).toBe(true);
    await expect(dialog).not.toBeVisible();
    expect(
      (await snapshot(page, base)).tracks.flatMap((track) => track.clips),
    ).toHaveLength(4);
    await data.dispose();
    await videoData.dispose();
  });

  test(`asset drop ignores text and blocked project routes ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const text = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'hello');
      return data;
    });
    const workspace = page.locator('.workspace');
    await workspace.dispatchEvent('dragenter', { dataTransfer: text });
    await workspace.dispatchEvent('dragover', { dataTransfer: text });
    await expect(page.locator('.asset-drop-overlay')).toHaveCount(0);
    const prevented = await workspace.evaluate((node, data) => {
      const event = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }, text);
    expect(prevented).toBe(false);
    const data = await transfer(page, [
      { name: 'blocked.png', type: 'image/png', bytes: await png(page) },
    ]);
    await page.goto(base + '#/project/missing');
    await workspace.dispatchEvent('dragenter', { dataTransfer: data });
    await workspace.dispatchEvent('dragover', { dataTransfer: data });
    await expect(page.locator('.asset-drop-overlay')).toHaveCount(0);
    expect(
      await workspace.evaluate((node, data) => {
        const event = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      }, data),
    ).toBe(true);
    await expect(
      page.getByRole('dialog', { name: 'Import media', exact: true }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(base + '#/project/missing');
    await text.dispose();
    await data.dispose();
  });

  for (const dismissWith of [
    'Okay',
    'X',
    'Escape',
    'task cancellation',
  ] as const) {
    test(`asset drop background queue with ${dismissWith} on mobile ${base}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      // Pause inspection inside the real worker, not the main browser realm.
      await page.route('**/media.worker-*.js', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            `
        const originalBitmap = self.createImageBitmap.bind(self);
        let releaseBitmap;
        const bitmapBarrier = new Promise(resolve => { releaseBitmap = resolve; });
        self.createImageBitmap = async (...args) => {
          await bitmapBarrier;
          return originalBitmap(...args);
        };
        self.addEventListener('message', event => {
          if (event.data.operation === 'release-test-import') {
            releaseBitmap();
            event.stopImmediatePropagation();
          }
        }, true);
      ` + (await response.text()),
        });
      });
      await page.goto(base);
      const bytes = await png(page);
      await page.evaluate(() => {
        const NativeWorker = window.Worker;
        const workers: Worker[] = [];
        window.Worker = class extends NativeWorker {
          private importId?: string;
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            workers.push(this);
          }
          postMessage(message: unknown, transfer: Transferable[]): void;
          postMessage(
            message: unknown,
            options?: StructuredSerializeOptions,
          ): void;
          postMessage(
            message: unknown,
            options: Transferable[] | StructuredSerializeOptions = [],
          ) {
            const command = message as { operation?: string; id?: string };
            if (command.operation === 'import') this.importId = command.id;
            if (
              command.operation === 'cancel' &&
              this.importId &&
              command.id === this.importId
            ) {
              Object.assign(window, { importCancellationReceived: true });
            }
            if (Array.isArray(options)) super.postMessage(message, options);
            else super.postMessage(message, options);
          }
        };
        Object.assign(window, {
          releaseImport: () => {
            for (const worker of workers)
              worker.postMessage({ operation: 'release-test-import' });
          },
        });
      });
      const data = await transfer(page, [
        { name: 'held.png', type: 'image/png', bytes },
        { name: 'queued.png', type: 'image/png', bytes },
      ]);
      await page
        .locator('.workspace')
        .dispatchEvent('drop', { dataTransfer: data });
      const dialog = page.getByRole('dialog', {
        name: 'Import media',
        exact: true,
      });
      await expect(dialog.locator('li[data-status="importing"]')).toHaveCount(
        1,
      );
      await expect(dialog.locator('li[data-status="queued"]')).toHaveCount(1);
      await expect(dialog.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '0',
      );
      await page
        .locator('.workspace')
        .dispatchEvent('dragover', { dataTransfer: data });
      await expect(page.locator('.asset-drop-overlay')).toHaveCount(0);
      await page
        .locator('.workspace')
        .dispatchEvent('drop', { dataTransfer: data });
      await expect(dialog.getByRole('listitem')).toHaveCount(2);
      await expect(dialog.getByRole('button')).toHaveCount(2);
      await expect(
        dialog.getByRole('button', { name: 'Okay', exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Close', exact: true }),
      ).toBeVisible();
      const sourceId = new URL(page.url()).hash.split('/')[2]!;
      const other = await context.newPage();
      let destinationId: string | undefined;
      try {
        await other.goto(base);
        // A full engine can claim queued jobs. Keep this observer alive until
        // readback finishes so disposal cannot interrupt an import it claimed.
        await other.evaluate(async (base) => {
          const { createEditor } = (await import(
            base + 'editor.js'
          )) as typeof import('../../src/editor');
          Object.assign(window, { importObserver: await createEditor() });
        }, base);
        // Read the durable queue while native inspection is held. Both file
        // tasks must already exist, including the one that has not started.
        await expect
          .poll(() =>
            other.evaluate(async () => {
              const engine = (
                window as unknown as {
                  importObserver: import('../../src/editor').Editor;
                }
              ).importObserver;
              return (await engine.tasks.list())
                .filter((task) => task.kind === 'media.import')
                .map((task) => task.state)
                .sort();
            }),
          )
          .toEqual(['queued', 'running']);
        if (dismissWith === 'task cancellation') {
          await other.evaluate(async () => {
            const engine = (
              window as unknown as {
                importObserver: import('../../src/editor').Editor;
              }
            ).importObserver;
            const task = (await engine.tasks.list()).find(
              (task) =>
                task.kind === 'media.import' && task.state === 'running',
            );
            if (!task) throw new Error('No active media import');
            await engine.tasks.cancel(task.id);
          });
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  (
                    window as unknown as {
                      importCancellationReceived?: boolean;
                    }
                  ).importCancellationReceived,
              ),
            )
            .toBe(true);
        } else {
          if (dismissWith === 'Escape') await page.keyboard.press('Escape');
          else
            await dialog
              .getByRole('button', {
                name: dismissWith === 'X' ? 'Close' : 'Okay',
                exact: true,
              })
              .click();
          await expect(dialog).not.toBeVisible();
          // Closing progress releases the workspace. An edit and a project
          // switch are both allowed while the queued imports are still held.
          await page
            .getByRole('button', { name: 'Commands', exact: true })
            .click();
          const palette = page.getByRole('dialog', {
            name: 'Commands',
            exact: true,
          });
          await palette.getByRole('combobox').fill('Add text');
          await palette.getByRole('option', { name: /Add text/ }).click();
          await page
            .getByRole('button', { name: 'Insert Plain text', exact: true })
            .click();
          await expect(
            page.getByRole('dialog', { name: 'Clip properties', exact: true }),
          ).toBeVisible();
          await page
            .getByRole('button', { name: 'Close', exact: true })
            .click();
          destinationId = await other.evaluate(async () => {
            const engine = (
              window as unknown as {
                importObserver: import('../../src/editor').Editor;
              }
            ).importObserver;
            return (await engine.projects.create('Other project')).id;
          });
          await page.goto(base + '#/project/' + destinationId);
          await page.getByRole('button', { name: 'Edit', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'Open project', exact: true }),
          ).toContainText('Other project');
          if (dismissWith === 'X') {
            const next = await transfer(page, [
              { name: 'following.png', type: 'image/png', bytes },
            ]);
            await page
              .locator('.workspace')
              .dispatchEvent('drop', { dataTransfer: next });
            await expect(dialog.getByRole('listitem')).toHaveCount(1);
            await expect(dialog).toContainText('following.png');
            await next.dispose();
          }
        }
        await page.evaluate(() =>
          (window as unknown as { releaseImport(): void }).releaseImport(),
        );
        if (dismissWith === 'task cancellation') {
          await expect(
            dialog.locator('li[data-status="cancelled"]'),
          ).toHaveCount(1);
          await expect(
            dialog.locator('li[data-status="completed"]'),
          ).toHaveCount(1);
          await expect(dialog).toContainText('1 of 2 added');
          await closeMediaImport(page);
        } else if (dismissWith === 'X') {
          await expect(dialog.getByRole('listitem')).toHaveCount(1);
          await expect(dialog.getByRole('listitem')).toHaveAttribute(
            'data-status',
            'completed',
          );
          await expect(dialog).toContainText('following.png');
          await closeMediaImport(page);
          await expect(page.locator('.timeline-clip.image')).toHaveCount(1);
        } else {
          await expect(dialog).not.toBeVisible();
          await expect(page.locator('.timeline-clip')).toHaveCount(0);
        }
        await expect
          .poll(() =>
            other.evaluate(async (sourceId) => {
              const engine = (
                window as unknown as {
                  importObserver: import('../../src/editor').Editor;
                }
              ).importObserver;
              return (await engine.projects.snapshot(sourceId)).tracks
                .flatMap((track) => track.clips)
                .filter((clip) => clip.kind === 'image').length;
            }, sourceId),
          )
          .toBe(dismissWith === 'task cancellation' ? 1 : 2);
        if (destinationId) {
          expect(
            await other.evaluate(async (destinationId) => {
              const engine = (
                window as unknown as {
                  importObserver: import('../../src/editor').Editor;
                }
              ).importObserver;
              return (
                await engine.projects.snapshot(destinationId)
              ).tracks.flatMap((track) => track.clips).length;
            }, destinationId),
          ).toBe(dismissWith === 'X' ? 1 : 0);
          await page.goto(base + '#/project/' + sourceId);
          await page.getByRole('button', { name: 'Edit', exact: true }).click();
          await expect(page.locator('.timeline-clip.image')).toHaveCount(2);
          await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
          await page.reload();
          await expect(page.locator('.timeline-clip.image')).toHaveCount(2);
          await expect(dialog).not.toBeVisible();
        }
      } finally {
        await page
          .evaluate(() =>
            (
              window as unknown as { releaseImport?: () => void }
            ).releaseImport?.(),
          )
          .catch(() => {});
        await other
          .evaluate(async () => {
            await (
              window as unknown as {
                importObserver?: import('../../src/editor').Editor;
              }
            ).importObserver?.dispose();
          })
          .catch(() => {});
        await other.close();
      }
      await data.dispose();
    });
  }
}
