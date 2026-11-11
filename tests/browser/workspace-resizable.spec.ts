import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';

for (const base of behaviorBases) {
  test(`editor and media resize, persist and synchronize without a chat panel ${base}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    const media = page.locator('#media-panel');
    const handle = page.getByRole('separator', {
      name: 'Resize media library',
      exact: true,
    });
    await expect(handle).toBeVisible();
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () => Math.round((await media.boundingBox())!.width))
      .toBe(316);
    const bounds = (await handle.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 70, bounds.y + 80, { steps: 10 });
    await page.mouse.up();
    const savedWidth = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
          .preferences.mediaWidth as number,
    );
    expect(savedWidth).toBeGreaterThan(350);
    const editor = (await page.locator('#editor-panel').boundingBox())!;
    expect(editor.x + editor.width).toBeGreaterThan(1435);
    await page.reload();
    await expect
      .poll(async () => Math.round((await media.boundingBox())!.width))
      .toBe(savedWidth);
    const second = await context.newPage();
    try {
      await second.goto(base);
      await page
        .getByRole('button', { name: 'Collapse media', exact: true })
        .click();
      await expect(
        second.getByRole('button', { name: 'Expand media', exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          Math.round(
            (await second.locator('#media-panel').boundingBox())!.width,
          ),
        )
        .toBe(52);
    } finally {
      await second.close();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    await nav
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Project media' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      nav.getByRole('button', { name: 'Expand media', exact: true }),
    ).toBeFocused();
    await expect(
      nav.getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
