import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

async function create(page: Page) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'New project', exact: true })
    .click();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Mobile film with a deliberately long project name');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Add text', exact: true }),
  ).toBeVisible();
}
async function addText(page: Page) {
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Add text', exact: true })
    .getByRole('button', { name: 'Insert Plain text', exact: true })
    .click();
}
async function fits(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual((await page.viewportSize())!.width);
}
async function select(page: Page, name: RegExp) {
  await page.getByRole('combobox', { name: 'Select timeline clip' }).click();
  await page.getByRole('option', { name }).click();
}
for (const base of ['/', '/LocalCut/']) {
  test(`mobile touch editing, grouping, playback and media focus ${base}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base);
    await fits(page);
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    await expect(nav).toBeInViewport();
    const startup = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((r) => r.name),
    );
    expect(startup.some((url) => /editor\.js|ai\.js|worker/.test(url))).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath('mobile-empty.png') });
    await create(page);
    const bytes = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(160, 90);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 160, 90);
      return [
        ...new Uint8Array(
          await (
            await canvas.convertToBlob({ type: 'image/png' })
          ).arrayBuffer(),
        ),
      ];
    });
    await page.getByLabel('Import media', { exact: true }).setInputFiles([
      { name: 'first.png', mimeType: 'image/png', buffer: Buffer.from(bytes) },
      { name: 'second.png', mimeType: 'image/png', buffer: Buffer.from(bytes) },
    ]);
    await expect(page.locator('.timeline-clip')).toHaveCount(2);
    await fits(page);
    await select(page, /first.png/);
    await page
      .getByRole('button', { name: 'Clip properties', exact: true })
      .click();
    const properties = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await properties
      .getByLabel('Duration (seconds)', { exact: true })
      .fill('0.1');
    await properties
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(properties).toBeHidden();
    await page.getByRole('button', { name: 'Select multiple clips' }).click();
    await select(page, /second.png/);
    await expect(
      page.locator('.timeline-clip[aria-pressed="true"]'),
    ).toHaveCount(2);
    await page
      .getByRole('button', { name: 'Group clips', exact: true })
      .click();
    await expect(
      page.locator('.timeline-clip[data-grouped="true"]'),
    ).toHaveCount(2);
    await page
      .getByRole('button', { name: 'Ungroup clips', exact: true })
      .click();
    await expect(
      page.locator('.timeline-clip[data-grouped="true"]'),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.getByLabel('Video preview', { exact: true }).evaluate((canvas) => {
          const pixel = (canvas as HTMLCanvasElement)
            .getContext('2d')!
            .getImageData(480, 270, 1, 1).data;
          return pixel[0]! > 220 && pixel[1]! < 30;
        }),
      )
      .toBe(true);
    await page
      .getByRole('button', { name: 'Play preview', exact: true })
      .click();
    await expect
      .poll(async () =>
        Number(
          await page
            .getByRole('slider', { name: 'Playhead position' })
            .inputValue(),
        ),
      )
      .toBeGreaterThan(0);
    await page
      .getByRole('button', { name: 'Pause preview', exact: true })
      .click();
    const sizing = await page
      .locator(
        '.workspace-header button, .mobile-navigation button, .playback-controls button',
      )
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          label: n.getAttribute('aria-label') || n.textContent,
          width: n.getBoundingClientRect().width,
          height: n.getBoundingClientRect().height,
        })),
      );
    for (const target of sizing) {
      expect(target.width, String(target.label)).toBeGreaterThanOrEqual(44);
      expect(target.height, String(target.label)).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: info.outputPath('mobile-editor.png'),
      fullPage: true,
    });
    const mediaTrigger = nav.getByRole('button', { name: 'Expand media' });
    await mediaTrigger.click();
    const media = page.getByRole('dialog', {
      name: 'Media library',
      exact: true,
    });
    await expect(media).toBeInViewport();
    const mediaBounds = (await media.boundingBox())!;
    expect(mediaBounds.y).toBeGreaterThanOrEqual(0);
    expect(mediaBounds.y + mediaBounds.height).toBeLessThanOrEqual(740);
    await expect(media.getByText('first.png', { exact: true })).toBeVisible();
    await expect
      .poll(() => media.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() => media.evaluate((el) => el.contains(document.activeElement)))
        .toBe(true);
    }
    await page.screenshot({ path: info.outputPath('mobile-media.png') });
    await page.keyboard.press('Escape');
    await expect(media).toBeHidden();
    await expect(mediaTrigger).toBeFocused();
    // A retained, closed media modal must not block the shared viewport owner.
    const timeline = page.locator('.timeline-viewport');
    await timeline.scrollIntoViewIfNeeded();
    const initialWidth = await timeline.evaluate((el) => el.scrollWidth);
    const box = (await timeline.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 18);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -140);
    await page.keyboard.up('Control');
    await expect
      .poll(() => timeline.evaluate((el) => el.scrollWidth))
      .toBeGreaterThan(initialWidth * 1.5);
    await timeline.focus();
    await page.keyboard.press('0');
    await expect
      .poll(() => timeline.evaluate((el) => el.scrollWidth))
      .toBe(initialWidth);
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Collapse chat', exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Connect AI', exact: true }),
    ).toBeInViewport();
    await nav.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(
      page.getByRole('main', { name: 'Video editor' }),
    ).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Play preview', exact: true }),
    ).toBeInViewport();
    for (const close of await page
      .getByRole('button', { name: 'Close toast', exact: true })
      .all())
      await close.click();
    await page.screenshot({ path: info.outputPath('mobile-editor-start.png') });
  });

  test(`mobile dialogs, landscape, reflow and desktop preference preservation ${base}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await create(page);
    await addText(page);
    const properties = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(properties).toBeVisible();
    await properties
      .getByRole('button', { name: 'Apply properties', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      properties.getByRole('button', { name: 'Apply properties', exact: true }),
    ).toBeInViewport();
    await properties
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await fits(page);
    await expect(
      page.getByRole('navigation', { name: 'Workspace sections' }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('mobile-landscape.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 740 });
    // Browser text enlargement, independent of the responsive viewport.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Open project', exact: true }),
    ).toBeInViewport();
    await page
      .getByRole('menuitem', { name: 'Open project', exact: true })
      .click();
    await fits(page);
    const browser = page.getByRole('main', { name: 'Projects' });
    await expect(
      browser.getByRole('textbox', { name: 'Search projects' }),
    ).toBeVisible();
    const actionSizes = await browser
      .locator('.project-browser-actions button')
      .evaluateAll((nodes) =>
        nodes.map((n) => ({ scroll: n.scrollHeight, height: n.clientHeight })),
      );
    for (const action of actionSizes)
      expect(action.scroll).toBeLessThanOrEqual(action.height);
    await page.screenshot({
      path: info.outputPath('mobile-projects-text-200.png'),
      fullPage: true,
    });
    await browser
      .getByRole('button', { name: 'Back to editor', exact: true })
      .click();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Appearance', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Close appearance', exact: true }),
    ).toBeVisible();
    await fits(page);
    const colors = await page
      .locator('.appearance-swatches button')
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          left: n.getBoundingClientRect().left,
          right: n.getBoundingClientRect().right,
          width: n.getBoundingClientRect().width,
          height: n.getBoundingClientRect().height,
        })),
      );
    for (const color of colors) {
      expect(color.right).toBeLessThanOrEqual(320);
      expect(color.left).toBeGreaterThanOrEqual(0);
      expect(color.width).toBeGreaterThanOrEqual(44);
      expect(color.height).toBeGreaterThanOrEqual(44);
    }
    await page
      .getByRole('button', { name: 'Close appearance', exact: true })
      .click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await page
      .getByRole('separator', { name: 'Resize workspace chat' })
      .press('End');
    const before = await page.evaluate(() =>
      localStorage.getItem('localcut.workspace-preferences.v1'),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('dialog', { name: 'Media library', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Collapse media', exact: true })
      .click();
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.workspace-preferences.v1'),
      ),
    ).toBe(before);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(
      page.getByRole('button', { name: 'Collapse media', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('separator', { name: 'Resize workspace chat' }),
    ).toHaveAttribute('aria-valuenow', '560');
    await expect(
      page.getByRole('navigation', { name: 'Workspace sections' }),
    ).toBeHidden();
  });
}

