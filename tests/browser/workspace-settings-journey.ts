import { expect, test, type Page } from '@playwright/test';
import { openWorkspaceGroup } from './workspace-settings-helper';

export async function settingsJourney(page: Page, base: string) {
  await test.step(`workspace settings progressively disclose groups and support keyboard navigation ${base}`, async () => {
    // Continue in the already-open app.
    const settings = page.getByRole('button', {
      name: 'Workspace settings',
      exact: true,
    });
    await settings.focus();
    await settings.press('ArrowDown');
    const menu = page.getByRole('menu', {
      name: 'Workspace settings',
      exact: true,
    });
    await expect(menu).toBeVisible();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitem')).toHaveCount(8);
    await expect(
      menu.getByRole('menuitem', { name: /^Browser agent/ }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('menuitem', {
        name: 'Download project backup',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('menuitemcheckbox', {
        name: 'Media library',
        exact: true,
      }),
    ).toHaveCount(0);

    const project = menu.getByRole('menuitem', {
      name: 'Project',
      exact: true,
    });
    await expect(project).toBeFocused();
    await page.keyboard.press('ArrowRight');
    const projectMenu = page.getByRole('menu', {
      name: 'Project',
      exact: true,
    });
    await expect(projectMenu).toBeVisible();
    await expect(
      projectMenu.getByRole('menuitem', { name: 'Versions', exact: true }),
    ).toHaveCount(0);
    await expect(
      projectMenu.getByRole('menuitem', { name: 'New project', exact: true }),
    ).toBeFocused();
    await expect(
      projectMenu.getByRole('menuitem', {
        name: 'Download project backup',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      projectMenu.getByRole('menuitem', { name: 'New project', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(projectMenu).not.toBeVisible();
    await expect(project).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const view = page.getByRole('menu', { name: 'View', exact: true });
    await expect(view).toBeVisible();
    const media = view.getByRole('menuitemcheckbox', {
      name: 'Media library',
      exact: true,
    });
    await expect(media).not.toBeChecked();
    await expect(media).toBeDisabled();
    await expect(view).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(view).not.toBeVisible();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(settings).toBeFocused();

    await settings.press('ArrowDown');
    await expect(project).toBeFocused();
    await page.keyboard.press('End');
    await expect(
      menu.getByRole('menuitem', { name: /^Browser agent/ }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    const browserAgent = page.getByRole('dialog', {
      name: 'Browser agent',
      exact: true,
    });
    await expect(browserAgent).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(browserAgent).not.toBeVisible();
    await expect(settings).toBeFocused();

    await settings.click();
    await expect(menu).toBeVisible();
    await settings.click();
    await expect(menu).not.toBeVisible();
    await settings.click();
    await menu.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await projectMenu
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'New project',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(menu).not.toBeVisible();
    await expect(
      dialog.getByLabel('Project name', { exact: true }),
    ).toBeFocused();
    await dialog
      .getByLabel('Project name', { exact: true })
      .fill('Menu project');
    await dialog
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Menu project');
    await openWorkspaceGroup(page, 'Project');
    await expect(
      projectMenu.getByRole('menuitem', {
        name: 'Download project backup',
        exact: true,
      }),
    ).toBeEnabled();
    await page.keyboard.press('ArrowLeft');
    await menu.getByRole('menuitem', { name: 'View', exact: true }).click();
    await media.focus();
    await page.keyboard.press('Space');
    await expect(media).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await menu.getByRole('menuitem', { name: 'Export', exact: true }).click();
    const exports = page.getByRole('menu', { name: 'Export', exact: true });
    await expect(exports).toBeVisible();
    await expect(
      exports.getByRole('menuitemradio', { name: 'MP4', exact: true }),
    ).toBeChecked();
    const webm = exports.getByRole('menuitemradio', {
      name: 'WebM',
      exact: true,
    });
    await webm.click();
    await expect(webm).toBeChecked();
    await expect(exports).toBeVisible();
    await expect(
      exports.getByRole('menuitem', { name: 'Export video', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(settings).toBeFocused();

    await page.setViewportSize({ width: 320, height: 844 });
    await settings.click();
    await menu.getByRole('menuitem', { name: 'View', exact: true }).click();
    await expect(view).toBeVisible();
    for (const popup of [menu, view]) {
      const bounds = await popup.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(settings).toBeFocused();
  });
}
