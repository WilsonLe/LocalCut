import { test, expect } from '@playwright/test';

interface ExportProbe {
  hold: boolean;
  pending: boolean;
  completed: boolean;
  calls: string[];
  release: (() => void) | null;
}
declare global {
  interface Window {
    __storyboardExportProbe: ExportProbe;
  }
}

for (const base of ['/', '/LocalCut/']) {
  test(`storyboard export and image insertion ownership ends during pending snapshot ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const ids = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const first = await editor.projects.create('Export owner');
        const second = await editor.projects.create('New owner');
        const image = new OffscreenCanvas(100, 100);
        image.getContext('2d')!.fillRect(0, 0, 100, 100);
        const asset = await editor.assets.import(
          await image.convertToBlob({ type: 'image/png' }),
          'Race source.png',
        ).completion;
        await editor.library.forProject(first.id).place(asset.id, [], null);
        await editor.commands.apply({
          projectId: first.id,
          expectedRevision: 0,
          requestId: crypto.randomUUID(),
          operations: [
            {
              type: 'upsertStoryboardElements',
              elements: [
                {
                  id: 'box',
                  type: 'rectangle',
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                },
              ],
            },
          ],
        });
        return { first: first.id, second: second.id };
      } finally {
        await editor.dispose();
      }
    }, base);

    // Keep the production workspace, engine and renderer. Instrument the
    // exported factory only to pause its real snapshot and observe job starts.
    await page.route(/\/assets\/editor-[^/]+\.js$/, async (route) => {
      const response = await route.fetch();
      const original = await response.text();
      const factory = original.match(/(\w+) as createEditor\b/);
      expect(factory).not.toBeNull();
      const body = original.replace(
        factory![0],
        '__raceCreateEditor as createEditor',
      );
      await route.fulfill({
        response,
        body: `${body}
async function __raceCreateEditor(...args) {
  const editor = await ${factory![1]}(...args);
  const probe = window.__storyboardExportProbe = {
    hold: false, pending: false, completed: false, calls: [], release: null
  };
  const snapshot = editor.projects.snapshot;
  editor.projects.snapshot = async (...args) => {
    const held = probe.hold;
    if (held) {
      probe.hold = false;
      probe.pending = true;
      await new Promise(resolve => probe.release = resolve);
    }
    const result = await snapshot(...args);
    if (held) {
      probe.pending = false;
      probe.completed = true;
    }
    return result;
  };
  for (const kind of ['export', 'store', 'insertImage']) {
    const start = editor.storyboard[kind];
    editor.storyboard[kind] = (...args) => {
      probe.calls.push(kind);
      return start(...args);
    };
  }
  return editor;
}`,
      });
    });

    for (const action of ['Store PNG in Media', 'Export PNG', 'Insert image']) {
      await test.step(action, async () => {
        // A distinct document navigation installs the instrumented factory.
        await page.goto(
          `${base}?export-race=${encodeURIComponent(action)}#/project/${ids.first}`,
        );
        await page
          .getByRole('tab', { name: 'Storyboard', exact: true })
          .click();
        await expect(
          page.locator('.storyboard canvas.interactive'),
        ).toBeVisible();
        await page
          .locator('.storyboard')
          .getByRole('button', { name: 'Storyboard menu', exact: true })
          .click();
        if (action === 'Insert image')
          await page
            .getByText('Insert image from Media', { exact: true })
            .click();
        await page.evaluate(() => {
          window.__storyboardExportProbe.hold = true;
        });
        await page.getByRole('button', { name: action, exact: true }).click();
        await expect
          .poll(() =>
            page.evaluate(() => window.__storyboardExportProbe.pending),
          )
          .toBe(true);
        await page.evaluate((id) => {
          location.hash = `/project/${id}`;
        }, ids.second);
        await expect(
          page.getByRole('button', { name: 'Open project', exact: true }),
        ).toContainText('New owner');
        await page.evaluate(() => {
          window.__storyboardExportProbe.release!();
        });
        await expect
          .poll(() =>
            page.evaluate(() => window.__storyboardExportProbe.completed),
          )
          .toBe(true);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        expect(
          await page.evaluate(() => window.__storyboardExportProbe.calls),
        ).toEqual([]);
      });
    }
  });
}
