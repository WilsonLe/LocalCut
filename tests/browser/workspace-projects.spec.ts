import { versionJourney } from './workspace-version-journey';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function create(page: Page, name: string) {
  const browser = page.getByRole('main', { name: 'Projects', exact: true });
  await browser
    .getByRole('button', { name: 'New project', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByLabel('Project name').fill(name);
  await dialog
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(browser).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open project', exact: true }),
  ).toContainText(name);
}

for (const base of ['/', '/LocalCut/']) {
  test(`project navigation imports a backup and handles long names ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const name = 'Imported film ' + 'with a long project name '.repeat(16);
    const backup = await page.evaluate(
      async ({ base, name }) => {
        const { createEditor } = await import(`${base}editor.js`);
        const editor = await createEditor();
        try {
          const project = await editor.projects.create(name);
          const backup = await editor.projects.exportJSON(project.id);
          await editor.projects.delete(project.id);
          return backup;
        } finally {
          await editor.dispose();
        }
      },
      { base, name },
    );
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    const browser = page.getByRole('main', { name: 'Projects' });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      browser
        .getByRole('button', { name: 'Import backup', exact: true })
        .click(),
    ]);
    await chooser.setFiles({
      name: 'project.localcut.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backup),
    });
    await expect(browser).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText(name);
    await page.keyboard.press('ControlOrMeta+o');
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(
      browser.getByRole('button', { name: /Imported film/ }),
    ).toContainText('Current');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await browser
      .getByRole('textbox', { name: 'Search projects' })
      .fill('LONG PROJECT NAME');
    await expect(browser.getByRole('listitem')).toHaveCount(1);
    await browser.getByRole('button', { name: /Imported film/ }).focus();
    await page.keyboard.press('Enter');
    await expect(browser).not.toBeVisible();
    await expect(
      page.getByRole('main', { name: 'Video editor' }),
    ).toBeFocused();
  });

  test(
    '@journey ' +
      [
        `project navigation searches, switches and preserves editing ${base}`,
        `project version browsing recreates the read-only editor at ${base}`,
      ].join(' | '),
    async ({ page, context }, testInfo) => {
      await test.step(`project navigation searches, switches and preserves editing ${base}`, async () => {
        await page.goto(base);
        await page
          .getByRole('button', { name: 'Open project', exact: true })
          .click();
        const browser = page.getByRole('main', {
          name: 'Projects',
          exact: true,
        });
        await expect(
          browser.getByRole('heading', { name: 'Projects', exact: true }),
        ).toBeFocused();
        await expect(
          browser.getByText('No saved projects yet', { exact: true }),
        ).toBeVisible();
        await create(page, 'Zebra film');
        await context.route('https://openrouter.ai/api/v1/models', (route) =>
          route.fulfill({
            headers: { 'access-control-allow-origin': '*' },
            json: {
              data: [
                {
                  id: 'test/navigation',
                  name: 'Navigation model',
                  context_length: 32000,
                  supported_parameters: ['tools', 'tool_choice'],
                },
              ],
            },
          }),
        );
        await page
          .getByRole('button', { name: 'Connect AI', exact: true })
          .click();
        const connection = page.getByRole('dialog', {
          name: 'AI connection',
          exact: true,
        });
        await connection
          .getByLabel('OpenRouter API key')
          .fill('synthetic-navigation-key');
        await connection.getByRole('button', { name: 'Use API key' }).click();
        await connection
          .getByRole('combobox', { name: 'AI model', exact: true })
          .click();
        await page
          .getByRole('option', {
            name: 'Navigation model · test/navigation',
            exact: true,
          })
          .click();
        await connection
          .getByRole('button', { name: 'Done', exact: true })
          .click();
        await page.getByLabel('Describe your edit').fill('Preserve this draft');
        await page
          .getByRole('button', { name: 'Commands', exact: true })
          .click();
        const palette = page.getByRole('dialog', {
          name: 'Commands',
          exact: true,
        });
        await palette.getByRole('combobox').fill('Add text');
        await palette.getByRole('option', { name: /Add text/ }).click();
        await page
          .getByRole('button', { name: 'Insert Plain text', exact: true })
          .click();
        await expect(
          page.getByRole('dialog', { name: 'Clip properties', exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        const selected = await page
          .locator('.timeline-clip[aria-pressed="true"]')
          .count();
        expect(selected).toBe(1);
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
          .getByRole('button', { name: 'LocalCut home', exact: true })
          .click();
        await expect(browser).toBeVisible();
        await expect(
          page.getByRole('main', { name: 'Video editor' }),
        ).not.toBeVisible();
        await expect(
          browser.getByRole('button', { name: /Zebra film/ }),
        ).toContainText('1 clip');
        await expect(
          browser.getByRole('button', { name: /Zebra film/ }),
        ).toContainText('Current');
        await browser
          .getByRole('button', { name: 'Back to editor', exact: true })
          .click();
        await expect(
          page.getByRole('main', { name: 'Video editor' }),
        ).toBeFocused();
        await expect(
          page.getByRole('button', { name: 'Play preview', exact: true }),
        ).toBeVisible();
        const playhead = page.getByRole('slider', {
          name: 'Playhead position',
        });
        const stopped = await playhead.inputValue();
        await page.waitForTimeout(150);
        expect(await playhead.inputValue()).toBe(stopped);
        await expect(page.getByLabel('Describe your edit')).toHaveValue(
          'Preserve this draft',
        );
        expect(
          await page.locator('.timeline-clip[aria-pressed="true"]').count(),
        ).toBe(selected);
        await playhead.focus();
        await page.keyboard.press('End');
        const scrubbed = await playhead.inputValue();
        expect(Number(scrubbed)).toBeGreaterThan(Number(stopped));
        await page
          .getByRole('button', { name: 'Open project', exact: true })
          .click();
        await browser.getByRole('button', { name: /Zebra film/ }).click();
        await expect(playhead).toHaveValue(scrubbed);
        await expect(page.getByLabel('Describe your edit')).toHaveValue(
          'Preserve this draft',
        );
        expect(
          await page.locator('.timeline-clip[aria-pressed="true"]').count(),
        ).toBe(selected);
        await page.keyboard.press('ControlOrMeta+o');
        await create(page, 'Alpha film');
        await page.keyboard.press('ControlOrMeta+o');
        const rows = browser
          .getByRole('list', { name: 'Saved projects' })
          .getByRole('button');
        await expect(rows).toHaveCount(2);
        await expect(rows.first()).toContainText('Alpha film');
        const search = browser.getByRole('textbox', {
          name: 'Search projects',
        });
        await search.fill('  ZEBRA  ');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Zebra film');
        await search.fill('No such project');
        await expect(
          browser.getByText('No matching projects', { exact: true }),
        ).toBeVisible();
        await browser
          .getByRole('button', { name: 'Clear search', exact: true })
          .click();
        await expect(search).toHaveValue('');
        await page.screenshot({
          path: testInfo.outputPath('projects-desktop.png'),
          animations: 'disabled',
        });
        await page.setViewportSize({ width: 320, height: 800 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(
          browser.getByRole('button', { name: 'New project', exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath('projects-narrow.png'),
          fullPage: true,
          animations: 'disabled',
        });
        await browser.getByRole('button', { name: /Zebra film/ }).click();
        await expect(
          page.getByRole('button', { name: 'Open project', exact: true }),
        ).toContainText('Zebra film');
        await expect(
          page.getByRole('button', {
            name: 'Your story starts here',
            exact: true,
          }),
        ).toBeVisible();
        await page.reload();
        await page
          .getByRole('button', { name: 'Open project', exact: true })
          .click();
        await expect(
          browser.getByRole('button', { name: /Zebra film/ }),
        ).toContainText('1 clip');
        await browser.getByRole('button', { name: /Zebra film/ }).click();
        await expect(
          page.getByRole('button', {
            name: 'Your story starts here',
            exact: true,
          }),
        ).toBeVisible();
      });
      await page.setViewportSize({ width: 1280, height: 720 });
      await versionJourney(page, base);
    },
  );

  test(`project navigation retries storage failures and refreshes external changes ${base}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      let first = true;
      indexedDB.open = ((...args: Parameters<typeof indexedDB.open>) => {
        if (first) {
          first = false;
          throw new Error('Allow browser storage and try again.');
        }
        return open(...args);
      }) as typeof indexedDB.open;
    });
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    const browser = page.getByRole('main', { name: 'Projects' });
    await expect(page.locator('[data-sonner-toast]')).toContainText(
      'Allow browser storage',
    );
    await browser
      .getByRole('button', { name: 'Try again', exact: true })
      .click();
    await expect(
      browser.getByText('No saved projects yet', { exact: true }),
    ).toBeVisible();
    const id = await page.evaluate(async (base) => {
      const { createEditor } = await import(`${base}editor.js`);
      const editor = await createEditor();
      try {
        return (await editor.projects.create('External project')).id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await expect(
      browser.getByRole('button', { name: /External project/ }),
    ).toBeVisible();
    await page.evaluate(
      async ({ base, id }) => {
        const { createEditor } = await import(`${base}editor.js`);
        const editor = await createEditor();
        try {
          await editor.projects.delete(id);
        } finally {
          await editor.dispose();
        }
      },
      { base, id },
    );
    await expect(
      browser.getByText('No saved projects yet', { exact: true }),
    ).toBeVisible();
    await browser.getByRole('button', { name: 'Refresh projects' }).click();
    await expect(
      browser.getByText('No saved projects yet', { exact: true }),
    ).toBeVisible();
    await browser.getByRole('button', { name: 'Back to editor' }).click();
    await expect(
      page.getByRole('main', { name: 'Video editor' }),
    ).toBeFocused();
  });
}
