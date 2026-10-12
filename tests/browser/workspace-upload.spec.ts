import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeMediaImport } from './workspace-import-helper';
import { mediaVideo } from './workspace-video-fixture';

for (const base of ['/', '/LocalCut/']) {
  test(`mixed photo folder upload skips sidecars and leaves the timeline untouched ${base}`, async ({
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
    await page.getByLabel('Project name', { exact: true }).fill('Mixed folder');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
    const png = Buffer.from(
      await page.evaluate(async () => {
        const canvas = new OffscreenCanvas(32, 32);
        canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
        return [
          ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
        ];
      }),
    );
    const snapshot = () =>
      page.evaluate(async (base) => {
        const { createEditor } = await import(base + 'editor.js');
        const editor = await createEditor();
        try {
          const project = (await editor.projects.list()).find(
            (p: { name: string }) => p.name === 'Mixed folder',
          );
          return await editor.projects.snapshot(project.id);
        } finally {
          await editor.dispose();
        }
      }, base);
    const before = await snapshot();
    const root = await mkdtemp(join(tmpdir(), 'localcut-mixed-'));
    try {
      const folder = join(root, 'Trip');
      await mkdir(join(folder, 'Photos', 'Nested'), { recursive: true });
      await writeFile(
        join(folder, '.DS_Store'),
        Buffer.from([0, 0, 0, 1, 66, 117, 100, 49]),
      );
      await writeFile(
        join(folder, 'Photos', 'Nested', 'photo.AAE'),
        '<?xml version="1.0"?><plist/>',
      );
      await writeFile(
        join(folder, 'Photos', 'Nested', '._photo.png'),
        Buffer.from([0, 5, 22, 7]),
      );
      await writeFile(join(folder, 'Photos', 'Nested', 'photo.png'), png);
      const video = await mediaVideo(page);
      await writeFile(join(folder, 'clip.webm'), video.buffer);
      const expand = page.getByRole('button', {
        name: 'Expand media',
        exact: true,
      });
      if (await expand.isVisible()) await expand.click();
      await page.locator('input[webkitdirectory]').setInputFiles(folder);
      const dialog = page.getByRole('dialog', {
        name: 'Import media',
        exact: true,
      });
      await expect(dialog.getByText(/^Finished ·/)).toBeVisible({
        timeout: 60000,
      });
      await expect(dialog.locator('[data-status="completed"]')).toHaveCount(2);
      await expect(dialog.locator('[data-status="skipped"]')).toHaveCount(3);
      await expect(dialog.locator('[data-status="failed"]')).toHaveCount(0);
      await expect(dialog).toContainText('3 skipped');
      await closeMediaImport(page);
      expect(await snapshot()).toEqual(before);
      await expect(page.locator('.timeline-clip')).toHaveCount(0);
      const undo = await page.evaluate(
        async ({ base, id }) => {
          const { createEditor } = await import(base + 'editor.js');
          const editor = await createEditor();
          try {
            try {
              await editor.commands.undo(id, crypto.randomUUID(), 0);
              return 'accepted';
            } catch (error) {
              return (error as { code: string }).code;
            }
          } finally {
            await editor.dispose();
          }
        },
        { base, id: before.id },
      );
      expect(undo).toBe('INVALID_COMMAND');
      expect(await snapshot()).toEqual(before);
      await page.reload();
      await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
      expect(await snapshot()).toEqual(before);
      if (await expand.isVisible()) await expand.click();
      await page
        .getByRole('button', { name: 'Open folder Trip', exact: true })
        .click();
      await expect(
        page.getByRole('button', {
          name: 'Asset details for clip.webm',
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Open folder Photos', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Open folder Nested', exact: true })
        .click();
      await expect(
        page.getByRole('button', {
          name: 'Asset details for photo.png',
          exact: true,
        }),
      ).toBeVisible();
      await page.getByLabel('Import media', { exact: true }).setInputFiles({
        name: 'single.png',
        mimeType: 'image/png',
        buffer: png,
      });
      await closeMediaImport(page);
      expect(await snapshot()).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test(`unsupported import format is a nonretryable codec error from the real worker ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor({
        namespace: 'unsupported-' + crypto.randomUUID(),
      });
      try {
        try {
          await editor.assets.import(new File(['<plist/>'], 'notes.txt'))
            .completion;
          return { code: 'accepted', tasks: [] };
        } catch (error) {
          return {
            code: (error as { code: string }).code,
            tasks: await editor.tasks.list(),
          };
        }
      } finally {
        await editor.dispose();
      }
    }, base);
    expect(result.code).toBe('UNSUPPORTED_CODEC');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      state: 'failed',
      attempts: 1,
      error: { code: 'UNSUPPORTED_CODEC' },
    });
  });
}
