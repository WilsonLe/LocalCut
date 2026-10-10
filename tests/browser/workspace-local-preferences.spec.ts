import { expect, test, type Page } from '@playwright/test';

const key = 'localcut.workspace-preferences.v1';
const resize = (page: Page) =>
  page.getByRole('separator', { name: 'Resize workspace chat' });
async function preferences(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).preferences,
    key,
  );
}
async function menu(page: Page, group: string) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: group, exact: true }).click();
}
async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}
async function connect(page: Page) {
  await page
    .getByRole('button', { name: 'Connect AI', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'AI connection' });
  await dialog
    .getByLabel('OpenRouter API key', { exact: true })
    .fill('synthetic-preference-key');
  await dialog
    .getByRole('button', { name: 'Use API key', exact: true })
    .click();
  await expect(
    dialog.getByRole('combobox', { name: 'AI model', exact: true }),
  ).toBeEnabled();
  return dialog;
}

for (const base of ['/', '/LocalCut/']) {
  test(`workspace local preferences retain deliberate layout and export choices ${base}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await resize(page).press('ArrowRight');
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '336');
    const box = (await resize(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + 100, {
      steps: 4,
    });
    await page.mouse.up();
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '416');
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await menu(page, 'Export');
    await page
      .getByRole('menuitemradio', { name: 'WebM', exact: true })
      .click();
    await closeMenu(page);
    await page
      .getByRole('button', { name: 'Collapse chat', exact: true })
      .click();
    expect(await preferences(page)).toMatchObject({
      chatWidth: 416,
      chatCollapsed: true,
      mediaOpen: true,
      exportFormat: 'webm',
    });
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Expand chat', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Collapse media', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Expand chat', exact: true })
      .click();
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '416');
    await menu(page, 'Export');
    await expect(
      page.getByRole('menuitemradio', { name: 'WebM', exact: true }),
    ).toBeChecked();
    await closeMenu(page);
    // Responsive rendering must never rewrite the preferred desktop width.
    await page.setViewportSize({ width: 320, height: 844 });
    await page.reload();
    expect((await preferences(page)).chatWidth).toBe(416);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '416');
    await resize(page).press('End');
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '560');
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Appearance', exact: true })
      .click();
    await page.setViewportSize({ width: 1120, height: 900 });
    await expect
      .poll(async () =>
        Number(await resize(page).getAttribute('aria-valuenow')),
      )
      .toBeLessThan(560);
    expect((await preferences(page)).chatWidth).toBe(560);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    expect((await preferences(page)).chatWidth).toBe(560);
    await page
      .getByRole('button', { name: 'Close appearance', exact: true })
      .click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '560');
    await page.setViewportSize({ width: 901, height: 900 });
    await page.reload();
    await expect
      .poll(() =>
        page
          .locator('.editing-area')
          .evaluate((node) => node.getBoundingClientRect().width),
      )
      .toBeGreaterThanOrEqual(279);
    expect((await preferences(page)).chatWidth).toBe(560);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '560');
    await page.screenshot({
      path: `.artifacts/preferences-${base === '/' ? 'root' : 'pages'}.png`,
    });
    // Restoring preferences alone must not reopen the last editor or connect AI.
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    await expect(
      page.getByRole('button', { name: 'Connect AI', exact: true }).first(),
    ).toBeVisible();
  });

  test(`workspace local preferences synchronize tabs and preserve unrelated choices ${base}`, async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base);
    const second = await context.newPage();
    await second.emulateMedia({ reducedMotion: 'reduce' });
    await second.goto(base === '/' ? '/LocalCut/' : '/');
    await resize(page).press('ArrowRight');
    await expect(resize(second)).toHaveAttribute('aria-valuenow', '336');
    await menu(second, 'Export');
    await second
      .getByRole('menuitemradio', { name: 'WebM', exact: true })
      .click();
    await closeMenu(second);
    await page
      .getByRole('button', { name: 'Collapse chat', exact: true })
      .click();
    await expect(
      second.getByRole('button', { name: 'Expand chat', exact: true }),
    ).toBeVisible();
    expect(await preferences(second)).toMatchObject({
      chatWidth: 336,
      chatCollapsed: true,
      exportFormat: 'webm',
    });
    await page.evaluate(() =>
      localStorage.setItem('other-app.preference', 'keep'),
    );
    await second
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Collapse media', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem('other-app.preference')),
    ).toBe('keep');
    await second.evaluate((key) => localStorage.removeItem(key), key);
    await expect(
      page.getByRole('button', { name: 'Collapse chat', exact: true }),
    ).toBeVisible();
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '320');
    await expect(
      page.getByRole('button', { name: 'Expand media', exact: true }),
    ).toBeVisible();
    // A field patch must merge the latest disk value even before a storage event.
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await page.evaluate((key) => {
      const record = JSON.parse(localStorage.getItem(key)!);
      record.preferences.exportFormat = 'webm';
      localStorage.setItem(key, JSON.stringify(record));
    }, key);
    await resize(page).press('ArrowRight');
    expect(await preferences(page)).toMatchObject({
      chatWidth: 336,
      exportFormat: 'webm',
      mediaOpen: true,
    });
    await page.evaluate(
      (key) =>
        window.dispatchEvent(
          new StorageEvent('storage', {
            key,
            storageArea: localStorage,
            newValue: JSON.stringify({
              version: 1,
              preferences: { chatWidth: 280 },
            }),
          }),
        ),
      key,
    );
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '336');
    await second.close();
  });

  test(`workspace local preferences keep automatic media opening temporary and share export dialog choices ${base}`, async ({
    page,
    context,
  }) => {
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Preference import');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'New project', exact: true }),
    ).not.toBeVisible();
    await page.getByRole('button', { name: 'Expand media' }).click();
    await page.getByRole('button', { name: 'Collapse media' }).click();
    const bytes = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(64, 64);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 64, 64);
      return Array.from(
        new Uint8Array(
          await (
            await canvas.convertToBlob({ type: 'image/png' })
          ).arrayBuffer(),
        ),
      );
    });
    await page.getByLabel('Import media', { exact: true }).setInputFiles({
      name: 'preference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(bytes),
    });
    await expect(
      page.getByRole('button', { name: 'preference.png', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Collapse media' }),
    ).toBeVisible();
    expect((await preferences(page)).mediaOpen).toBe(false);
    const second = await context.newPage();
    await second.goto(base);
    await second
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect
      .poll(async () => (await preferences(page)).mediaOpen)
      .toBe(true);
    await second
      .getByRole('button', { name: 'Collapse media', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Expand media', exact: true }),
    ).toBeVisible();
    await second.close();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Export video',
      exact: true,
    });
    await dialog.getByRole('combobox', { name: 'Format', exact: true }).click();
    await page.getByRole('option', { name: 'WebM', exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Close', exact: true })
      .first()
      .click();
    expect((await preferences(page)).exportFormat).toBe('webm');
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Expand media' }),
    ).toBeVisible();
    await menu(page, 'Export');
    await expect(
      page.getByRole('menuitemradio', { name: 'WebM', exact: true }),
    ).toBeChecked();
    await closeMenu(page);
  });

  test(`workspace local preferences validate stored values and remain inert ${base}`, async ({
    page,
  }) => {
    let providerRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('openrouter.ai')) providerRequests++;
    });
    await page.goto(base);
    for (const record of [
      '{',
      JSON.stringify({ version: 99, preferences: { chatWidth: 500 } }),
      JSON.stringify({
        version: 1,
        preferences: {
          chatWidth: '500',
          chatCollapsed: 'true',
          exportFormat: 'mov',
        },
      }),
    ]) {
      await page.evaluate(
        ({ key, record }) => localStorage.setItem(key, record),
        { key, record },
      );
      await page.reload();
      await expect(resize(page)).toHaveAttribute('aria-valuenow', '320');
      await expect(
        page.getByRole('button', { name: 'Collapse chat' }),
      ).toBeVisible();
    }
    await page.evaluate(
      (key) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            preferences: {
              chatWidth: 10000,
              aiModel: 'vendor/model',
              exportFormat: 'webm',
            },
          }),
        ),
      key,
    );
    await page.reload();
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '560');
    await menu(page, 'Export');
    await expect(
      page.getByRole('menuitemradio', { name: 'WebM', exact: true }),
    ).toBeChecked();
    await closeMenu(page);
    expect(providerRequests).toBe(0);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  });

  test(`workspace local preferences remain usable when writes fail and recover without losing choices ${base}`, async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (
          name === key &&
          !(window as Window & { allowPreferences?: boolean }).allowPreferences
        )
          throw new DOMException('Storage full', 'QuotaExceededError');
        return original.call(this, name, value);
      };
    }, key);
    await page.goto(base);
    await resize(page).press('ArrowRight');
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '336');
    await expect(
      page.getByText(
        'Workspace preferences could not be saved. Allow browser storage to keep them after reload.',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Collapse chat' }).click();
    await expect(
      page.getByRole('button', { name: 'Expand chat' }),
    ).toBeVisible();
    await page.evaluate(() => {
      (window as Window & { allowPreferences?: boolean }).allowPreferences =
        true;
    });
    await page.getByRole('button', { name: 'Expand media' }).click();
    expect(await preferences(page)).toMatchObject({
      chatWidth: 336,
      chatCollapsed: true,
      mediaOpen: true,
    });
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Expand chat' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Collapse media' }),
    ).toBeVisible();
  });

  test(`workspace local preferences remain usable when reads are blocked ${base}`, async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) {
        if (name === key)
          throw new DOMException('Storage denied', 'SecurityError');
        return original.call(this, name);
      };
    }, key);
    await page.goto(base);
    await expect(
      page.getByText(
        'Workspace preferences could not be saved. Allow browser storage to keep them after reload.',
      ),
    ).toBeVisible();
    await resize(page).press('ArrowRight');
    await page.getByRole('button', { name: 'Collapse chat' }).click();
    await expect(
      page.getByRole('button', { name: 'Expand chat' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Expand chat' }).click();
    await expect(resize(page)).toHaveAttribute('aria-valuenow', '336');
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  });

  test(`workspace local preferences remember validated AI model without persisting consent or credentials ${base}`, async ({
    page,
    context,
  }) => {
    let available = true;
    let requests = 0;
    await context.route('https://openrouter.ai/api/v1/models', (route) => {
      requests++;
      return route.fulfill({
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization,content-type',
        },
        json: {
          data: [
            {
              id: available ? '~deepseek/deepseek-pro-latest' : 'test/other',
              name: 'Preference model',
              context_length: 32000,
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      });
    });
    await page.goto(base);
    let dialog = await connect(page);
    const choice = dialog.getByRole('combobox', {
      name: 'AI model',
      exact: true,
    });
    await choice.click();
    await page
      .getByRole('option', {
        name: 'Preference model · ~deepseek/deepseek-pro-latest',
        exact: true,
      })
      .click();
    await dialog
      .getByRole('button', { name: 'Data & analytics', exact: true })
      .click();
    await page
      .getByRole('checkbox', { name: 'Share overlay and caption text' })
      .click();
    await page
      .getByRole('checkbox', { name: 'Share project and media names' })
      .click();
    await page
      .getByRole('checkbox', { name: 'Share source transcripts' })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    expect((await preferences(page)).aiModel).toBe(
      '~deepseek/deepseek-pro-latest',
    );
    const storage = await page.evaluate(() => ({ ...localStorage }));
    expect(JSON.stringify(storage)).not.toContain('synthetic-preference-key');
    expect(JSON.stringify(storage)).not.toContain('includeText');
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Connect AI', exact: true }).first(),
    ).toBeVisible();
    expect(requests).toBe(1);
    dialog = await connect(page);
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toContainText('Preference model');
    await dialog
      .getByRole('button', { name: 'Data & analytics', exact: true })
      .click();
    await expect(page.getByRole('checkbox')).toHaveCount(3);
    for (const checkbox of await page.getByRole('checkbox').all())
      await expect(checkbox).not.toBeChecked();
    await dialog
      .getByRole('button', { name: 'Data & analytics', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Disconnect', exact: true })
      .click();
    expect((await preferences(page)).aiModel).toBe(
      '~deepseek/deepseek-pro-latest',
    );
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    available = false;
    dialog = await connect(page);
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toContainText('Choose a model');
    expect((await preferences(page)).aiModel).toBe(
      '~deepseek/deepseek-pro-latest',
    );
    await dialog
      .getByRole('button', { name: 'Disconnect', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    available = true;
    dialog = await connect(page);
    await expect(
      dialog.getByRole('combobox', { name: 'AI model', exact: true }),
    ).toContainText('Preference model');
  });
}
