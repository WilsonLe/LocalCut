import { expect, test } from '@playwright/test';
import { openAISettings } from './workspace-settings-helper';

for (const base of ['/', '/LocalCut/']) {
  test(`workspace layout and sidebar drag collapse preserve state ${base}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    const media = page.locator('#workspace-media');
    const chat = page.getByRole('complementary', {
      name: 'Editing conversation',
    });
    const editor = page.locator('.editing-area');
    const boxes = await Promise.all([
      media.boundingBox(),
      editor.boundingBox(),
      chat.boundingBox(),
    ]);
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x);
    expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x);
    const settings = page.getByRole('button', {
      name: 'Workspace settings',
      exact: true,
    });
    const commands = page.getByRole('button', {
      name: 'Commands',
      exact: true,
    });
    const settingsBox = (await settings.boundingBox())!;
    const commandsBox = (await commands.boundingBox())!;
    expect(settingsBox.x).toBeGreaterThan(1350);
    expect(commandsBox.x + commandsBox.width).toBeLessThan(settingsBox.x);
    await expect(
      chat.getByRole('button', { name: /AI settings|Connect AI/ }),
    ).toHaveCount(0);
    const composer = chat.getByRole('textbox', { name: 'Describe your edit' });
    await composer.evaluate((element) => {
      (window as unknown as { originalComposer: Element }).originalComposer =
        element;
    });
    for (const [name, panel, direction, collapsed, expanded, field] of [
      [
        'Resize media library',
        media,
        -1,
        'Expand media',
        'Collapse media',
        'mediaWidth',
      ],
      [
        'Resize workspace chat',
        chat,
        1,
        'Expand chat',
        'Collapse chat',
        'chatWidth',
      ],
    ] as const) {
      const handle = page.getByRole('separator', { name, exact: true });
      const width = Math.round((await panel.boundingBox())!.width);
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2,
        y = box.y + 100;
      await page.mouse.move(x, y);
      await page.mouse.down();
      // Below expanded minimum, but above collapse threshold: remains open.
      await page.mouse.move(x + direction * (width - 190), y, { steps: 6 });
      await expect(panel).toHaveAttribute('data-collapsed', 'false');
      await page.mouse.move(x + direction * (width - 100), y, { steps: 6 });
      await page.mouse.up();
      await expect(panel).toHaveAttribute('data-collapsed', 'true');
      await expect
        .poll(async () => Math.round((await panel.boundingBox())!.width))
        .toBe(52);
      await expect(
        page.getByRole('button', { name: collapsed, exact: true }),
      ).toBeFocused();
      const prefs = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('localcut.workspace-preferences.v1')!)
            .preferences,
      );
      expect(prefs[field]).toBe(width);
      if (field === 'chatWidth') expect(prefs.chatCollapsed).toBe(true);
      else expect(prefs.mediaOpen).toBe(false);
      // Global settings remains usable while either sidebar is collapsed.
      await openAISettings(page);
      await expect(
        page.getByRole('dialog', { name: 'AI connection', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(settings).toBeFocused();
      await page.getByRole('button', { name: collapsed, exact: true }).click();
      await expect(
        page.getByRole('button', { name: expanded, exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () => Math.round((await panel.boundingBox())!.width))
        .toBe(width);
    }
    expect(
      await composer.evaluate(
        (element) =>
          (window as unknown as { originalComposer: Element })
            .originalComposer === element,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('workspace-light.png') });
    const star = page.getByRole('img', { name: 'Klip', exact: true });
    const light = await star.evaluate((el) => getComputedStyle(el).color);
    await settings.click();
    await page
      .getByRole('menuitem', { name: 'Appearance', exact: true })
      .click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page
      .getByRole('button', { name: 'Close appearance', exact: true })
      .click();
    await expect
      .poll(() => star.evaluate((el) => getComputedStyle(el).color))
      .not.toBe(light);
    await page.screenshot({ path: testInfo.outputPath('workspace-dark.png') });
    await page
      .getByRole('button', { name: 'Collapse chat', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Collapse media', exact: true })
      .click();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Expand chat', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Expand media', exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('button', { name: 'Expand chat', exact: true })
      .click();
    expect((await chat.boundingBox())!.y).toBeGreaterThan(
      (await editor.boundingBox())!.y,
    );
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`AI settings queues a cold-load request while chat is collapsed ${base}`, async ({
    page,
  }) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    await page.addInitScript(() =>
      localStorage.setItem(
        'localcut.workspace-preferences.v1',
        JSON.stringify({ version: 1, preferences: { chatCollapsed: true } }),
      ),
    );
    await page.route('**/Conversation-*.js', async (route) => {
      held = true;
      await barrier;
      await route.continue();
    });
    try {
      await page.goto(base);
      await expect.poll(() => held).toBe(true);
      await openAISettings(page);
      const dialog = page.getByRole('dialog', {
        name: 'AI connection',
        exact: true,
      });
      await expect(dialog).toHaveCount(0);
      release();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Workspace settings', exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole('button', { name: 'Expand chat', exact: true }),
      ).toBeVisible();
      await openAISettings(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCount(1);
    } finally {
      release();
    }
  });
}
