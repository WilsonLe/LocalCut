import { expect, test, type Locator, type Page } from '@playwright/test';
import { openAISettings } from './workspace-settings-helper';

async function wheel(page: Page, target: Locator, delta: number) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, delta);
}

async function positions(page: Page) {
  return page.evaluate(() => ({
    page: window.scrollY,
    workspace: document.querySelector('.workspace-body')!.scrollTop,
    header: document.querySelector('.workspace-header')!.getBoundingClientRect()
      .top,
  }));
}

for (const base of ['/', '/LocalCut/']) {
  for (const interfaceSize of ['default', 'small', 'large']) {
    test(`app and popup scrolling stay contained at ${interfaceSize} interface size ${base}`, async ({
      page,
      context,
    }, info) => {
      await page.addInitScript((interfaceSize) => {
        localStorage.setItem(
          'localcut.appearance.v1',
          JSON.stringify({
            version: 1,
            preferences: { interfaceSize },
          }),
        );
      }, interfaceSize);
      await context.route('https://openrouter.ai/api/v1/models', (route) =>
        route.fulfill({
          headers: { 'access-control-allow-origin': '*' },
          json: {
            data: Array.from({ length: 80 }, (_, i) => ({
              id: `test/model-${i}`,
              name: `Scroll model ${String(i).padStart(2, '0')}`,
              context_length: 32000,
              supported_parameters: ['tools', 'tool_choice'],
            })),
          },
        }),
      );
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 500 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(base);
        await expect(page.locator('.editing-area')).toBeVisible();
        const body = page.locator('.workspace-body');
        if (viewport.width < 900) {
          await wheel(page, body, 600);
          await expect
            .poll(() => body.evaluate((el) => el.scrollTop))
            .toBeGreaterThan(0);
        }
        await page.evaluate(() => window.scrollTo(0, 1000));
        expect((await positions(page)).page).toBe(0);

        await page
          .getByRole('button', { name: 'Workspace settings', exact: true })
          .click();
        await page.getByRole('menuitem', { name: 'View', exact: true }).click();
        await page
          .getByRole('menuitem', { name: 'Keyboard shortcuts', exact: true })
          .click();
        const shortcuts = page.getByRole('dialog', {
          name: 'Keyboard shortcuts',
          exact: true,
        });
        await expect(shortcuts).toBeVisible();
        await shortcuts.evaluate((el) =>
          Promise.all(
            el.getAnimations().map((animation) => animation.finished),
          ),
        );
        const bounds = (await shortcuts.boundingBox())!;
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
        const before = await positions(page);
        await wheel(page, shortcuts, 600);
        await expect
          .poll(() => shortcuts.evaluate((el) => el.scrollTop))
          .toBeGreaterThan(0);
        await shortcuts.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await wheel(page, shortcuts, 900);
        // Let the next browser frame apply wheel scrolling before measuring its boundary.
        await page.evaluate(() => new Promise(requestAnimationFrame));
        expect(await positions(page)).toEqual(before);
        expect((await shortcuts.boundingBox())!.height).toBeCloseTo(
          bounds.height,
          0,
        );
        if (interfaceSize === 'default')
          await page.screenshot({
            path: info.outputPath(`shortcuts-${viewport.width}.png`),
          });
        await page.keyboard.press('Escape');
        await expect(shortcuts).toBeHidden();

        await openAISettings(page);
        const dialog = page.getByRole('dialog', {
          name: 'AI connection',
          exact: true,
        });
        await expect(dialog).toBeVisible();
        const add = dialog.getByRole('button', {
          name: 'Add OpenRouter',
          exact: true,
        });
        if (await add.isVisible()) await add.click();
        await dialog.evaluate((el) =>
          Promise.all(
            el.getAnimations().map((animation) => animation.finished),
          ),
        );
        const height = (await dialog.boundingBox())!.height;
        await dialog
          .getByLabel('OpenRouter API key', { exact: true })
          .fill('synthetic-scroll-key');
        await dialog
          .getByRole('button', { name: 'Use API key', exact: true })
          .click();
        const models = dialog.getByRole('combobox', {
          name: 'AI model',
          exact: true,
        });
        await expect(models).toBeEnabled();
        expect((await dialog.boundingBox())!.height).toBeCloseTo(height, 0);
        await models.click();
        const list = page.locator('[data-slot="combobox-list"]');
        await expect(list).toBeVisible();
        const dialogBefore = await dialog.evaluate((el) =>
          Array.from(el.querySelectorAll('*')).map((child) => child.scrollTop),
        );
        const workspaceBefore = await positions(page);
        await wheel(page, list, 400);
        await expect
          .poll(() => list.evaluate((el) => el.scrollTop))
          .toBeGreaterThan(0);
        await list.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await wheel(page, list, 1000);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        expect(
          await dialog.evaluate((el) =>
            Array.from(el.querySelectorAll('*')).map(
              (child) => child.scrollTop,
            ),
          ),
        ).toEqual(dialogBefore);
        expect(await positions(page)).toEqual(workspaceBefore);
        await page.keyboard.press('Escape');
        await dialog
          .getByRole('button', { name: 'Remove OpenRouter', exact: true })
          .click();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(
          page.getByRole('button', { name: 'Workspace settings', exact: true }),
        ).toBeFocused();
      }
    });
  }
}
