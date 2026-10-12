import { closeMediaImportAndPlace } from './workspace-import-helper';
import { dismissNotifications } from './workspace-notifications-helper';
import { selectAISettingsTab } from './workspace-settings-helper';
import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`unified media header keeps folder controls reachable on desktop and mobile ${base}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page.getByRole('main', { name: 'Video editor' }).focus();
    await page.keyboard.press('n');
    await page.getByLabel('Project name', { exact: true }).fill('Media header');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    const media = page.getByRole('region', { name: 'Project media' });
    const heading = media.locator('.section-heading');
    const names = [
      'Media root',
      'New folder',
      'Upload folder',
      'Open media Trash',
      'Record screen',
    ];
    for (const name of names) {
      await expect(
        heading.getByRole('button', { name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      heading.getByRole('button', { name: 'New folder', exact: true }),
    ).toBeEnabled();
    const title = (await heading
      .getByRole('heading', { name: 'Media', exact: true })
      .boundingBox())!;
    for (const name of names) {
      const box = (await heading
        .getByRole('button', { name, exact: true })
        .boundingBox())!;
      expect(
        Math.abs(box.y + box.height / 2 - title.y - title.height / 2),
      ).toBeLessThan(2);
    }
    const header = (await heading.boundingBox())!;
    const grid = (await media.locator('.media-grid').boundingBox())!;
    expect(grid.y - header.y - header.height).toBeGreaterThanOrEqual(0);
    expect(grid.y - header.y - header.height).toBeLessThanOrEqual(13);
    await page.screenshot({
      path: info.outputPath('unified-media-header-desktop.png'),
    });
    await heading
      .getByRole('button', { name: 'New folder', exact: true })
      .click();
    const creation = page.getByRole('dialog', {
      name: 'New folder',
      exact: true,
    });
    const folderName = 'A long folder name for captured footage';
    await creation.getByLabel('Name', { exact: true }).fill(folderName);
    await creation
      .getByRole('button', { name: 'New folder', exact: true })
      .click();
    await expect(creation).toBeHidden();
    await media
      .getByRole('button', { name: `Open folder ${folderName}`, exact: true })
      .click();
    const breadcrumb = heading.getByRole('button', {
      name: folderName,
      exact: true,
    });
    await expect(breadcrumb).toBeVisible();
    await breadcrumb.click();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page
        .getByRole('navigation', { name: 'Workspace sections' })
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
      await expect(breadcrumb).toBeVisible();
      await expect(
        heading.getByRole('button', {
          name: 'Workspace settings',
          exact: true,
        }),
      ).toBeVisible();
      const boxes = [];
      for (const button of await heading.getByRole('button').all()) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        boxes.push(bounds);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlapWidth =
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapHeight =
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(overlapWidth <= 0 || overlapHeight <= 0).toBe(true);
        }
      }
      expect(
        await media.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`unified-media-header-mobile-${width}.png`),
      });
    }
    await heading
      .getByRole('button', { name: 'Open media Trash', exact: true })
      .click();
    await expect(heading.getByText('Trash', { exact: true })).toBeVisible();
    await expect(
      heading.getByRole('button', { name: 'New folder', exact: true }),
    ).toHaveCount(0);
    await heading
      .getByRole('button', { name: 'Media root', exact: true })
      .click();
    await expect(breadcrumb).toHaveCount(0);
    await expect(
      heading.getByRole('button', { name: 'New folder', exact: true }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole('button', { name: 'Collapse media', exact: true })
      .click();
    await expect(media).toBeHidden();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(
      heading.getByRole('button', { name: 'Media root', exact: true }),
    ).toBeVisible();
  });

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
    await expect(chat).not.toContainText('Connect provider first');
    const providerEmpty = chat.locator('.chat-provider-empty');
    await expect(providerEmpty).toHaveAttribute('data-slot', 'empty');
    await expect(providerEmpty).toHaveText('Connect provider');
    await expect(
      providerEmpty.locator('.chat-provider-symbol svg'),
    ).toBeVisible();
    const stateBounds = (await providerEmpty.boundingBox())!;
    const sessionBounds = (await chat
      .locator('.conversation-empty-session')
      .boundingBox())!;
    expect(
      Math.abs(
        stateBounds.y +
          stateBounds.height / 2 -
          sessionBounds.y -
          sessionBounds.height / 2,
      ),
    ).toBeLessThan(2);
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
      /(?:^|\s)media-import-card(?:\s|$)/,
    );
    await expect(card.locator('.sr-only')).toHaveText('Import media');
    await expect(card.locator('.media-import-symbol')).toBeVisible();
    const importEmpty = media.locator('.media-import-card');
    await expect(importEmpty).toHaveAttribute('data-slot', 'empty');
    expect(
      await importEmpty.evaluate((el) => getComputedStyle(el).borderTopStyle),
    ).toBe('dashed');
    const emptyBounds = (await importEmpty.boundingBox())!;
    const actionBounds = (await card.boundingBox())!;
    expect(
      Math.abs(emptyBounds.width - actionBounds.width),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(emptyBounds.height - actionBounds.height),
    ).toBeLessThanOrEqual(2);
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
    await card.click({ position: { x: 4, y: 4 } });
    await (
      await chooser
    ).setFiles({
      name: 'card.png',
      mimeType: 'image/png',
      buffer: Buffer.from(image),
    });
    await closeMediaImportAndPlace(page);
    await expect(page.locator('.timeline-clip.image')).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(
      media.getByRole('button', { name: 'Asset details for card.png' }),
    ).toBeVisible();
    await expect(media.locator('.media-grid > :first-child')).toHaveClass(
      'media-item',
    );
    await expect(media.locator('.media-grid > :last-child')).toHaveClass(
      /(?:^|\s)media-import-card(?:\s|$)/,
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
    await dialog.getByRole('tab', { name: 'Providers', exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    await page.getByLabel('Name', { exact: true }).fill('Local model');
    await page
      .getByLabel('API base URL', { exact: true })
      .fill('http://localhost:1234/v1');
    await page
      .getByRole('button', { name: 'Connect endpoint', exact: true })
      .click();
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog.getByLabel('Local model llm route model').fill('local-editor');
    await selectAISettingsTab(page, 'LLM - Chat');
    await dialog.getByLabel('Local model llm route model').press('Tab');
    await selectAISettingsTab(page, 'LLM - Chat');
    await expect(
      dialog.getByLabel('Local model llm route model'),
    ).toBeEnabled();

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
