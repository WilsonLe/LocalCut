import { behaviorBases } from './coverage-bases';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ hasTouch: true });

async function hold(page: Page, tool: Locator, label: string) {
  await tool.scrollIntoViewIfNeeded();
  const rect = (await tool.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      ],
    });
    const tooltip = page.locator('[data-slot="touch-tooltip"]');
    await expect(tooltip).toHaveText(label);
    const box = (await tooltip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(
      (await page.viewportSize())!.width,
    );
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

for (const base of behaviorBases) {
  test(`mobile inline clip picker and tool hold preserve tap and selection ${base}`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    const id = await page.evaluate(async (base) => {
      const { createEditor } = await import(`${base}editor.js`);
      const editor = await createEditor();
      try {
        return (await editor.projects.create('Touch tools')).id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    const addText = page.getByRole('button', { name: 'Add text', exact: true });
    // Hold an existing tooltip-wrapped action without opening its dialog.
    await hold(page, addText, 'Add text');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await addText.tap();
    await page
      .getByRole('button', { name: 'Insert Plain text', exact: true })
      .tap();
    await expect(
      page.getByRole('dialog', { name: 'Clip properties', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.timeline-clip')).toHaveCount(1);
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    const picker = page.getByRole('combobox', { name: 'Select timeline clip' });
    for (const width of [320, 390, 590]) {
      await page.setViewportSize({ width, height: 844 });
      await undo.scrollIntoViewIfNeeded();
      const boxes = await Promise.all([
        undo.boundingBox(),
        picker.boundingBox(),
      ]);
      expect(
        Math.abs(
          boxes[0]!.y +
            boxes[0]!.height / 2 -
            boxes[1]!.y -
            boxes[1]!.height / 2,
        ),
      ).toBeLessThan(2);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await hold(page, undo, 'Undo');
    await expect(page.locator('.timeline-clip')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('inline-toolbar-hold.png') });
    await undo.tap();
    await expect(page.locator('.timeline-clip')).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).tap();
    await expect(page.locator('.timeline-clip')).toHaveCount(1);
    await hold(page, picker, 'Select timeline clip');
    await expect(picker).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await picker.tap();
    await expect(picker).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.getByRole('option').first().tap();
    await expect(
      page.locator('.timeline-clip[aria-pressed="true"]'),
    ).toHaveCount(1);

    // Cancellation, movement and scrolling retire pending help.
    for (const cancel of ['pointercancel', 'pointermove', 'scroll'] as const) {
      await undo.dispatchEvent('pointerdown', {
        pointerType: 'touch',
        pointerId: 7,
        button: 0,
        clientX: 20,
        clientY: 20,
      });
      if (cancel === 'scroll')
        await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
      else
        await undo.dispatchEvent(cancel, {
          pointerType: 'touch',
          pointerId: 7,
          clientX: 50,
          clientY: 20,
        });
      await page.waitForTimeout(600);
      await expect(page.locator('[data-slot="touch-tooltip"]')).toHaveCount(0);
      await undo.dispatchEvent('pointerup', {
        pointerType: 'touch',
        pointerId: 7,
      });
    }
    await undo.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 7,
      button: 0,
    });
    await undo.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 8,
      button: 0,
    });
    await page.waitForTimeout(600);
    await expect(page.locator('[data-slot="touch-tooltip"]')).toHaveCount(0);
    await undo.dispatchEvent('pointercancel', {
      pointerType: 'touch',
      pointerId: 7,
    });
    await undo.dispatchEvent('pointercancel', {
      pointerType: 'touch',
      pointerId: 8,
    });

    await hold(
      page,
      page.getByRole('button', { name: 'Preview settings', exact: true }),
      '1920 × 1080 · 30 fps',
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot="touch-tooltip"]')).toHaveCount(0);
    const media = page.getByRole('button', {
      name: 'Expand media',
      exact: true,
    });
    await hold(page, media, 'Expand media');
    await media.tap();
    const folder = page.getByRole('button', {
      name: 'New folder',
      exact: true,
    });
    await hold(page, folder, 'New folder');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('button', { name: 'Edit', exact: true })
      .tap();

    // Popup controls keep their ordinary taps, including when portalled.
    const settings = page.getByRole('button', {
      name: 'Workspace settings',
      exact: true,
    });
    await hold(page, settings, 'Workspace settings');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await settings.tap();
    const shortcuts = page.getByRole('menuitem', {
      name: 'Keyboard shortcuts',
      exact: true,
    });
    await hold(page, shortcuts, 'Keyboard shortcuts');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await shortcuts.tap();
    const close = page.getByRole('button', { name: 'Close', exact: true });
    await hold(page, close, 'Close');
    await expect(page.getByRole('dialog')).toBeVisible();
    await close.tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Tabs and Excalidraw's own labeled tools share the hold behavior.
    const storyboard = page.getByRole('tab', {
      name: 'Storyboard',
      exact: true,
    });
    await hold(page, storyboard, 'Storyboard');
    await expect(page.locator('.storyboard canvas.interactive')).toHaveCount(0);
    await storyboard.tap();
    await expect(page.locator('.storyboard canvas.interactive')).toBeVisible();
    const rectangle = page
      .getByRole('radio', { name: /Rectangle/ })
      .locator('..');
    await expect(rectangle).toBeVisible();
    const label = await rectangle.getAttribute('title');
    expect(label).toBeTruthy();
    await hold(page, rectangle, label!);
    await expect(rectangle.locator('input')).not.toBeChecked();
    await rectangle.tap();
    await expect(rectangle.locator('input')).toBeChecked();
    await page.getByRole('tab', { name: 'Editor', exact: true }).tap();

    // Existing desktop hover/focus remains intact.
    await page.setViewportSize({ width: 1280, height: 900 });
    await addText.hover();
    await expect(
      page.getByRole('tooltip', { name: 'Add text', exact: true }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Snapping', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(addText).toBeFocused();
    await expect(
      page.getByRole('tooltip', { name: 'Add text', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
