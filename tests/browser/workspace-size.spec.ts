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

for (const base of ['/', '/LocalCut/']) {
  test(`interface size keeps timeline anchored, popups reachable and preferences durable ${base}`, async ({
    page,
    context,
  }) => {
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
      await expect(other.locator('html')).toHaveAttribute(
        'data-interface-size',
        size,
      );
      await expect(
        page.getByRole('combobox', { name: 'Interface size' }),
      ).toContainText(label);
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
        await page.getByRole('combobox', { name: 'Interface size' }).click();
        const popup = page.getByRole('listbox');
        await expect(popup).toBeVisible();
        const box = (await popup.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y).toBeGreaterThanOrEqual(-1);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Close appearance' }).click();
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
          dialog.getByRole('button', { name: 'Create project', exact: true }),
        ).toBeInViewport();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
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

  test(`interface size preserves scaled seeking, view gestures, chat resizing and page zoom guard ${base}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page
      .getByRole('main', { name: 'Video editor', exact: true })
      .press('n');
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Sized project');
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
      const scrubber = page.locator('.timeline-scrubber');
      const rect = (await scrubber.boundingBox())!;
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await expect
        .poll(async () => Number(await slider.inputValue()))
        .toBeGreaterThan(2_400_000);
      expect(Number(await slider.inputValue())).toBeLessThan(2_600_000);
      const resize = page.getByRole('separator', {
        name: 'Resize workspace chat',
      });
      await resize.press('Home');
      await expect(resize).toHaveAttribute('aria-valuenow', '280');
      const handle = (await resize.boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 30);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.width / 2 + 80 * scale,
        handle.y + 30,
        { steps: 5 },
      );
      await page.mouse.up();
      await expect(resize).toHaveAttribute('aria-valuenow', '360');
      // The same view anchor under the pointer survives wheel zoom and middle-button pan.
      await expect(page.locator('[role="listbox"], [role="menu"]')).toHaveCount(
        0,
      );
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
      await page.getByRole('button', { name: 'Commands', exact: true }).focus();
      const dpr = await page.evaluate(() => devicePixelRatio);
      await page.keyboard.press('ControlOrMeta+-');
      expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr);
      await expect(page.locator('html')).toHaveAttribute(
        'data-interface-size',
        size,
      );
    }
  });
}
