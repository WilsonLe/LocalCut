import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function openForm(page: Page) {
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page
    .getByRole('main', { name: 'Projects', exact: true })
    .getByRole('button', { name: 'New project', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'New project', exact: true });
}

async function snapshot(page: Page, base: string) {
  return page.evaluate(async (base) => {
    const { createEditor } = await import(`${base}editor.js`);
    const editor = await createEditor();
    try {
      const id = location.hash.split('/project/')[1];
      return await editor.projects.snapshot(id);
    } finally {
      await editor.dispose();
    }
  }, base);
}

for (const base of ['/', '/LocalCut/']) {
  test(`project format extreme preview dimensions ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    for (const size of [
      { width: 3840, height: 1, previewWidth: 960, previewHeight: 1 },
      { width: 1, height: 2160, previewWidth: 1, previewHeight: 2160 },
    ]) {
      const dialog = await openForm(page);
      await dialog.getByLabel('Project name').fill('Extreme format');
      await dialog.getByLabel('Width (px)').fill(String(size.width));
      await dialog.getByLabel('Height (px)').fill(String(size.height));
      await dialog
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await page.evaluate(async (base) => {
        const { createEditor } = (await import(
          `${base}editor.js`
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          const project = await editor.projects.snapshot(
            location.hash.split('/project/')[1]!,
          );
          const canvas = new OffscreenCanvas(32, 32);
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#ff0000';
          context.fillRect(0, 0, 32, 32);
          const asset = await editor.assets.import(
            new File(
              [await canvas.convertToBlob({ type: 'image/png' })],
              'red.png',
              { type: 'image/png' },
            ),
          ).completion;
          await editor.commands.apply({
            projectId: project.id,
            expectedRevision: project.revision,
            requestId: crypto.randomUUID(),
            operations: [
              {
                type: 'addTrack',
                track: { id: 'extreme-track', kind: 'video' },
              },
              {
                type: 'insertClip',
                trackId: 'extreme-track',
                clip: {
                  id: 'extreme-clip',
                  kind: 'image',
                  assetId: asset.id,
                  startUs: 0,
                  durationUs: 500000,
                  width: project.width,
                  height: project.height,
                },
              },
            ],
          });
        } finally {
          await editor.dispose();
        }
      }, base);
      await page.reload();
      const preview = page.getByLabel('Video preview', { exact: true });
      await expect(preview).toHaveAttribute('width', String(size.previewWidth));
      await expect(preview).toHaveAttribute(
        'height',
        String(size.previewHeight),
      );
      // A one-pixel source height becomes subpixel coverage when scaled down;
      // require actual red image content rather than an opaque full red pixel.
      await expect
        .poll(() =>
          preview.evaluate((canvas: HTMLCanvasElement) => {
            const [red, green, blue, alpha] = canvas
              .getContext('2d')!
              .getImageData(
                Math.floor(canvas.width / 2),
                Math.floor(canvas.height / 2),
                1,
                1,
              ).data;
            return red! > 0 && green === 0 && blue === 0 && alpha === 255;
          }),
        )
        .toBe(true);
      expect(await snapshot(page, base)).toMatchObject({
        width: size.width,
        height: size.height,
      });
    }
  });

  test(`project format presets custom dimensions validation and reload ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    let dialog = await openForm(page);
    await expect(dialog.getByLabel('Width (px)')).toHaveValue('1920');
    await expect(dialog.getByLabel('Height (px)')).toHaveValue('1080');
    await expect(
      dialog.getByRole('combobox', { name: 'Frame rate (fps)' }),
    ).toContainText('30 fps');

    await test.step('presets synchronize dimensions and omit unsupported portrait tiers', async () => {
      await dialog
        .getByRole('combobox', { name: 'Resolution', exact: true })
        .click();
      await page
        .getByRole('option', { name: '2160p (3840 × 2160)', exact: true })
        .click();
      await expect(dialog.getByLabel('Width (px)')).toHaveValue('3840');
      await dialog
        .getByRole('combobox', { name: 'Aspect ratio', exact: true })
        .click();
      await page
        .getByRole('option', { name: '9:16 — Portrait', exact: true })
        .click();
      await expect(dialog.getByLabel('Width (px)')).toHaveValue('1080');
      await expect(dialog.getByLabel('Height (px)')).toHaveValue('1920');
      await dialog
        .getByRole('combobox', { name: 'Resolution', exact: true })
        .click();
      await expect(
        page.getByRole('option', { name: /2160p|1440p/ }),
      ).toHaveCount(0);
      await page
        .getByRole('option', { name: '720p (720 × 1280)', exact: true })
        .click();
      await dialog
        .getByRole('combobox', { name: 'Aspect ratio', exact: true })
        .click();
      await page
        .getByRole('option', { name: '1:1 — Square', exact: true })
        .click();
      await expect(dialog.getByLabel('Width (px)')).toHaveValue('720');
      await expect(dialog.getByLabel('Height (px)')).toHaveValue('720');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await page
        .getByRole('button', { name: 'Open project', exact: true })
        .click();
      await page
        .getByRole('main', { name: 'Projects', exact: true })
        .getByRole('button', { name: 'New project', exact: true })
        .click();
      await expect(dialog.getByLabel('Width (px)')).toHaveValue('1920');
    });

    await test.step('invalid values cannot create and custom settings persist exactly', async () => {
      await dialog.getByLabel('Project name').fill('Custom fractional format');
      for (const value of ['', '0', '3841', '1000.5']) {
        await dialog.getByLabel('Width (px)').fill(value);
        await dialog
          .getByRole('button', { name: 'Create project', exact: true })
          .click();
        await expect(dialog).toBeVisible();
        expect(
          await dialog
            .getByLabel('Width (px)')
            .evaluate((input: HTMLInputElement) => input.validity.valid),
        ).toBe(false);
      }
      await dialog.getByLabel('Width (px)').fill('1000');
      await dialog.getByLabel('Height (px)').fill('2161');
      await dialog
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Height (px)').fill('700');
      await expect(
        dialog.getByRole('combobox', { name: 'Aspect ratio', exact: true }),
      ).toContainText('Custom');
      await expect(
        dialog.getByRole('combobox', { name: 'Resolution', exact: true }),
      ).toContainText('Custom');
      await dialog.getByRole('combobox', { name: 'Frame rate (fps)' }).click();
      await page
        .getByRole('option', { name: '29.97 fps', exact: true })
        .click();
      await dialog
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(page).toHaveURL(/#\/project\//);
      expect(await snapshot(page, base)).toMatchObject({
        width: 1000,
        height: 700,
        frameRate: { num: 30000, den: 1001 },
      });
      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Open project', exact: true }),
      ).toContainText('Custom fractional format');
      expect(await snapshot(page, base)).toMatchObject({
        width: 1000,
        height: 700,
        frameRate: { num: 30000, den: 1001 },
      });
    });

    await test.step('native MP4 and WebM exports retain the chosen dimensions', async () => {
      const outputs = await page.evaluate(async (base) => {
        const { createEditor } = (await import(
          `${base}editor.js`
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          const project = await editor.projects.snapshot(
            location.hash.split('/project/')[1]!,
          );
          const canvas = new OffscreenCanvas(32, 32);
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#facc15';
          context.fillRect(0, 0, 32, 32);
          const asset = await editor.assets.import(
            new File(
              [await canvas.convertToBlob({ type: 'image/png' })],
              'format.png',
              { type: 'image/png' },
            ),
          ).completion;
          await editor.commands.apply({
            projectId: project.id,
            expectedRevision: project.revision,
            requestId: crypto.randomUUID(),
            operations: [
              {
                type: 'addTrack',
                track: { id: 'format-track', kind: 'video' },
              },
              {
                type: 'insertClip',
                trackId: 'format-track',
                clip: {
                  id: 'format-clip',
                  kind: 'image',
                  assetId: asset.id,
                  startUs: 0,
                  durationUs: 500000,
                  width: project.width,
                  height: project.height,
                },
              },
            ],
          });
          const outputs = [];
          for (const format of ['mp4', 'webm'] as const) {
            const capabilities = await editor.exports.preflight(project.id, {
              format,
            }).completion;
            if (!capabilities.supported)
              throw new Error(`Required Chrome ${format} codec unavailable`);
            const artifact = await editor.exports.start(project.id, { format })
              .completion;
            try {
              const decoded = await editor.assets.import(
                new File([artifact.file], `format.${format}`, {
                  type: format === 'mp4' ? 'video/mp4' : 'video/webm',
                }),
              ).completion;
              outputs.push({
                format,
                width: decoded.width,
                height: decoded.height,
              });
            } finally {
              await artifact.dispose();
            }
          }
          return outputs;
        } finally {
          await editor.dispose();
        }
      }, base);
      expect(outputs).toEqual([
        { format: 'mp4', width: 1000, height: 700 },
        { format: 'webm', width: 1000, height: 700 },
      ]);
    });

    await test.step('mobile controls fit and default creation remains compatible', async () => {
      await page.setViewportSize({ width: 320, height: 568 });
      dialog = await openForm(page);
      await dialog
        .getByRole('combobox', { name: 'Frame rate (fps)' })
        .scrollIntoViewIfNeeded();
      await expect(
        dialog.getByRole('combobox', { name: 'Frame rate (fps)' }),
      ).toContainText('30 fps');
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
      expect(
        await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await dialog.getByLabel('Project name').fill('Default project');
      await dialog
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      expect(await snapshot(page, base)).toMatchObject({
        width: 1920,
        height: 1080,
        frameRate: { num: 30, den: 1 },
      });
    });
  });
}
