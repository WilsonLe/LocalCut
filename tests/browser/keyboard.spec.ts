import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/core/model';

async function snapshot(
  page: Page,
  base: string,
  name: string,
): Promise<Project> {
  return page.evaluate(
    async ({ base, name }) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list()).find(
          (item: Project) => item.name === name,
        );
        if (!project) throw new Error('Keyboard project was not persisted');
        return await editor.projects.snapshot(project.id);
      } finally {
        await editor.dispose();
      }
    },
    { base, name },
  );
}

for (const base of ['/', '/LocalCut/']) {
  test(`keyboard editing respects typing, native controls and modal focus ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const workspace = page.getByRole('main', {
      name: 'Video editor',
      exact: true,
    });
    await workspace.focus();
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog', {
      name: 'New project',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const name = `Keyboard ${base}`;
    const input = dialog.getByLabel('Project name', { exact: true });
    await input.fill(name);
    await input.press('s');
    await expect(input).toHaveValue(name + 's');
    await input.fill(name);
    await dialog
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();

    const png = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(128, 72);
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#3f92b7';
      context.fillRect(0, 0, 128, 72);
      return [
        ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
      ];
    });
    const choosing = page.waitForEvent('filechooser');
    await workspace.focus();
    await page.keyboard.press('ControlOrMeta+i');
    await (
      await choosing
    ).setFiles({
      name: 'keyboard.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png),
    });
    await expect(
      page.getByRole('button', { name: 'keyboard.png', exact: true }).first(),
    ).toBeVisible();
    const clips = async () =>
      (await snapshot(page, base, name)).tracks.flatMap((track) => track.clips);
    await expect.poll(async () => (await clips()).length).toBe(1);
    // Import completion closes a modal and restores focus after its exit motion.
    await expect(
      page.locator(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      ),
    ).toHaveCount(0);
    await workspace.focus();
    await expect(workspace).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(
      page.getByRole('slider', { name: 'Playhead position', exact: true }),
    ).toHaveValue('1000000');
    await page.keyboard.press('s');
    await expect.poll(async () => (await clips()).length).toBe(2);
    await page
      .getByRole('button', { name: 'keyboard.png', exact: true })
      .first()
      .click();
    await workspace.focus();
    await page.keyboard.press('d');
    await expect.poll(async () => (await clips()).length).toBe(3);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await clips()).length).toBe(2);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await clips()).length).toBe(3);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(async () => (await clips()).length).toBe(2);

    await workspace.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Space');
    await expect(
      page.getByRole('button', { name: 'Pause preview', exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        Number(
          await page
            .getByRole('slider', { name: 'Playhead position', exact: true })
            .inputValue(),
        ),
      )
      .toBeGreaterThan(50_000);
    await page.keyboard.press('Space');
    await expect(
      page.getByRole('button', { name: 'Play preview', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', {
      name: 'Keyboard shortcuts',
      exact: true,
    });
    await expect(help).toBeVisible();
    const before = (await snapshot(page, base, name)).revision;
    await page.keyboard.press('d');
    await page.keyboard.press('Delete');
    expect((await snapshot(page, base, name)).revision).toBe(before);
    await page.keyboard.press('Escape');
    await expect(help).not.toBeVisible();

    const newProject = page.getByRole('button', {
      name: 'New project',
      exact: true,
    });
    await newProject.focus();
    await page.keyboard.press('Space');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    expect((await snapshot(page, base, name)).revision).toBe(before);
  });
}
