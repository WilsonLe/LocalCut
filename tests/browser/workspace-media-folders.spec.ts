import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeMediaImport } from './workspace-import-helper';

for (const base of ['/', '/LocalCut/']) {
  test(`workspace media folders upload, dragging, menus and reload ${base}`, async ({
    page,
  }, info) => {
    await page.goto(base);
    page.setDefaultTimeout(15000);
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'New project', exact: true })
      .click();
    await page
      .getByLabel('Project name', { exact: true })
      .fill('Media folders');
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    // The durable project can appear before the creation action releases its lock.
    await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
    const bytes = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(32, 32);
      canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
      return [
        ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
      ];
    });
    await page.getByLabel('Import media', { exact: true }).setInputFiles({
      name: 'root.png',
      mimeType: 'image/png',
      buffer: Buffer.from(bytes),
    });
    await closeMediaImport(page);
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const creation = page.getByRole('dialog', {
      name: 'New folder',
      exact: true,
    });
    await creation.getByLabel('Name', { exact: true }).fill('Shots');
    await creation
      .getByRole('button', { name: 'New folder', exact: true })
      .click();
    await expect(creation).toBeHidden();
    const folder = page.getByRole('button', {
      name: 'Open folder Shots',
      exact: true,
    });
    await expect(folder).toBeVisible();
    const source = await page
      .getByRole('button', { name: 'Asset details for root.png', exact: true })
      .boundingBox();
    const target = await folder.boundingBox();
    await page.mouse.move(
      source!.x + source!.width / 2,
      source!.y + source!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      target!.x + target!.width / 2,
      target!.y + target!.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for root.png',
        exact: true,
      }),
    ).toHaveCount(0);
    await folder.click();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for root.png',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Actions for root.png', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename', exact: true });
    await rename.getByLabel('Name', { exact: true }).fill('cover.png');
    await rename.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(rename).toBeHidden();
    // Actual directory picker preserves its relative hierarchy and does not flatten files.
    const fixture = await mkdtemp(join(tmpdir(), 'localcut-folder-'));
    try {
      await mkdir(join(fixture, 'Upload', 'Nested'), { recursive: true });
      await writeFile(
        join(fixture, 'Upload', 'Nested', 'frame.png'),
        Buffer.from(bytes),
      );
      await page
        .locator('input[webkitdirectory]')
        .setInputFiles(join(fixture, 'Upload'));
      await closeMediaImport(page);
      await expect(
        page.getByRole('button', { name: 'Open folder Upload', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Open folder Upload', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Open folder Nested', exact: true })
        .click();
      await expect(
        page.getByRole('button', {
          name: 'Asset details for frame.png',
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath('media-folder-hierarchy.png'),
      });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
    // Empty directory drops are retained even without a media import.
    await page.locator('.media-grid').evaluate((node) => {
      const data = new DataTransfer();
      data.items.add(new File([''], 'directory-marker'));
      Object.defineProperty(data, 'items', {
        value: [
          {
            kind: 'file',
            webkitGetAsEntry: () => ({
              name: 'Empty',
              isDirectory: true,
              createReader: () => ({
                readEntries: (resolve: (entries: unknown[]) => void) =>
                  resolve([]),
              }),
            }),
          },
        ],
      });
      node.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      );
    });
    await closeMediaImport(page);
    await expect(
      page.getByRole('button', { name: 'Open folder Empty', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Media root', exact: true }).click();
    await page
      .getByRole('button', { name: 'Actions for Shots', exact: true })
      .focus();
    await page
      .getByRole('button', { name: 'Actions for Shots', exact: true })
      .click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
    expect((await downloading).suggestedFilename()).toBe('Shots.zip');
    await page
      .getByRole('button', { name: 'Actions for Shots', exact: true })
      .focus();
    await page
      .getByRole('button', { name: 'Actions for Shots', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete', exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(folder).toHaveCount(0);
    // Clips stay intact while the organized directory is in Trash.
    await expect(page.locator('.timeline-clip.image')).toHaveCount(2);
    await page
      .getByRole('button', { name: 'Open media Trash', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Actions for Shots', exact: true })
      .focus();
    await page
      .getByRole('button', { name: 'Actions for Shots', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
    await page.getByRole('button', { name: 'Media root', exact: true }).click();
    await expect(folder).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobile-media-trigger').click();
    await folder.click();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for cover.png',
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('media-folders-mobile.png'),
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(folder).toBeVisible();
    await folder.click();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for cover.png',
        exact: true,
      }),
    ).toBeVisible();
    // Removing the final timeline reference keeps the independent library entry.
    await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = (await editor.projects.list())[0]!;
        const current = await editor.projects.snapshot(project.id);
        await editor.commands.apply({
          projectId: current.id,
          expectedRevision: current.revision,
          requestId: 'remove-clips',
          operations: current.tracks.flatMap((track) =>
            track.clips.map((clip) => ({
              type: 'removeClip' as const,
              clipId: clip.id,
            })),
          ),
        });
      } finally {
        await editor.dispose();
      }
    }, base);
    await expect(page.locator('.timeline-clip.image')).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Asset details for cover.png',
        exact: true,
      }),
    ).toBeVisible();
    const unusedActions = page.getByRole('button', {
      name: 'Actions for cover.png',
      exact: true,
    });
    await unusedActions.focus();
    await unusedActions.click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete', exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Open media Trash', exact: true })
      .click();
    await expect(unusedActions).toBeVisible();
    await unusedActions.focus();
    await unusedActions.click();
    await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
    await page.getByRole('button', { name: 'Media root', exact: true }).click();
    await folder.click();
    await expect(unusedActions).toBeVisible();
    await expect(page.locator('.timeline-clip.image')).toHaveCount(0);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`folder drop traversal stays bound to its initiating project ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const ids = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const a = await editor.projects.create('Drop source');
        const b = await editor.projects.create('Drop destination');
        return { a: a.id, b: b.id };
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${ids.a}`);
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'New folder', exact: true }),
    ).toBeEnabled();
    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(16, 16);
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const file = new File([await canvas.convertToBlob()], 'late.png', {
        type: 'image/png',
      });
      const state = globalThis as unknown as {
        releaseDrop: () => void;
        traversalDone: boolean;
      };
      let first = true;
      const directory = {
        name: 'Late upload',
        isDirectory: true,
        isFile: false,
        createReader: () => ({
          readEntries: (done: (entries: unknown[]) => void) => {
            if (first) {
              first = false;
              state.releaseDrop = () =>
                done([
                  {
                    name: 'late.png',
                    isDirectory: false,
                    isFile: true,
                    file: (done: (file: File) => void) => done(file),
                  },
                ]);
            } else {
              state.traversalDone = true;
              done([]);
            }
          },
        }),
      };
      const data = new DataTransfer();
      data.items.add(file);
      Object.defineProperty(data, 'items', {
        value: [{ kind: 'file', webkitGetAsEntry: () => directory }],
      });
      document.querySelector('.media-grid')!.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      );
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            typeof (globalThis as unknown as { releaseDrop?: unknown })
              .releaseDrop,
        ),
      )
      .toBe('function');
    await page.evaluate((id) => {
      location.hash = '/project/' + id;
    }, ids.b);
    await expect(
      page.getByText('Drop destination', { exact: true }),
    ).toBeVisible();
    // Hash navigation retains the same document, leaving the old reader pending.
    await page.evaluate(() =>
      (globalThis as unknown as { releaseDrop: () => void }).releaseDrop(),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (globalThis as unknown as { traversalDone: boolean }).traversalDone,
        ),
      )
      .toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByRole('dialog', { name: 'Importing media' }),
    ).toHaveCount(0);
    const result = await page.evaluate(
      async ({ base, ids }) => {
        const { createEditor } = (await import(
          base + 'editor.js'
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          const a = await editor.projects.snapshot(ids.a);
          const b = await editor.projects.snapshot(ids.b);
          const libraries = await Promise.all(
            [ids.a, ids.b].map((id) => editor.library.forProject(id).list()),
          );
          return {
            clips: [a, b].map((p) => p.tracks.flatMap((t) => t.clips).length),
            lateFolder: libraries.some((library) =>
              library.entries.some((e) => e.name === 'Late upload'),
            ),
          };
        } finally {
          await editor.dispose();
        }
      },
      { base, ids },
    );
    expect(result).toEqual({ clips: [0, 0], lateFolder: false });
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`workspace project media roots reset navigation and keep unused media scoped ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const ids = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const a = await editor.projects.create('Media A');
        const b = await editor.projects.create('Media B');
        const canvas = new OffscreenCanvas(16, 16);
        canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
        const bytes = await canvas.convertToBlob();
        for (const [projectId, name] of [
          [a.id, 'A.png'],
          [b.id, 'B.png'],
        ] as const) {
          const asset = await editor.assets.import(
            new File([bytes], name, { type: 'image/png' }),
          ).completion;
          await editor.library.forProject(projectId).place(asset.id, ['Shots']);
        }
        return { a: a.id, b: b.id };
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${ids.a}`);
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Open folder Shots', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for A.png',
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate((id) => {
      location.hash = `/project/${id}`;
    }, ids.b);
    await expect(
      page.getByRole('button', { name: 'Open folder Shots', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for A.png',
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Open folder Shots', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for B.png',
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Open folder Shots', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Open folder Shots', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for B.png',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for A.png',
        exact: true,
      }),
    ).toHaveCount(0);
    await page.evaluate((id) => {
      location.hash = `/project/${id}`;
    }, ids.a);
    await page
      .getByRole('button', { name: 'Open folder Shots', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for A.png',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Asset details for B.png',
        exact: true,
      }),
    ).toHaveCount(0);
  });
}
