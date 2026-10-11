import { dragPlayhead } from './workspace-playhead-helper';
import { openAISettings } from './workspace-settings-helper';
import { expect, test, type Page } from '@playwright/test';

const key = 'localcut.appearance.v1';
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
async function aligned(page: Page) {
  await expect
    .poll(() =>
      page.locator('.timeline').evaluate((node) => {
        const editor = document
          .querySelector('.editing-area')!
          .getBoundingClientRect();
        return Math.abs(node.getBoundingClientRect().bottom - editor.bottom);
      }),
    )
    .toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
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
}

for (const base of ['/', '/LocalCut/']) {
  test(
    '@journey ' +
      [
        `interface size keeps timeline anchored, popups reachable and preferences durable ${base}`,
        `interface size preserves scaled seeking, view gestures, chat resizing and page zoom guard ${base}`,
      ].join(' | '),
    async ({ page, context }) => {
      await test.step(`interface size keeps timeline anchored, popups reachable and preferences durable ${base}`, async () => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(base);
        // A legacy appearance record retains its existing choices.
        await page.evaluate(
          (key) =>
            localStorage.setItem(
              key,
              JSON.stringify({ version: 1, preferences: { theme: 'blue' } }),
            ),
          key,
        );
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute(
          'data-interface-size',
          'default',
        );
        const other = await context.newPage();
        await other.goto(base);
        for (const [size, label, scale] of sizes) {
          await page.setViewportSize({ width: 1440, height: 900 });
          await openAppearance(page);
          await choose(page, label);
          await Promise.all([
            expect(other.locator('html')).toHaveAttribute(
              'data-interface-size',
              size,
            ),
            expect(
              page.getByRole('combobox', { name: 'Interface size' }),
            ).toContainText(label),
          ]);
          await page.getByRole('button', { name: 'Close appearance' }).click();
          await aligned(page);
          const header = await page.locator('.workspace-header').boundingBox();
          expect(header!.height).toBeCloseTo(64 * scale, 0);
          await page.screenshot({
            path: `.artifacts/interface-${size}-${base === '/' ? 'root' : 'pages'}.png`,
          });
          // Reduced browser zoom expands the CSS layout viewport.
          await page.setViewportSize({ width: 1920, height: 1200 });
          await aligned(page);
          await page.reload();
          await expect(page.locator('html')).toHaveAttribute(
            'data-interface-size',
            size,
          );
          await aligned(page);
          for (const viewport of [
            { width: 900, height: 700 },
            { width: 320, height: 844 },
          ]) {
            await page.setViewportSize(viewport);
            await openAppearance(page);
            await page
              .getByRole('combobox', { name: 'Interface size' })
              .click();
            const popup = page.getByRole('listbox');
            await expect(popup).toBeVisible();
            const box = (await popup.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(-1);
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
            expect(box.y).toBeGreaterThanOrEqual(-1);
            expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
            await page.keyboard.press('Escape');
            await page
              .getByRole('button', { name: 'Close appearance' })
              .click();
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(viewport.width);
            await page
              .getByRole('main', { name: 'Video editor', exact: true })
              .press('n');
            const dialog = page.getByRole('dialog', {
              name: 'New project',
              exact: true,
            });
            await expect(dialog).toBeVisible();
            const dialogBounds = (await dialog.boundingBox())!;
            expect(dialogBounds.x).toBeGreaterThanOrEqual(-1);
            expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(
              viewport.width + 1,
            );
            expect(dialogBounds.y).toBeGreaterThanOrEqual(-1);
            expect(dialogBounds.y + dialogBounds.height).toBeLessThanOrEqual(
              viewport.height + 1,
            );
            await expect(
              dialog.getByRole('button', {
                name: 'Create project',
                exact: true,
              }),
            ).toBeInViewport();
            await page.keyboard.press('Escape');
            await expect(dialog).not.toBeVisible();
            const navigation = page.getByRole('navigation', {
              name: 'Workspace sections',
            });
            if (await navigation.isVisible())
              await navigation
                .getByRole('button', { name: 'Chat', exact: true })
                .click();
            await page
              .getByRole('button', { name: 'Chat sessions', exact: true })
              .click();
            const sessions = page.getByRole('menu', {
              name: 'Chat sessions',
              exact: true,
            });
            await expect(sessions).toBeVisible();
            const sessionBounds = (await sessions.boundingBox())!;
            expect(sessionBounds.x).toBeGreaterThanOrEqual(-1);
            expect(sessionBounds.x + sessionBounds.width).toBeLessThanOrEqual(
              viewport.width + 1,
            );
            await expect(
              sessions.getByRole('menuitem', {
                name: 'New conversation',
                exact: true,
              }),
            ).toBeInViewport();
            await sessions
              .getByRole('menuitem', { name: 'New conversation', exact: true })
              .click();
            await expect(sessions).not.toBeVisible();
            await openAISettings(page);
            const connection = page.getByRole('dialog', {
              name: 'AI connection',
              exact: true,
            });
            await connection
              .getByRole('button', { name: 'Data & analytics', exact: true })
              .click();
            const analytics = page
              .locator('[data-slot="popover-content"]')
              .filter({
                has: page.getByText(
                  'Optional project context for configured LLM providers.',
                  { exact: true },
                ),
              });
            await expect(analytics).toBeVisible();
            const analyticsBounds = (await analytics.boundingBox())!;
            expect(analyticsBounds.x).toBeGreaterThanOrEqual(-1);
            expect(
              analyticsBounds.x + analyticsBounds.width,
            ).toBeLessThanOrEqual(viewport.width + 1);
            await page.keyboard.press('Escape');
            await page.keyboard.press('Escape');
            await expect(connection).not.toBeVisible();
            if (await navigation.isVisible())
              await navigation
                .getByRole('button', { name: 'Edit', exact: true })
                .click();
          }
        }
        await openAppearance(page);
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await expect(other.locator('html')).toHaveAttribute(
          'data-interface-size',
          'default',
        );
        expect(
          await page.evaluate((key) => localStorage.getItem(key), key),
        ).toBeNull();
        await other.close();
      });
      await page
        .getByRole('button', { name: 'Close appearance', exact: true })
        .click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await test.step(`interface size preserves scaled seeking, view gestures, chat resizing and page zoom guard ${base}`, async () => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width: 1440, height: 900 });
        await prepareProject(page, base, false);
        const slider = page.getByRole('slider', {
          name: 'Playhead position',
          exact: true,
        });
        await expect(slider).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        for (const [size, label, scale] of sizes) {
          await openAppearance(page);
          await choose(page, label);
          await page.getByRole('button', { name: 'Close appearance' }).click();
          await aligned(page);
          await page
            .getByRole('main', { name: 'Video editor', exact: true })
            .press('ControlOrMeta+e');
          const exportDialog = page.getByRole('dialog', {
            name: 'Export video',
            exact: true,
          });
          await exportDialog
            .getByRole('combobox', { name: 'Format', exact: true })
            .click();
          await page.getByRole('option', { name: 'MP4', exact: true }).click();
          // A closed nested portal must leave the parent dialog clickable.
          await exportDialog
            .getByRole('button', { name: 'Close', exact: true })
            .first()
            .click();
          await expect(exportDialog).not.toBeVisible();
          await page.getByLabel('Timeline view', { exact: true }).press('0');
          await dragPlayhead(page, 0.5);
          await expect
            .poll(async () =>
              Number(await slider.getAttribute('aria-valuenow')),
            )
            .toBeGreaterThan(2_400_000);
          expect(
            Number(await slider.getAttribute('aria-valuenow')),
          ).toBeLessThan(2_600_000);
          const resize = page.getByRole('separator', {
            name: 'Resize workspace chat',
          });
          await resize.press('Home');
          await expect(resize).toHaveAttribute('aria-valuetext', '280 pixels');
          const handle = (await resize.boundingBox())!;
          await page.mouse.move(handle.x + handle.width / 2, handle.y + 30);
          await page.mouse.down();
          await page.mouse.move(
            handle.x + handle.width / 2 - 80 * scale,
            handle.y + 30,
            { steps: 5 },
          );
          await page.mouse.up();
          await expect(resize).toHaveAttribute('aria-valuetext', '360 pixels');
          // The same view anchor under the pointer survives wheel zoom and middle-button pan.
          await expect(
            page.locator('[role="listbox"], [role="menu"]'),
          ).toHaveCount(0);
          const viewport = page.getByLabel('Timeline view', { exact: true });
          await viewport.focus();
          await page.keyboard.press('0');
          const box = (await viewport.boundingBox())!;
          const x = box.x + box.width * 0.6;
          await page.mouse.move(x, box.y + 30);
          await page.keyboard.down('Control');
          await page.mouse.wheel(0, -160);
          await page.keyboard.up('Control');
          await expect
            .poll(() => viewport.evaluate((node) => node.scrollLeft))
            .toBeGreaterThan(20);
          const zoomed = await viewport.evaluate((node) => node.scrollLeft);
          await page.mouse.down({ button: 'middle' });
          await page.mouse.move(x - 30 * scale, box.y + 30, { steps: 3 });
          await page.mouse.up({ button: 'middle' });
          await expect
            .poll(() => viewport.evaluate((node) => node.scrollLeft))
            .toBeGreaterThan(zoomed + 25);
          const guard = await page.evaluate(() => {
            const target = document.querySelector('.workspace-header')!;
            const events = [
              new KeyboardEvent('keydown', {
                key: '-',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
              }),
              new WheelEvent('wheel', {
                ctrlKey: true,
                deltaY: 40,
                bubbles: true,
                cancelable: true,
              }),
              new WheelEvent('wheel', {
                deltaY: 40,
                bubbles: true,
                cancelable: true,
              }),
            ];
            return events.map((event) => {
              target.dispatchEvent(event);
              return event.defaultPrevented;
            });
          });
          expect(guard).toEqual([true, true, false]);
          await page
            .getByRole('button', { name: 'Commands', exact: true })
            .focus();
          const dpr = await page.evaluate(() => devicePixelRatio);
          await page.keyboard.press('ControlOrMeta+-');
          expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr);
          await expect(page.locator('html')).toHaveAttribute(
            'data-interface-size',
            size,
          );
        }
      });
    },
  );
}

test.describe('scaled touch layouts', () => {
  test.use({ hasTouch: true });
  for (const base of ['/', '/LocalCut/']) {
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