test('touch tablet controls fit with media and multi-selection open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/LocalCut/');
  await create(page);
  for (let i = 0; i < 2; i++) {
    await addText(page);
    await page
      .getByRole('dialog', { name: 'Clip properties', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
  }
  await page.getByRole('button', { name: 'Expand media', exact: true }).click();
  await page.getByRole('button', { name: 'Select multiple clips' }).click();
  await page.getByRole('combobox', { name: 'Select timeline clip' }).click();
  await page.getByRole('option').first().click();
  const editor = (await page
    .getByRole('main', { name: 'Video editor' })
    .boundingBox())!;
  const buttons = await page
    .locator('.timeline-toolbar button')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().right),
    );
  for (const right of buttons)
    expect(right).toBeLessThanOrEqual(editor.x + editor.width);
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Appearance', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Close appearance' }),
  ).toBeVisible();
  const colors = await page
    .locator('.appearance-swatches button')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        right: node.getBoundingClientRect().right,
        width: node.getBoundingClientRect().width,
      })),
    );
  for (const color of colors) {
    expect(color.right).toBeLessThanOrEqual(768);
    expect(color.width).toBeGreaterThanOrEqual(44);
  }
  await fits(page);
});

test('media focus follows the mounted trigger across both breakpoints', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/LocalCut/');
  await create(page);
  await page.getByRole('button', { name: 'Expand media', exact: true }).click();
  await page
    .getByRole('button', { name: 'Collapse media', exact: true })
    .focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#desktop-media-trigger')).toBeFocused();
  await page.locator('#desktop-media-trigger').click();
  const desktop = page.locator('#desktop-media-trigger');
  await expect(desktop).toHaveAttribute('aria-expanded', 'true');
  await desktop.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#mobile-media-trigger')).toBeFocused();
});

