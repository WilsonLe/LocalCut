import { dismissNotifications } from './workspace-notifications-helper';
import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`compact workspace imports via card, backs up from settings and connects any chat provider ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    const paid: string[] = [];
    context.on('request', (request) => {
      if (/chat\/completions/.test(request.url())) paid.push(request.url());
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    const chat = page.locator('#workspace-chat');
    const connect = chat.getByRole('button', {
      name: 'Connect provider',
      exact: true,
    });
    await expect(connect).toBeVisible();
    await expect(chat).toContainText('Connect provider first');
    await expect(chat.getByRole('textbox')).toHaveCount(0);
    await expect(
      chat.getByRole('button', { name: 'Send edit request' }),
    ).toHaveCount(0);
    const header = (await page.locator('.workspace-header').boundingBox())!;
    expect(header.height).toBeLessThanOrEqual(50);
    await expect(
      page
        .locator('.workspace-header')
        .getByRole('button', { name: /^(Versions|Export)$/ }),
    ).toHaveCount(0);
    await connect.click();
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(connect).toBeFocused();
    const main = page.getByRole('main', { name: 'Video editor' });
    await main.focus();
    await page.keyboard.press('n');
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Compact workspace');
    await page.getByRole('button', { name: 'Create project' }).click();
    const text = page.getByRole('button', { name: 'Add text', exact: true });
    await expect(text).toBeVisible();
    expect(await text.innerText()).toBe('');
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    const media = page.getByRole('region', { name: 'Project media' });
    await expect(media).not.toContainText('Import video, audio or images');
    const heading = media.locator('.section-heading');
    const record = heading.getByRole('button', {
      name: 'Record screen',
      exact: true,
    });
    await expect(record).toBeVisible();
    await expect(heading).toHaveCSS('flex-direction', 'row');
    await expect(heading).toHaveCSS('border-bottom-width', '1px');
    const titleBounds = (await heading
      .getByRole('heading', { name: 'Media', exact: true })
      .boundingBox())!;
    const recordBounds = (await record.boundingBox())!;
    expect(
      Math.abs(
        titleBounds.y +
          titleBounds.height / 2 -
          recordBounds.y -
          recordBounds.height / 2,
      ),
    ).toBeLessThan(2);
    await expect(
      media.getByRole('button', { name: 'Backup', exact: true }),
    ).toHaveCount(0);
    const card = media.getByRole('button', {
      name: 'Import media',
      exact: true,
    });
    await expect(card).toBeVisible();
    await expect(media.locator('.media-grid > :last-child')).toHaveClass(
      'media-import-card',
    );
    await expect(card.locator('span')).toHaveClass('sr-only');
    expect(
      await card.evaluate((el) => getComputedStyle(el).borderTopStyle),
    ).toBe('dashed');
    const image = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(32, 32);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 32, 32);
      return [
        ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
      ];
    });
    const chooser = page.waitForEvent('filechooser');
    await card.click();
    await (
      await chooser
    ).setFiles({
      name: 'card.png',
      mimeType: 'image/png',
      buffer: Buffer.from(image),
    });
    await expect(page.locator('.timeline-clip.image')).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(
      media.getByRole('button', { name: 'Asset details for card.png' }),
    ).toBeVisible();
    await expect(media.locator('.media-grid > :first-child')).toHaveClass(
      'media-item',
    );
    await expect(media.locator('.media-grid > :last-child')).toHaveClass(
      'media-import-card',
    );
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    const download = page.waitForEvent('download');
    await page
      .getByRole('menuitem', { name: 'Download project backup', exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
    await dismissNotifications(page);
    await page.screenshot({
      path: testInfo.outputPath('compact-workspace-desktop.png'),
    });

    // A compatible endpoint works independently of OpenRouter, without a paid request.
    await connect.click();
    await dialog.getByText('Providers & services', { exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    await dialog.getByLabel('Name', { exact: true }).fill('Local model');
    await dialog
      .getByLabel('API base URL', { exact: true })
      .fill('http://localhost:1234/v1');
    await dialog
      .getByLabel('LLM model (must support tools)', { exact: true })
      .fill('local-editor');
    await dialog
      .getByRole('button', { name: 'Connect endpoint', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const composer = chat.getByRole('textbox', { name: 'Describe your edit' });
    await expect(composer).toBeEnabled();
    await composer.fill('Keep my draft');
    await page
      .getByRole('button', { name: 'Collapse chat', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Expand chat', exact: true })
      .click();
    await expect(composer).toHaveValue('Keep my draft');
    await page.reload();
    await expect(connect).toBeVisible(); // Compatible credentials stay session-only.
    await page.setViewportSize({ width: 390, height: 844 });
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(connect).toBeVisible();
    await expect(chat.getByRole('textbox')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('compact-workspace-mobile-chat.png'),
    });
    await nav
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath('compact-workspace-mobile-media.png'),
    });
    expect(paid).toHaveLength(0);
  });
}
