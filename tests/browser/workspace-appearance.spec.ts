import { createWorkspace } from './workspace-project-helper';
import { behaviorBases } from './coverage-bases';
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
  await expect(
    page.getByRole('combobox', { name: label, exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  if (label === 'Font' || label === 'Heading') {
    await page
      .getByRole('combobox', {
        name: `Search ${label === 'Font' ? 'body' : 'heading'} fonts`,
        exact: true,
      })
      .fill(option);
  }
  await page
    .getByRole('option', { name: option, exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.locator(
      '[data-slot="select-content"]:visible, [data-slot="combobox-content"]:visible',
    ),
  ).toHaveCount(0);
}
async function styles(page: Page) {
  await page.locator('.preview').waitFor({ state: 'visible' });
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const button = getComputedStyle(document.querySelector('button')!);
    const heading = root.getPropertyValue('--font-heading');
    const preview = getComputedStyle(document.querySelector('.preview')!);
    return {
      primary: root.getPropertyValue('--primary'),
      foreground: root.getPropertyValue('--foreground'),
      font: getComputedStyle(document.body).fontFamily,
      heading,
      radius: button.borderRadius,
      padding: preview.padding,
      popover: root.getPropertyValue('--popover'),
      accent: root.getPropertyValue('--accent'),
    };
  });
}

for (const base of behaviorBases) {
  test(`workspace appearance searches the local text catalog and retries verified fonts ${base}`, async ({
    page,
    context,
  }) => {
    const fontRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.includes('/fonts/'))
        fontRequests.push(request.url());
    });
    await page.goto(base);
    const panel = await openAppearance(page);
    expect(fontRequests).toEqual([]);
    await page.getByRole('combobox', { name: 'Font', exact: true }).click();
    const popup = page.locator('[data-slot="combobox-content"]:visible');
    await expect(popup.getByRole('option')).toHaveCount(60);
    await expect(popup).toContainText('1,805 fonts');
    await page
      .getByRole('combobox', { name: 'Search body fonts', exact: true })
      .fill('vietnamese modern');
    await expect(popup.getByRole('option')).not.toHaveCount(0);
    await page.screenshot({
      path: `.artifacts/appearance-catalog-${base === '/' ? 'root' : 'pages'}.png`,
    });
    await page
      .getByRole('combobox', { name: 'Search body fonts', exact: true })
      .fill('no-font-with-this-name');
    await expect(popup).toContainText('No matching fonts.');
    await page
      .getByRole('combobox', { name: 'Search body fonts', exact: true })
      .press('Escape');
    await expect(panel).toBeVisible();
    await context.route('**/fonts/*/inter/latin.woff2', (route) =>
      route.fulfill({ body: 'corrupt', contentType: 'font/woff2' }),
    );
    await choose(page, 'Font', 'Inter');
    await expect(panel.getByRole('alert')).toContainText(
      'Could not load inter',
    );
    await expect(
      page.getByRole('combobox', { name: 'Font', exact: true }),
    ).toContainText('Inter');
    await context.unroute('**/fonts/*/inter/latin.woff2');
    await panel
      .getByRole('button', { name: 'Retry fonts', exact: true })
      .click();
    await expect(
      panel.getByText('Loading fonts…', { exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.fonts].some(
            (face) =>
              face.family === 'LocalCut inter' && face.status === 'loaded',
          ),
        ),
      )
      .toBe(true);
    expect(fontRequests.length).toBeGreaterThan(0);
    expect(
      fontRequests.every(
        (url) => new URL(url).origin === new URL(page.url()).origin,
      ),
    ).toBe(true);
    expect(
      fontRequests.every((url) =>
        new URL(url).pathname.startsWith(`${base}fonts/`),
      ),
    ).toBe(true);
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
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
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
              context_length: 512000,
              supported_parameters: ['tools', 'tool_choice'],
            },
          ],
        },
      }),
    );
    const before = await styles(page);
    const panel = await openAppearance(page);
    await expect(
      panel.getByRole('button', { name: 'Close appearance' }),
    ).toBeFocused();
    await expect(
      panel.getByText('Your workspace is the preview.', { exact: true }),
    ).toHaveCount(0);
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
    const generic = await styles(page);
    expect(generic.font).toContain('monospace');
    expect(generic.heading).toContain('Georgia');
    const namedFonts = [
      'Arial',
      'Verdana',
      'Tahoma',
      'Trebuchet MS',
      'Georgia',
      'Palatino',
      'Times New Roman',
      'Courier New',
    ];
    for (const name of namedFonts) {
      await choose(page, 'Font', name);
      await expect(page.locator('body')).toHaveCSS(
        'font-family',
        new RegExp(name),
      );
      await choose(page, 'Heading', name);
      await expect(panel.locator('h2')).toHaveCSS(
        'font-family',
        new RegExp(name),
      );
    }
    await choose(page, 'Font', 'Verdana');
    await choose(page, 'Heading', 'Same as body');
    await expect(panel.locator('h2')).toHaveCSS('font-family', /Verdana/);
    await choose(page, 'Heading', 'Palatino');
    await choose(page, 'Font', 'Inter');
    await choose(page, 'Heading', 'Same as body');
    await expect(panel.locator('h2')).toHaveCSS(
      'font-family',
      /LocalCut inter/,
    );
    await choose(page, 'Heading', 'Zilla Slab');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.fonts.check('16px "LocalCut inter"') &&
            [...document.fonts].some(
              (face) =>
                face.family === 'LocalCut inter' && face.status === 'loaded',
            ),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.fonts].some(
            (face) =>
              face.family === 'LocalCut zilla-slab' && face.status === 'loaded',
          ),
        ),
      )
      .toBe(true);
    await expect(
      panel.getByText('Loading fonts…', { exact: true }),
    ).toHaveCount(0);
    const after = await styles(page);
    await panel
      .getByRole('button', { name: 'Dark', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.artifacts/appearance-${base === '/' ? 'root' : 'pages'}.png`,
    });
    expect(after.primary).not.toBe(before.primary);
    expect(after.foreground).not.toBe(before.foreground);
    expect(after.font).toContain('LocalCut inter');
    expect(after.heading).toContain('LocalCut zilla-slab');
    await expect(panel.locator('h2')).toHaveCSS(
      'font-family',
      /LocalCut zilla-slab/,
    );
    expect(after.radius).toBe('0px');

    expect(after.padding).not.toBe(before.padding);
    expect(after.accent).toBe(after.primary);
    expect(after.popover).toContain('color-mix');
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toHaveText(/Appearance project/);
    await expect(panel.getByRole('status')).toHaveText('Saved in this browser');
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      key,
    );
    expect(stored.preferences).toMatchObject({
      mode: 'dark',
      base: 'slate',
      theme: 'violet',
      font: 'font-inter',
      heading: 'font-zilla-slab',
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
    await second.goto(page.url());
    await expect.poll(() => styles(second)).toEqual(after);
    await expect
      .poll(() =>
        second.evaluate(() =>
          [...document.fonts].some(
            (face) =>
              face.family === 'LocalCut inter' && face.status === 'loaded',
          ),
        ),
      )
      .toBe(true);
    await page.reload();
    await expect.poll(() => styles(page)).toEqual(after);
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
        .getByRole('main', { name: 'Projects' })
        .getByRole('button', { name: /^Appearance project/ }),
    ).toBeVisible();
  });

  test(`workspace appearance follows system mode and supports keyboard and narrow layouts ${base}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto(base);
    await createWorkspace(page);
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
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'New project', exact: true }),
    ).toBeVisible();
  });
}