test.describe('fine-pointer responsive selection', () => {
  test.use({ hasTouch: false });
  test('touch multi-selection resets when its control disappears', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/LocalCut/');
    await create(page);
    for (let i = 0; i < 3; i++) {
      await addText(page);
      await page
        .getByRole('dialog', { name: 'Clip properties', exact: true })
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      // Keep pointer targets separate; overlapping text clips intentionally
      // share a lane and cannot all receive a pointer click at the same time.
      await page
        .getByRole('slider', { name: 'Playhead position' })
        .press('End');
    }
    await page.getByRole('button', { name: 'Select multiple clips' }).click();
    await page.getByRole('combobox', { name: 'Select timeline clip' }).click();
    await page.getByRole('option').first().click();
    const clips = page.locator('.timeline-clip');
    const selected = page.locator('.timeline-clip[aria-pressed="true"]');
    await expect(selected).toHaveCount(2);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(
      page.getByRole('button', { name: 'Select multiple clips' }),
    ).toBeHidden();
    await clips.nth(1).press('Enter');
    await expect(selected).toHaveCount(1);
    await clips.nth(0).click();
    await expect(selected).toHaveCount(1);
    await clips.nth(1).click({ modifiers: ['Shift'] });
    await expect(selected).toHaveCount(2);
    await clips.nth(2).click({ modifiers: ['ControlOrMeta'] });
    await expect(selected).toHaveCount(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('button', { name: 'Select multiple clips' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
