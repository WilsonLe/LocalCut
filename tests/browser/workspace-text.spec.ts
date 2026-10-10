import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/core/model';

async function snapshot(page: Page, base: string): Promise<Project> {
  return page.evaluate(async (base) => {
    const { createEditor } = await import(base + 'editor.js');
    const editor = await createEditor();
    try {
      return await editor.projects.snapshot(
        (await editor.projects.list()).find(
          (p: Project) => p.name === 'Text library',
        )!.id,
      );
    } finally {
      await editor.dispose();
    }
  }, base);
}
for (const base of ['/', '/LocalCut/']) {
  test(`searchable fonts and text templates insert, edit, undo and reload ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page.getByLabel('Project name').fill('Text library');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Add text', exact: true });
    await expect(library.getByRole('button', { name: /^Insert / })).toHaveCount(
      12,
    );
    if (base === '/')
      await page.screenshot({
        animations: 'disabled',
        path: 'docs/images/text-library.png',
      });
    await library.getByLabel('Search text library').fill('unmatched');
    await expect(
      library.getByText('No matches.', { exact: false }),
    ).toBeVisible();
    await library.getByLabel('Search text library').fill('cute');
    await library.getByRole('button', { name: 'Fonts', exact: true }).click();
    await expect(library.getByRole('button', { name: /^Insert / })).toHaveCount(
      2,
    );
    await library
      .getByRole('button', { name: 'Templates', exact: true })
      .click();
    await library.getByLabel('Search text library').fill('curved');
    await library
      .getByRole('button', { name: 'Insert Around the sun', exact: true })
      .click();
    const properties = page.getByRole('dialog', {
      name: 'Clip properties',
      exact: true,
    });
    await expect(properties).toBeVisible();
    const clip = (await snapshot(page, base)).tracks[0]!.clips[0]!;
    expect(clip.text).toMatchObject({
      curve: 100,
      fontFamily: 'rounded',
      fontWeight: 'bold',
    });
    await properties
      .getByLabel('Text', { exact: true })
      .fill('Summer memories');
    await properties
      .getByRole('combobox', { name: 'Font', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Search fonts', exact: true })
      .fill('minimal mono');
    await page.getByRole('option', { name: /Minimal mono/ }).click();
    await properties
      .getByRole('button', { name: 'Shadow', exact: true })
      .click();
    await properties.getByLabel('Highlight color').fill('#fde047');
    await properties.getByLabel('Text color').fill('#18181b');
    await properties.getByLabel('Outline width').fill('2');
    await properties
      .getByRole('button', { name: 'Apply properties', exact: true })
      .click();
    await expect(properties).not.toBeVisible();
    expect(
      (await snapshot(page, base)).tracks[0]!.clips[0]!.text,
    ).toMatchObject({
      text: 'Summer memories',
      fontFamily: 'mono',
      curve: 100,
      background: '#fde047',
      outlineWidth: 2,
      shadow: { blur: 8 },
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base)).tracks[0]!.clips[0]!.text!.text,
      )
      .toBe('AROUND THE SUN');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(page, base)).tracks[0]!.clips[0]!.text!.text,
      )
      .toBe('Summer memories');
    await page.reload();
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    await page.getByRole('button', { name: /^Text library/ }).click();
    await page
      .getByRole('button', { name: 'Summer memories', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Clip properties', exact: true })
      .click();
    await expect(page.getByLabel('Curve (degrees)')).toHaveValue('100');
    await expect(
      page.getByRole('combobox', { name: 'Font', exact: true }),
    ).toContainText('Minimal mono');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    await expect(library).toBeVisible();
    await expect(
      library.getByRole('button', { name: 'Insert Plain text', exact: true }),
    ).toBeVisible();
    if (base === '/')
      await page.screenshot({
        animations: 'disabled',
        path: 'docs/images/text-library-narrow.png',
      });
    await library.getByLabel('Search text library').fill('highlighted');
    await library
      .getByRole('button', { name: 'Insert Highlight', exact: true })
      .click();
    await expect(properties).toBeVisible();
    await properties
      .getByRole('button', { name: 'Apply properties' })
      .scrollIntoViewIfNeeded();
    await expect(
      properties.getByRole('button', { name: 'Apply properties' }),
    ).toBeInViewport();
  });
}
