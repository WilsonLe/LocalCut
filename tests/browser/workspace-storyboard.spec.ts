import { behaviorBases } from './coverage-bases';
import { openVersions } from './workspace-settings-helper';
import { test, expect } from '@playwright/test';

import type { Page } from '@playwright/test';
import type { Project } from '../../src/editor';

async function snapshot(
  page: Page,
  base: string,
  id: string,
): Promise<Project> {
  return page.evaluate(
    async ({ base, id }) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        return await editor.projects.snapshot(id);
      } finally {
        await editor.dispose();
      }
    },
    { base, id },
  );
}
for (const base of behaviorBases) {
  test(`workspace storyboard rejects drops and keeps failed fonts local ${base}`, async ({
    page,
  }) => {
    const remote: string[] = [];
    const localFonts: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') remote.push(url.href);
      if (
        url.pathname.includes('/storyboard/') &&
        url.pathname.endsWith('.woff2')
      )
        localFonts.push(url.href);
    });
    await page.route('**/storyboard/**/fonts/**', (route) => route.abort());
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = await editor.projects.create('Local font failure');
        await editor.commands.apply({
          projectId: project.id,
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          operations: [
            {
              type: 'upsertStoryboardElements',
              elements: [
                {
                  id: 'label',
                  type: 'text',
                  text: 'Keep this storyboard',
                  x: 100,
                  y: 100,
                },
              ],
            },
          ],
        });
        await editor.projects.versions.save(project.id);
        return project.id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
    const canvas = page.locator('.storyboard canvas.interactive');
    await expect(canvas).toBeVisible();
    await expect.poll(() => localFonts.length).toBeGreaterThan(0);
    await page.evaluate(() => document.fonts.ready);
    expect(remote).toEqual([]);

    const drop = async (library = false) => {
      const before = await snapshot(page, base, id);
      const pixels = await page
        .locator('.storyboard canvas.static')
        .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
      const result = await canvas.evaluate((canvas, library) => {
        const data = new DataTransfer();
        const element = {
          id: 'replacement',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        };
        if (library) {
          data.setData(
            'application/vnd.excalidrawlib+json',
            JSON.stringify({
              type: 'excalidrawlib',
              version: 2,
              libraryItems: [
                {
                  id: 'library',
                  status: 'published',
                  created: 1,
                  elements: [element],
                },
              ],
            }),
          );
        } else {
          data.items.add(
            new File(
              [
                JSON.stringify({
                  type: 'excalidraw',
                  version: 2,
                  elements: [
                    element,
                    {
                      ...element,
                      id: 'image',
                      type: 'image',
                      fileId: 'unowned',
                    },
                  ],
                  appState: { viewBackgroundColor: '#ff0000' },
                  files: {},
                }),
              ],
              'unowned.excalidraw',
              { type: 'application/json' },
            ),
          );
        }
        let reachedCanvas = false;
        const received = () => {
          reachedCanvas = true;
        };
        canvas.addEventListener('drop', received);
        const canceled = !canvas.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
          }),
        );
        canvas.removeEventListener('drop', received);
        return { canceled, reachedCanvas };
      }, library);
      expect(result).toEqual({ canceled: true, reachedCanvas: false });
      await expect(
        page.getByRole('dialog', { name: 'Import media' }),
      ).toHaveCount(0);
      expect(await snapshot(page, base, id)).toEqual(before);
      expect(
        await page
          .locator('.storyboard canvas.static')
          .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
      ).toBe(pixels);
    };
    await drop();
    await drop(true);
    await canvas.click({ position: { x: 400, y: 180 } });
    await page.keyboard.press('r');
    const bounds = (await canvas.boundingBox())!;
    await page.mouse.move(bounds.x + 400, bounds.y + 180);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 550, bounds.y + 260, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base, id)).storyboard?.elements.filter(
            (e) => e.type === 'rectangle',
          ).length,
      )
      .toBe(1);
    await openVersions(page);
    await page
      .getByRole('button', { name: /^Version / })
      .first()
      .click();
    await expect(
      page.getByRole('button', { name: 'Undo', exact: true }),
    ).toHaveCount(0);
    await drop();
    await drop(true);
    expect(remote).toEqual([]);
  });
}
