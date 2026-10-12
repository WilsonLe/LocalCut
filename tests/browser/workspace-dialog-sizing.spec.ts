import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  openAISettings,
  openVideoExport,
  openWorkspaceGroup,
} from './workspace-settings-helper';

async function bounds(dialog: Locator, page: Page) {
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-dialog-loading');
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 8 &&
          rect.top >= 8 &&
          rect.right <= innerWidth - 8 &&
          rect.bottom <= innerHeight - 8
        );
      }),
    )
    .toBe(true);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight - innerHeight,
    ),
  ).toBeLessThanOrEqual(2);
}

for (const base of ['/', '/LocalCut/']) {
  test(`dialog sizing fits content and contains rich editors across viewports ${base}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base);
    const dialog = (name: string) =>
      page.getByRole('dialog', { name, exact: true });
    const close = async (name: string) => {
      await dialog(name).locator('[data-slot="dialog-close"]').click();
      await expect(dialog(name)).toBeHidden();
    };
    const audit = async (name: string, compact = false) => {
      await bounds(dialog(name), page);
      if (compact)
        expect((await dialog(name).boundingBox())!.height).toBeLessThan(400);
      await testInfo.attach(`${name} bounds`, {
        contentType: 'application/json',
        body: JSON.stringify(await dialog(name).boundingBox()),
      });
    };
    await (
      await openWorkspaceGroup(page, 'Project')
    )
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await audit('New project');
    await page.getByLabel('Project name', { exact: true }).fill('Dialog audit');
    await dialog('New project')
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(dialog('New project')).toBeHidden();

    await page.getByRole('button', { name: 'Task queue', exact: true }).click();
    await audit('Task queue', true);
    await close('Task queue');
    await expect(
      page.getByRole('button', { name: 'Task queue', exact: true }),
    ).toBeFocused();
    await page
      .getByRole('button', { name: 'Notifications', exact: true })
      .click();
    await audit('Notifications', true);
    await close('Notifications');

    await openAISettings(page);
    await audit('AI connection');
    await page.screenshot({ path: testInfo.outputPath('desktop-ai.png') });
    await dialog('AI connection')
      .getByRole('button', { name: 'Done', exact: true })
      .click();

    await (
      await openWorkspaceGroup(page, 'Workspace')
    )
      .getByRole('menuitem', { name: 'Export workspace', exact: true })
      .click();
    await audit('Export workspace');
    expect(
      (await dialog('Export workspace').boundingBox())!.width,
    ).toBeGreaterThan(600);
    await close('Export workspace');
    await (
      await openWorkspaceGroup(page, 'Workspace')
    )
      .getByRole('menuitem', { name: 'Import workspace', exact: true })
      .click();
    await audit('Import workspace', true);
    await close('Import workspace');

    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    await audit('Add text');
    await dialog('Add text')
      .getByRole('button', { name: 'Insert Plain text', exact: true })
      .click();
    await audit('Clip properties');
    await close('Clip properties');
    await openVideoExport(page);
    await audit('Export video');
    await close('Export video');

    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await audit('Projects');
    expect((await dialog('Projects').boundingBox())!.height).toBeGreaterThan(
      600,
    );
    await page
      .getByRole('button', { name: 'Actions for Dialog audit', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await audit('Rename project', true);
    await page.screenshot({ path: testInfo.outputPath('desktop-rename.png') });
    await close('Rename project');
    await page
      .getByRole('button', { name: 'Actions for Dialog audit', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Adjust thumbnail', exact: true })
      .click();
    await audit('Adjust thumbnail');
    await close('Adjust thumbnail');
    await close('Projects');

    // Layout-only scale changes exercise the same production portal contract.
    // Open each surface after resizing because the responsive header remounts.
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 600, height: 300 },
    ]) {
      await page.setViewportSize(viewport);
      for (const scale of [0.75, 1, 1.25]) {
        await page.evaluate(
          (scale) =>
            document.documentElement.style.setProperty(
              '--interface-scale',
              String(scale),
            ),
          scale,
        );
        await openAISettings(page);
        await audit('AI connection');
        await expect(
          dialog('AI connection').getByRole('button', {
            name: 'Done',
            exact: true,
          }),
        ).toBeInViewport();
        await dialog('AI connection')
          .getByRole('button', { name: 'Done', exact: true })
          .click();
        await (
          await openWorkspaceGroup(page, 'Workspace')
        )
          .getByRole('menuitem', { name: 'Import workspace', exact: true })
          .click();
        await audit('Import workspace');
        await close('Import workspace');
        await (
          await openWorkspaceGroup(page, 'Workspace')
        )
          .getByRole('menuitem', { name: 'Export workspace', exact: true })
          .click();
        await audit('Export workspace');
        await close('Export workspace');
        await page
          .getByRole('button', { name: 'Task queue', exact: true })
          .click();
        await audit('Task queue');
        await close('Task queue');
        await page
          .getByRole('button', { name: 'Open project', exact: true })
          .click();
        await audit('Projects');
        await close('Projects');
        await page.keyboard.press('ControlOrMeta+k');
        await audit('Commands');
        await page.getByPlaceholder('Search commands…').fill('no-such-command');
        await audit('Commands');
        await page.keyboard.press('Escape');
        await page.keyboard.press('ControlOrMeta+k');
        await page
          .getByPlaceholder('Search commands…')
          .fill('Keyboard shortcuts');
        await page.getByRole('option', { name: /Keyboard shortcuts/ }).click();
        await audit('Keyboard shortcuts');
        await dialog('Keyboard shortcuts').evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(
          dialog('Keyboard shortcuts').getByRole('heading', {
            name: 'Keyboard shortcuts',
            exact: true,
          }),
        ).not.toBeInViewport();
        await page.screenshot({
          path: testInfo.outputPath(`shortcuts-${viewport.width}-${scale}.png`),
        });
        // The title scrolling away is expected; keyboard dismissal remains available.
        await page.keyboard.press('Escape');
      }
    }
  });
}
