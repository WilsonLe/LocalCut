import { behaviorBases } from './coverage-bases';
import { closeMediaImportAndPlace } from './workspace-import-helper';
import { expect, test, type Page } from '@playwright/test';
const sizes = [
  ['default', 'Default (100%)', 1],
  ['small', 'Small (75%)', 0.75],
  ['large', 'Large (125%)', 1.25],
] as const;
async function openAppearance(page: Page) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Appearance', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Interface size' }),
  ).toBeVisible();
}
async function choose(page: Page, label: string) {
  await page.getByRole('combobox', { name: 'Interface size' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function prepareProject(page: Page, base: string, navigate = true) {
  if (navigate) await page.goto(base);
  await page
    .getByRole('main', { name: 'Video editor', exact: true })
    .press('n');
  await page.getByLabel('Project name', { exact: true }).fill('Sized project');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'New project', exact: true }),
  ).not.toBeVisible();
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(128, 72);
    canvas.getContext('2d')!.fillRect(0, 0, 128, 72);
    return [
      ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
    ];
  });
  await page.getByLabel('Import media', { exact: true }).setInputFiles({
    name: 'size.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png),
  });
  await closeMediaImportAndPlace(page);
}

test.describe('scaled touch layouts', () => {
  test.use({ hasTouch: true });
  for (const base of behaviorBases) {
    test(`interface size keeps playback reachable with expanded media on tablets ${base}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await prepareProject(page, base);
      for (const [size, label, scale] of sizes) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openAppearance(page);
        await choose(page, label);
        await page.getByRole('button', { name: 'Close appearance' }).click();
        for (const viewport of [
          { width: 768, height: 1024 },
          { width: 901, height: 700 },
        ]) {
          await page.setViewportSize(viewport);
          const narrow =
            viewport.width <= 750 * scale ||
            (viewport.width <= 1000 * scale && viewport.height <= 500 * scale);
          await expect(page.locator('html')).toHaveAttribute(
            'data-workspace-narrow',
            String(narrow),
          );
          const navigation = page.getByRole('navigation', {
            name: 'Workspace sections',
          });
          if (narrow) {
            await expect(navigation).toBeVisible();
            await navigation
              .getByRole('button', { name: 'Expand media', exact: true })
              .click();
            await expect(
              page.getByRole('complementary', {
                name: 'Media library',
                exact: true,
              }),
            ).toBeVisible();
            await page.keyboard.press('Escape');
            await navigation
              .getByRole('button', { name: 'Edit', exact: true })
              .click();
          } else {
            await expect(navigation).not.toBeVisible();
            const expand = page.getByRole('button', {
              name: 'Expand media',
              exact: true,
            });
            if (await expand.isVisible()) await expand.click();
            await expect(page.locator('.workspace')).toHaveAttribute(
              'data-media-open',
              'true',
            );
          }
          for (const name of [
            'Previous frame',
            'Play preview',
            'Next frame',
            'Preview settings',
          ]) {
            const control = page.getByRole('button', { name, exact: true });
            await control.scrollIntoViewIfNeeded();
            await expect
              .poll(() =>
                control.evaluate((element) => {
                  const rect = element.getBoundingClientRect();
                  const hit = document.elementFromPoint(
                    rect.x + rect.width / 2,
                    rect.y + rect.height / 2,
                  );
                  return element.contains(hit);
                }),
              )
              .toBe(true);
            const bounds = (await control.boundingBox())!;
            const editor = (await page.locator('.editing-area').boundingBox())!;
            expect(bounds.x).toBeGreaterThanOrEqual(editor.x);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(
              editor.x + editor.width + 1,
            );
          }
          const play = page.getByRole('button', {
            name: 'Play preview',
            exact: true,
          });
          await play.scrollIntoViewIfNeeded();
          const slider = page.getByRole('slider', {
            name: 'Playhead position',
            exact: true,
          });
          await slider.press('Home');
          await expect(slider).toHaveAttribute('aria-valuenow', '0');
          await play.tap();
          const pause = page.getByRole('button', {
            name: 'Pause preview',
            exact: true,
          });
          await expect(pause).toBeVisible();
          await pause.tap();
          await expect(play).toBeVisible();
          await slider.press('Home');
          const next = page.getByRole('button', {
            name: 'Next frame',
            exact: true,
          });
          await next.scrollIntoViewIfNeeded();
          await next.tap();
          await expect
            .poll(async () =>
              Number(await slider.getAttribute('aria-valuenow')),
            )
            .toBeGreaterThan(0);
          await page.screenshot({
            path: `.artifacts/interface-${size}-${viewport.width}-touch-${base === '/' ? 'root' : 'pages'}.png`,
          });
        }
      }
    });
  }
});
