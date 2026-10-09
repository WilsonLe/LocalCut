import { expect, test, type Page } from '@playwright/test';

const key = 'localcut.appearance.v1';
async function openAppearance(page: Page) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Appearance', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Appearance customization' });
  await expect(panel).toBeVisible();
  return panel;
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function styles(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const button = getComputedStyle(document.querySelector('button')!);
    const heading = getComputedStyle(document.querySelector('h2')!);
    const preview = getComputedStyle(document.querySelector('.preview')!);
    return {
      primary: root.getPropertyValue('--primary'),
      foreground: root.getPropertyValue('--foreground'),
      font: getComputedStyle(document.body).fontFamily,
      heading: heading.fontFamily,
      radius: button.borderRadius,
      padding: preview.padding,
      popover: root.getPropertyValue('--popover'),
      accent: root.getPropertyValue('--accent'),
    };
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`workspace appearance preserves preview space with wide chat and expanded media ${base}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(base);
    const panel = await openAppearance(page);
    const resize = page.getByRole('separator', {
      name: 'Resize workspace chat',
    });
    await resize.press('End');
    await expect(resize).toHaveAttribute('aria-valuenow', '560');
    await page.getByRole('button', { name: 'Expand media' }).click();
    await page.setViewportSize({ width: 1120, height: 900 });
    const editorWidth = () =>
      page
        .locator('.editing-area')
        .evaluate((node) => node.getBoundingClientRect().width);
    await expect.poll(editorWidth).toBeGreaterThanOrEqual(279);
    expect(
      (await page.locator('.preview-stage').boundingBox())!.width,
    ).toBeGreaterThan(200);
    await expect(
      page.getByRole('button', { name: 'Collapse media' }),
    ).toBeVisible();
    const current = Number(await resize.getAttribute('aria-valuenow'));
    expect(current).toBeLessThanOrEqual(
      Number(await resize.getAttribute('aria-valuemax')),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(1120);
    await page.getByRole('button', { name: 'Collapse chat' }).click();
    await expect
      .poll(
        async () =>
          (await page.locator('.conversation-panel').boundingBox())!.width,
      )
      .toBe(52);
    await page.getByRole('button', { name: 'Expand chat' }).click();
    await expect.poll(editorWidth).toBeGreaterThanOrEqual(279);
    await panel.getByRole('button', { name: 'Close appearance' }).click();
    await expect(resize).toHaveAttribute('aria-valuenow', '560');
  });

  test(`workspace appearance keeps phone preview, timeline and chat from overlapping ${base}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(base);
    const panel = await openAppearance(page);
    await choose(page, 'Density', 'Comfortable');
    await expect(page.locator('html')).toHaveAttribute(
      'data-density',
      'comfortable',
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const preview = document
            .querySelector('.preview')!
            .getBoundingClientRect();
          const timeline = document
            .querySelector('.timeline')!
            .getBoundingClientRect();
          const chat = document
            .querySelector('.conversation-panel')!
            .getBoundingClientRect();
          return Math.max(
            preview.bottom - timeline.top,
            timeline.bottom - chat.top,
          );
        }),
      )
      .toBeLessThanOrEqual(1);
    await page.locator('.preview-stage').scrollIntoViewIfNeeded();
    await expect(
      page.getByRole('region', { name: 'Project preview', exact: true }),
    ).toBeVisible();
    expect(
      (await page.locator('.preview-stage').boundingBox())!.width,
    ).toBeGreaterThan(200);
    await page
      .getByRole('button', { name: 'Connect AI', exact: true })
      .first()
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole('button', { name: 'Connect AI', exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    await expect(panel).toBeVisible();
  });

  test(`workspace appearance remains usable when storage reads are blocked ${base}`, async ({
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
    const panel = await openAppearance(page);
    await expect(panel.getByRole('status')).toHaveText(/could not be saved/);
    await panel.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass('dark');
    await expect(panel.getByRole('status')).toHaveText('Saved in this browser');
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  });

  test(`workspace appearance previews the actual app, saves, synchronizes and resets ${base}`, async ({
    page,
    context,
  }) => {
    await page.goto(base);
    await page
      .getByRole('button', { name: 'New project', exact: true })
      .click();
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Appearance project');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'New project', exact: true }),
    ).not.toBeVisible();
    await context.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization,content-type',
        },
        json: {
          data: [
            {
              id: 'test/appearance',
              name: 'Appearance model',
              context_length: 32000,
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    await page
      .getByRole('button', { name: 'Connect AI', exact: true })
      .first()
      .click();
    const connection = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await connection
      .getByLabel('OpenRouter API key', { exact: true })
      .fill('synthetic-appearance-key');
    await connection
      .getByRole('button', { name: 'Use API key', exact: true })
      .click();
    await connection
      .getByRole('combobox', { name: 'AI model', exact: true })
      .click();
    await page
      .getByRole('option', {
        name: 'Appearance model · test/appearance',
        exact: true,
      })
      .click();
    await connection.getByRole('button', { name: 'Done', exact: true }).click();
    const composer = page.getByRole('textbox', { name: 'Describe your edit' });
    await composer.fill('Keep this conversation draft');
    const before = await styles(page);
    const panel = await openAppearance(page);
    await expect(
      panel.getByRole('button', { name: 'Close appearance' }),
    ).toBeFocused();
    await panel.getByRole('button', { name: 'Dark', exact: true }).click();
    await panel.getByRole('button', { name: 'Violet theme' }).click();
    await choose(page, 'Base color', 'Slate');
    await choose(page, 'Heading', 'System serif');
    await choose(page, 'Font', 'System mono');
    await choose(page, 'Radius', 'None');
    await choose(page, 'Density', 'Compact');
    await choose(page, 'Menu color', 'Tinted');
    await choose(page, 'Menu accent', 'Bold');
    await expect(page.locator('html')).toHaveClass('dark');
    const after = await styles(page);
    await panel
      .getByRole('button', { name: 'Dark', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.artifacts/appearance-${base === '/' ? 'root' : 'pages'}.png`,
    });
    expect(after.primary).not.toBe(before.primary);
    expect(after.foreground).not.toBe(before.foreground);
    expect(after.font).toContain('monospace');
    expect(after.heading).toContain('Georgia');
    expect(after.radius).toBe('0px');
    await expect(page.locator('.chat-composer')).toHaveCSS(
      'border-radius',
      '0px',
    );
    expect(after.padding).not.toBe(before.padding);
    expect(after.accent).toBe(after.primary);
    expect(after.popover).toContain('color-mix');
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toHaveText(/Appearance project/);
    await expect(composer).toHaveValue('Keep this conversation draft');
    await expect(panel.getByRole('status')).toHaveText('Saved in this browser');
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      key,
    );
    expect(stored.preferences).toMatchObject({
      mode: 'dark',
      base: 'slate',
      theme: 'violet',
      font: 'mono',
      heading: 'serif',
      radius: 'none',
      density: 'compact',
      menuColor: 'tinted',
      menuAccent: 'bold',
    });
    await panel.getByRole('button', { name: 'Close appearance' }).click();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();

    const second = await context.newPage();
    await second.goto(base);
    expect(await styles(second)).toEqual(after);
    await page.reload();
    expect(await styles(page)).toEqual(after);
    await openAppearance(page);
    await page.getByRole('button', { name: 'Randomize', exact: true }).click();
    await expect(page.locator('html')).toHaveClass('dark');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass('dark');
    await expect(second.locator('html')).not.toHaveClass('dark');
    await expect
      .poll(() =>
        second.evaluate(() => document.documentElement.dataset.density),
      )
      .toBe('default');
    expect(
      await page.evaluate((key) => localStorage.getItem(key), key),
    ).toBeNull();
    await page.reload();
    expect((await styles(page)).primary).toBe(before.primary);
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: /Appearance project/ }),
    ).toBeVisible();
  });

  test(`workspace appearance follows system mode and supports keyboard and narrow layouts ${base}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto(base);
    const panel = await openAppearance(page);
    await panel.getByRole('button', { name: 'System', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass('dark');
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveClass('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveClass('dark');
    await openAppearance(page);
    const radius = panel.getByRole('combobox', { name: 'Radius', exact: true });
    await radius.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).not.toBeVisible();
    await expect(panel).toBeVisible();
    await expect(radius).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
    await page.setViewportSize({ width: 320, height: 844 });
    await openAppearance(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    const bounds = await panel.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(320);
    await choose(page, 'Radius', 'Large');
    const narrowPadding = (await styles(page)).padding;
    await choose(page, 'Density', 'Comfortable');
    await expect
      .poll(async () => (await styles(page)).padding)
      .not.toBe(narrowPadding);
    await panel.getByRole('button', { name: 'Close appearance' }).click();
    await expect(
      page.getByRole('region', { name: 'Project preview', exact: true }),
    ).toBeVisible();
  });

  test(`workspace appearance safely handles invalid records and unavailable storage ${base}`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ key }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            preferences: {
              mode: 'dark',
              theme: 'url(https://example.com)',
              radius: '9999px',
            },
          }),
        );
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key)
            throw new DOMException('Storage unavailable', 'QuotaExceededError');
          original.call(this, name, value);
        };
      },
      { key },
    );
    await page.goto(base);
    await expect(page.locator('html')).toHaveClass('dark');
    const panel = await openAppearance(page);
    await expect(
      panel.getByRole('button', { name: 'Neutral theme' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      panel.getByRole('combobox', { name: 'Radius', exact: true }),
    ).toHaveText(/Medium/);
    await panel.getByRole('button', { name: 'Blue theme' }).click();
    await expect(panel.getByRole('status')).toHaveText(/could not be saved/);
    await expect(
      panel.getByRole('button', { name: 'Blue theme' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('button', { name: 'Close appearance' }).click();
    await page
      .getByRole('button', { name: 'New project', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'New project', exact: true }),
    ).toBeVisible();
  });
}
