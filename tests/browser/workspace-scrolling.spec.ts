import { createWorkspace } from './workspace-project-helper';
import { behaviorBases } from './coverage-bases';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function wheel(page: Page, target: Locator, delta: number) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, delta);
}

async function positions(page: Page) {
  return page.evaluate(() => ({
    page: window.scrollY,
    workspace: document.querySelector('.workspace-body')!.scrollTop,
    editor: document.querySelector('#editor-panel')!.scrollTop,
    header: document
      .querySelector('.workspace-header, .mobile-edit-heading')!
      .getBoundingClientRect().top,
  }));
}

for (const base of behaviorBases) {
  for (const interfaceSize of ['default', 'small', 'large']) {
    test(`app and popup scrolling stay contained at ${interfaceSize} interface size ${base}`, async ({
      page,
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
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 500 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(base);
        await createWorkspace(page);
        await expect(page.locator('.editing-area')).toBeVisible();
        const editor = page.locator('#editor-panel');
        if (viewport.width < 900) {
          await wheel(page, editor, 600);
          await expect
            .poll(() => editor.evaluate((el) => el.scrollTop))
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
        await expect(
          shortcuts.getByRole('heading', { name: 'Playback and timeline' }),
        ).toBeVisible();
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
      }
    });
  }
}
