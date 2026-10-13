import { behaviorBases } from './coverage-bases';
import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeMediaImport,
  closeMediaImportAndPlace,
} from './workspace-import-helper';

for (const base of behaviorBases) {
  test(`media select-all stays scoped to visible assets and preserves native inputs ${base}`, async ({
    page,
  }, info) => {
    page.setDefaultTimeout(15000);
    await page.goto(base);
    const workspace = page.getByRole('main', {
      name: 'Video editor',
      exact: true,
    });
    await workspace.focus();
    await page.keyboard.press('n');
    const create = page.getByRole('dialog', {
      name: 'New project',
      exact: true,
    });
    await create
      .getByLabel('Project name', { exact: true })
      .fill('Media selection');
    await create
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await expect(create).toBeHidden();
    const bytes = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(32, 32);
      canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
      return [
        ...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()),
      ];
    });
    await page.getByLabel('Import media', { exact: true }).setInputFiles(
      ['first.png', 'second.png'].map((name) => ({
        name,
        mimeType: 'image/png',
        buffer: Buffer.from(bytes),
      })),
    );
    await closeMediaImportAndPlace(page);
    const media = page.getByRole('region', {
      name: 'Project media',
      exact: true,
    });
    const first = media.getByRole('button', {
      name: 'Asset details for first.png',
      exact: true,
    });
    const second = media.getByRole('button', {
      name: 'Asset details for second.png',
      exact: true,
    });
    const selected = page.locator(
      '.media-library .media-item[data-selected="true"]',
    );
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    for (const mod of ['Meta', 'Control']) {
      await first.focus();
      await page.keyboard.press(`${mod}+a`);
      await expect(selected).toHaveCount(2);
      await expect(first).toHaveAttribute('aria-pressed', 'true');
      await expect(second).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');
      await expect(selected).toHaveCount(0);
      await first.click();
      // macOS reserves Ctrl-click for context menus; dispatch the Windows click
      // modifier while retaining native Cmd-click and both native key chords.
      if (mod === 'Control')
        await second.dispatchEvent('click', { ctrlKey: true, detail: 1 });
      else await second.click({ modifiers: ['Meta'] });
      await expect(selected).toHaveCount(2);
      if (mod === 'Control')
        await first.dispatchEvent('click', { ctrlKey: true, detail: 1 });
      else await first.click({ modifiers: ['Meta'] });
      await expect(selected).toHaveCount(1);
      await expect(second).toHaveAttribute('aria-pressed', 'true');
    }
    await media.focus();
    await page.keyboard.press('Control+a');
    await expect(selected).toHaveCount(2);
    await page.screenshot({ path: info.outputPath('media-selection.png') });
    // Select-all on the timeline still selects clips rather than media cards.
    await workspace.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(
      page.locator('.timeline-clip[aria-pressed="true"]'),
    ).toHaveCount(2);
    await expect(selected).toHaveCount(2);
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const folderDialog = page.getByRole('dialog', {
      name: 'New folder',
      exact: true,
    });
    const input = folderDialog.getByLabel('Name', { exact: true });
    await input.fill('Empty folder');
    await input.press('ControlOrMeta+a');
    expect(
      await input.evaluate((node: HTMLInputElement) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([0, 12]);
    await expect(selected).toHaveCount(2);
    await folderDialog
      .getByRole('button', { name: 'New folder', exact: true })
      .click();
    await expect(folderDialog).toBeHidden();
    await page
      .getByRole('button', { name: 'Open folder Empty folder', exact: true })
      .click();
    await expect(selected).toHaveCount(0);
    await media.focus();
    await page.keyboard.press('Meta+a');
    await expect(selected).toHaveCount(0);
    await page.getByRole('button', { name: 'Media root', exact: true }).click();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    // A cancelled drag must not suppress the next pointer selection in Trash.
    await first.focus();
    await page
      .getByRole('button', { name: 'Actions for first.png', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const remove = page.getByRole('dialog', { name: 'Delete', exact: true });
    await remove.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(remove).toBeHidden();
    await expect(first).toHaveCount(0);
    const box = (await second.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + 20);
    await expect(page.locator('.media-drag-preview')).toBeVisible();
    await second.dispatchEvent('pointercancel');
    await expect(page.locator('.media-drag-preview')).toHaveCount(0);
    await page.mouse.up();
    await page
      .getByRole('button', { name: 'Open media Trash', exact: true })
      .click();
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await first.click({ modifiers: ['Meta'] });
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await first.click({ modifiers: ['Meta'] });
    await expect(first).toHaveAttribute('aria-pressed', 'true');
  });
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
    await closeMediaImportAndPlace(page);
    const breadcrumbs = page.getByRole('navigation', {
      name: 'Media folder path',
      exact: true,
    });
    const toolbar = page.getByRole('region', {
      name: 'Media actions',
      exact: true,
    });
    await expect(breadcrumbs).toHaveCount(0);
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
    await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText(
      'Shots',
    );
    await expect(
      toolbar.getByRole('button', { name: 'Media root', exact: true }),
    ).toHaveCount(0);
    const toolbarBounds = (await toolbar.boundingBox())!;
    const pathBounds = (await breadcrumbs.boundingBox())!;
    expect(pathBounds.y).toBeGreaterThanOrEqual(
      toolbarBounds.y + toolbarBounds.height,
    );
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
      await mkdir(
        join(
          fixture,
          'Upload',
          'Nested folder with a very long name for breadcrumb overflow',
        ),
        { recursive: true },
      );
      await writeFile(
        join(
          fixture,
          'Upload',
          'Nested folder with a very long name for breadcrumb overflow',
          'frame.png',
        ),
        Buffer.from(bytes),
      );
      await page
        .locator('input[webkitdirectory]')
        .setInputFiles(join(fixture, 'Upload'));
      await closeMediaImportAndPlace(page);
      await expect(
        page.getByRole('button', { name: 'Open folder Upload', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Open folder Upload', exact: true })
        .click();
      await page
        .getByRole('button', {
          name: 'Open folder Nested folder with a very long name for breadcrumb overflow',
          exact: true,
        })
        .click();
      await expect(
        page.getByRole('button', {
          name: 'Asset details for frame.png',
          exact: true,
        }),
      ).toBeVisible();
      await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText(
        'Nested folder with a very long name for breadcrumb overflow',
      );
      const currentBounds = (await breadcrumbs
        .locator('[aria-current="page"]')
        .boundingBox())!;
      const desktopPath = (await breadcrumbs.boundingBox())!;
      expect(currentBounds.x).toBeGreaterThanOrEqual(desktopPath.x);
      expect(currentBounds.x + currentBounds.width).toBeLessThanOrEqual(
        desktopPath.x + desktopPath.width + 1,
      );
      await breadcrumbs
        .getByRole('button', { name: 'Shots', exact: true })
        .focus();
      await page.keyboard.press('Enter');
      await expect(
        breadcrumbs.getByRole('button', { name: 'Shots', exact: true }),
      ).toBeFocused();
      await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText(
        'Shots',
      );
      await page
        .getByRole('button', { name: 'Open folder Upload', exact: true })
        .click();
      await page
        .getByRole('button', {
          name: 'Open folder Nested folder with a very long name for breadcrumb overflow',
          exact: true,
        })
        .click();
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
    await expect(breadcrumbs).toHaveCount(0);
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
    await page
      .getByRole('button', { name: 'Open folder Upload', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Open folder Nested folder with a very long name for breadcrumb overflow',
        exact: true,
      })
      .click();
    await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText(
      'Nested folder with a very long name for breadcrumb overflow',
    );
    const mobilePath = (await breadcrumbs.boundingBox())!;
    expect(mobilePath.x).toBeGreaterThanOrEqual(0);
    expect(mobilePath.x + mobilePath.width).toBeLessThanOrEqual(390);
    expect(
      await breadcrumbs.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    const currentMobile = (await breadcrumbs
      .locator('[aria-current="page"]')
      .boundingBox())!;
    expect(currentMobile.x).toBeGreaterThanOrEqual(mobilePath.x);
    expect(currentMobile.x + currentMobile.width).toBeLessThanOrEqual(
      mobilePath.x + mobilePath.width + 1,
    );
    await breadcrumbs.evaluate((node) => {
      node.scrollLeft = 0;
    });
    await breadcrumbs.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => breadcrumbs.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);
    await page.screenshot({
      path: info.outputPath('media-folders-mobile.png'),
    });
    await breadcrumbs
      .getByRole('button', { name: 'Shots', exact: true })
      .click();
    await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText(
      'Shots',
    );
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

for (const base of behaviorBases) {
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

for (const base of behaviorBases) {
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
    await page
      .getByRole('region', { name: 'Project media', exact: true })
      .focus();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(
      page.getByRole('button', {
        name: 'Asset details for A.png',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
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
    await expect(
      page.getByRole('button', {
        name: 'Asset details for B.png',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'false');
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
