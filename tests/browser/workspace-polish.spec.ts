import { createWorkspace } from './workspace-project-helper';
import { behaviorBases } from './coverage-bases';
import { expect, test } from '@playwright/test';

for (const base of behaviorBases) {
  test(`workspace keeps metadata quiet, project forms spacious and media on the left ${base}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    for (const copy of [
      'Local media · Private by default',
      'No project open',
      'No AI provider connected. Manual editing is available.',
      'Describe the cut you want.',
      'On this device',
      '30 fps',
      '16:9 · 1080p',
    ]) {
      await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
    }
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toHaveCount(1);
    await expect(
      page
        .locator('header.workspace-header')
        .getByRole('button', { name: 'Media', exact: true }),
    ).toHaveCount(0);
    await createWorkspace(page);
    const previewInfo = page.getByRole('button', { name: 'Preview settings' });
    await expect(previewInfo).toHaveAttribute('data-base-ui-tooltip-trigger');
    await page.keyboard.press('Tab');
    await previewInfo.focus();
    await expect(page.getByRole('tooltip')).toContainText(
      '1920 × 1080 · 30 fps',
    );
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'New project',
      exact: true,
    });
    const spacing = await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const field = element.querySelector('input')!.getBoundingClientRect();
      const label = element.querySelector('label')!.getBoundingClientRect();
      const footer = element
        .querySelector('[data-slot="dialog-footer"]')!
        .getBoundingClientRect();
      return {
        padding: field.left - box.left,
        labelGap: field.top - label.bottom,
        footerGap: footer.top - field.bottom,
      };
    });
    expect(spacing.padding).toBeGreaterThanOrEqual(24);
    expect(spacing.labelGap).toBeGreaterThanOrEqual(10);
    expect(spacing.footerGap).toBeGreaterThanOrEqual(24);
    await dialog.getByLabel('Project name').fill('Polished workspace');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Expand media' }).click();
    const media = page.getByRole('complementary', {
      name: 'Media library',
      exact: true,
    });
    await expect(
      media.getByRole('button', { name: 'Import media', exact: true }),
    ).toBeVisible();
    const editor = page.getByRole('main', { name: 'Video editor' });
    await expect
      .poll(
        async () =>
          (await editor.boundingBox())!.x -
          ((await media.boundingBox())!.x + (await media.boundingBox())!.width),
      )
      .toBeCloseTo(1, 0);
    await page.getByRole('button', { name: 'Collapse media' }).click();
    await expect(
      media.getByRole('button', { name: 'Import media', exact: true }),
    ).toBeHidden();
    await page.setViewportSize({ width: 768, height: 900 });
    await page.getByRole('button', { name: 'Expand media' }).click();
    const properties = page.getByRole('button', {
      name: 'Add text',
      exact: true,
    });
    await expect(properties).toBeVisible();
    await expect
      .poll(async () => {
        const action = (await properties.boundingBox())!;
        const area = (await editor.boundingBox())!;
        return (
          action.x >= area.x && action.x + action.width <= area.x + area.width
        );
      })
      .toBe(true);
    await page.getByRole('button', { name: 'Collapse media' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const navigation = page.getByRole('navigation', {
      name: 'Workspace sections',
    });
    await navigation.getByRole('button', { name: 'Expand media' }).click();
    await expect(media).toBeInViewport();
    await expect(editor).toBeHidden();
    await expect(
      media.getByRole('button', { name: 'Import media', exact: true }),
    ).toBeVisible();
    const bounds = (await media.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await navigation.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Expand media' }),
    ).toBeInViewport();
  });
}
