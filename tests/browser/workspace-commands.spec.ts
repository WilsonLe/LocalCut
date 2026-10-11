import { openWorkspaceGroup } from './workspace-settings-helper';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function expectExportAvailable(page: Page, available: boolean) {
  const menu = await openWorkspaceGroup(page, 'Export');
  await expect(
    menu.getByRole('menuitem', { name: 'Export video', exact: true }),
  ).toHaveCount(available ? 1 : 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

async function palette(page: Page) {
  await page.getByRole('button', { name: 'Commands', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Commands', exact: true });
  await expect(
    dialog.getByRole('combobox', { name: 'Search commands' }),
  ).toBeFocused();
  return dialog;
}
async function run(page: Page, name: string) {
  const dialog = await palette(page);
  await dialog.getByRole('combobox').fill(name);
  await dialog
    .getByRole('option')
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await expect(dialog).not.toBeVisible();
}
for (const base of ['/', '/LocalCut/']) {
  test(`workspace commands discover and run available operations with keyboard focus ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const header = page.locator('.workspace-header');
    await expect(page.locator('button:disabled')).toHaveCount(0);
    if (base === '/LocalCut/')
      await page.screenshot({
        path: '.artifacts/workspace-clean.png',
        animations: 'disabled',
      });
    for (const name of [
      'New project',
      'Versions',
      'Export',
      'Keyboard shortcuts',
      'Local storage information',
    ]) {
      await expect(
        header.getByRole('button', { name, exact: true }),
      ).toHaveCount(0);
    }
    const editor = page.getByRole('main', {
      name: 'Video editor',
      exact: true,
    });
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+k');
    let dialog = page.getByRole('dialog', { name: 'Commands', exact: true });
    const search = dialog.getByRole('combobox', { name: 'Search commands' });
    await expect(search).toBeFocused();
    await expect(
      dialog.getByRole('option', {
        name: /Add text|Export video|Browse project versions|Delete selected/,
      }),
    ).toHaveCount(0);
    await search.fill('no such operation');
    await expect(dialog.getByText('No available commands.')).toBeVisible();
    await search.fill('new project');
    await search.press('Enter');
    const newProject = page.getByRole('dialog', {
      name: 'New project',
      exact: true,
    });
    await expect(newProject.getByLabel('Project name')).toBeFocused();
    await newProject.getByLabel('Project name').fill('Command journey');
    await newProject.getByLabel('Project name').press('ControlOrMeta+k');
    await expect(dialog).not.toBeVisible();
    await newProject.getByRole('button', { name: 'Create project' }).click();
    await expect(newProject).not.toBeVisible();
    await expect(
      header.getByRole('button', { name: 'Versions', exact: true }),
    ).toHaveCount(0);
    const projectMenu = await openWorkspaceGroup(page, 'Project');
    await expect(
      projectMenu.getByRole('menuitem', { name: 'Versions', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(
      header.getByRole('button', { name: 'Export', exact: true }),
    ).toHaveCount(0);
    await expectExportAvailable(page, false);

    await run(page, 'Add text');
    await page
      .getByRole('button', { name: 'Insert Plain text', exact: true })
      .click();
    const properties = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await expect(properties.getByLabel('Text', { exact: true })).toBeVisible();
    await properties.getByLabel('Text', { exact: true }).fill('Palette edit');
    await properties.getByRole('button', { name: 'Apply properties' }).click();
    await expect(properties).not.toBeVisible();
    await expect(
      header.getByRole('button', { name: 'Export', exact: true }),
    ).toHaveCount(0);
    await expectExportAvailable(page, true);
    await run(page, 'Forward ten frames');
    await expect(
      page.getByRole('slider', { name: 'Playhead position', exact: true }),
    ).toHaveAttribute('aria-valuenow', '333333');
    await run(page, 'Split clip at playhead');
    await expect(
      page.getByRole('button', { name: 'Palette edit', exact: true }),
    ).toHaveCount(2);
    await run(page, 'Undo');
    await expect(
      page.getByRole('button', { name: 'Palette edit', exact: true }),
    ).toHaveCount(1);
    await run(page, 'Redo');
    await expect(
      page.getByRole('button', { name: 'Palette edit', exact: true }),
    ).toHaveCount(2);

    dialog = await palette(page);
    const list = dialog.locator('[data-slot="command-list"]');
    if (base === '/LocalCut/')
      await page.screenshot({
        path: '.artifacts/workspace-commands.png',
        animations: 'disabled',
      });
    expect(
      await list.evaluate((el) => getComputedStyle(el).scrollbarWidth),
    ).toBe('none');
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
    await dialog.getByRole('combobox').press('End');
    await expect
      .poll(() => list.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(
      header.getByRole('button', { name: 'Commands', exact: true }),
    ).toBeFocused();

    await run(page, 'Browse project versions');
    const versions = page.getByRole('group', { name: 'Saved versions' });
    await versions.getByRole('button').last().click();
    await expect(page.getByText(/Version \d+ · Read-only/)).toBeVisible();
    await expect(
      header.getByRole('button', { name: 'Export', exact: true }),
    ).toHaveCount(0);
    await expectExportAvailable(page, false);
    dialog = await palette(page);
    await expect(
      dialog.getByRole('option', {
        name: /Add text|Import media|Export video|Undo|Redo|Split clip|Duplicate selected|Delete selected/,
      }),
    ).toHaveCount(0);
    await dialog.getByRole('combobox').fill('Return to current version');
    await dialog.getByRole('combobox').press('Enter');
    await expect(page.getByText(/Version \d+ · Read-only/)).toHaveCount(0);
    await expect(
      header.getByRole('button', { name: 'Export', exact: true }),
    ).toHaveCount(0);
    await expectExportAvailable(page, true);

    await run(page, 'Export video');
    await expect(
      page.getByRole('dialog', { name: 'Export video', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await run(page, 'New chat');
    await run(page, 'Chat sessions');
    await expect(
      page
        .getByRole('menu', { name: 'Chat sessions', exact: true })
        .getByRole('menuitemradio'),
    ).toHaveCount(1);
    await page.keyboard.press('Escape');
    // The lazy picker must reopen after it has already mounted and closed.
    await run(page, 'Chat sessions');
    await expect(
      page.getByRole('menu', { name: 'Chat sessions', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await run(page, 'Use WebM export format');
    await expect(
      header.getByRole('button', { name: 'Commands', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('ControlOrMeta+k');
    dialog = page.getByRole('dialog', { name: 'Commands', exact: true });
    await dialog.getByRole('combobox').fill('Use MP4 export format');
    await dialog.getByRole('combobox').press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(
      header.getByRole('button', { name: 'Commands', exact: true }),
    ).toBeFocused();
    await run(page, 'Connect AI providers');
    await expect(
      page.getByRole('dialog', { name: 'AI connection', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Keyboard shortcuts', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 320, height: 844 });
    dialog = await palette(page);
    if (base === '/LocalCut/')
      await page.screenshot({
        path: '.artifacts/workspace-commands-narrow.png',
        animations: 'disabled',
      });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    await page.keyboard.press('Escape');
    await run(page, 'Expand chat');
    await run(page, 'Collapse chat');
    await page.reload();
    await expect(page.locator('.conversation-panel')).toBeHidden();
    await expect(
      page
        .getByRole('navigation', { name: 'Workspace sections' })
        .getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await run(page, 'Expand media');
    await expect(
      page.getByRole('complementary', { name: 'Media library', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('complementary', { name: 'Media library', exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Expand media', exact: true }),
    ).toBeVisible();
  });
}
