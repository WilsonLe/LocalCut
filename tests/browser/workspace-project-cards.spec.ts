import { expect, test } from '@playwright/test';

for (const base of ['/', '/LocalCut/']) {
  test(`project cards manage rename thumbnails archive and restore ${base}`, async ({
    page,
  }, testInfo) => {
    await page.goto(base);
    const { id, image } = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        `${base}editor.js`
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        const project = await editor.projects.create('Summer film');
        const canvas = new OffscreenCanvas(320, 480);
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#86b5ce';
        context.fillRect(0, 0, 320, 480);
        context.fillStyle = '#dfb871';
        context.fillRect(0, 240, 320, 240);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const asset = await editor.assets.import(blob, 'Summer.png').completion;
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: 'image',
          operations: [
            {
              type: 'addTrack',
              track: {
                id: 'cover-track',
                kind: 'video',
                clips: [],
                muted: false,
              },
            },
            {
              type: 'insertClip',
              trackId: 'cover-track',
              clip: {
                id: 'cover-clip',
                kind: 'image',
                assetId: asset.id,
                startUs: 0,
                durationUs: 3000000,
              },
            },
          ],
        });
        await editor.projects.versions.save(project.id);
        return {
          id: project.id,
          image: Array.from(new Uint8Array(await blob.arrayBuffer())),
        };
      } finally {
        await editor.dispose();
      }
    }, base);
    await page
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
    const browser = page.getByRole('main', { name: 'Projects', exact: true });
    const card = browser
      .getByRole('listitem')
      .filter({ hasText: 'Summer film' });
    await expect(card.locator('.project-card-thumbnail img')).toBeVisible();
    await card
      .getByRole('button', { name: 'Actions for Summer film', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: 'Rename', exact: true }),
    ).toBeVisible();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    let dialog = page.getByRole('dialog', {
      name: 'Rename project',
      exact: true,
    });
    await dialog.getByLabel('Project name').fill('  Road trip  ');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const actions = browser.getByRole('button', {
      name: 'Actions for Road trip',
      exact: true,
    });
    await expect(actions).toBeVisible();
    await actions.click();
    await page
      .getByRole('menuitem', { name: 'Adjust thumbnail', exact: true })
      .click();
    dialog = page.getByRole('dialog', {
      name: 'Adjust thumbnail',
      exact: true,
    });
    await dialog.getByLabel('Thumbnail image').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: Buffer.from(image),
    });
    await expect(
      dialog.getByRole('img', { name: 'Thumbnail preview' }),
    ).toBeVisible();
    await dialog.getByLabel('Vertical position').fill('80');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(browser.locator('.project-card-thumbnail img')).toHaveCSS(
      'object-position',
      '50% 80%',
    );
    await page.reload();
    await expect(browser.locator('.project-card-thumbnail img')).toHaveCSS(
      'object-position',
      '50% 80%',
    );
    await actions.click();
    await page
      .getByRole('menuitem', { name: 'Archive project', exact: true })
      .click();
    await expect(
      browser.getByText('No saved projects yet', { exact: true }),
    ).toBeVisible();
    await browser
      .getByRole('button', { name: 'Archived', exact: true })
      .click();
    await expect(actions).toBeVisible();
    await page.reload();
    await browser
      .getByRole('button', { name: 'Archived', exact: true })
      .click();
    await expect(actions).toBeVisible();
    // Authoritative storage, conflicts, undo and versions remain independent of catalog organization.
    const state = await page.evaluate(
      async ({ base, id }) => {
        const { createEditor } = (await import(
          `${base}editor.js`
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          const entry = (await editor.projects.catalog()).find(
            (entry) => entry.project.id === id,
          )!;
          let conflict = '';
          try {
            await editor.projects.updateCatalog(id, entry.revision - 1, {
              archived: false,
            });
          } catch (error) {
            conflict = (error as { code: string }).code;
          }
          const noChange = await editor.projects.updateCatalog(
            id,
            entry.revision,
            { archived: undefined, thumbnail: undefined },
          );
          if (!noChange.archived || !noChange.thumbnail)
            throw new Error(
              'Undefined patch fields cleared saved catalog details',
            );
          const before = await editor.projects.snapshot(id);
          await editor.commands.undo(id, 'undo-rename', before.revision);
          const undone = await editor.projects.snapshot(id);
          await editor.commands.redo(id, 'redo-rename', undone.revision);
          const restored = (await editor.projects.catalog()).find(
            (entry) => entry.project.id === id,
          )!;
          return {
            conflict,
            oldName: undone.name,
            name: restored.project.name,
            archived: restored.archived,
            thumbnail: restored.thumbnail?.size,
            clipCount: restored.project.tracks.flatMap((track) => track.clips)
              .length,
            versionCount: (await editor.projects.versions.list(id)).length,
          };
        } finally {
          await editor.dispose();
        }
      },
      { base, id },
    );
    expect(state).toMatchObject({
      conflict: 'REVISION_CONFLICT',
      oldName: 'Summer film',
      name: 'Road trip',
      archived: true,
      clipCount: 1,
    });
    expect(state.thumbnail).toBeGreaterThan(0);
    expect(state.versionCount).toBeGreaterThan(1);
    await actions.click();
    await page
      .getByRole('menuitem', { name: 'Restore project', exact: true })
      .click();
    await expect(
      browser.getByText('No archived projects', { exact: true }),
    ).toBeVisible();
    await expect(
      browser.getByRole('button', { name: 'Archived', exact: true }),
    ).toBeFocused();
    await browser.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(actions).toBeVisible();
    await actions.click();
    await page
      .getByRole('menuitem', { name: 'Adjust thumbnail', exact: true })
      .click();
    dialog = page.getByRole('dialog', {
      name: 'Adjust thumbnail',
      exact: true,
    });
    await dialog
      .getByRole('button', { name: 'Use automatic thumbnail', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(browser.locator('.project-card-thumbnail img')).toHaveCSS(
      'object-position',
      '50% 50%',
    );
    // A form authored before an external rename must report conflict and require a deliberate reload.
    await actions.click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
    await dialog.getByLabel('Project name').fill('Stale name');
    await page.evaluate(
      async ({ base, id }) => {
        const { createEditor } = (await import(
          `${base}editor.js`
        )) as typeof import('../../src/editor');
        const editor = await createEditor();
        try {
          const project = await editor.projects.snapshot(id);
          await editor.commands.apply({
            projectId: id,
            expectedRevision: project.revision,
            requestId: 'external-rename',
            operations: [{ type: 'renameProject', name: 'External name' }],
          });
        } finally {
          await editor.dispose();
        }
      },
      { base, id },
    );
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Expected revision');
    await dialog
      .getByRole('button', { name: 'Reload project details', exact: true })
      .click();
    await expect(dialog.getByLabel('Project name')).toHaveValue(
      'External name',
    );
    await dialog.getByLabel('Project name').fill('Road trip');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await actions.click();
    await page
      .getByRole('menuitem', { name: 'Export backup', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Export project', exact: true }),
    ).toBeVisible();
    const backupDialog = page.getByRole('dialog', {
      name: 'Export project',
      exact: true,
    });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      backupDialog
        .getByRole('button', { name: 'Download backup', exact: true })
        .click(),
    ]);
    expect(download.suggestedFilename()).toContain('localcut');
    await expect(backupDialog).not.toBeVisible();
    await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        `${base}editor.js`
      )) as typeof import('../../src/editor');
      const editor = await createEditor();
      try {
        await editor.projects.create('Studio notes');
        await editor.projects.create('Weekend edit');
      } finally {
        await editor.dispose();
      }
    }, base);
    await expect(browser.getByRole('listitem')).toHaveCount(3);
    await expect(browser.locator('.project-card-thumbnail img')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('project-cards-desktop.png'),
    });
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await actions.click();
    await expect(
      page.getByRole('menuitem', { name: 'Rename', exact: true }),
    ).toBeInViewport();
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: testInfo.outputPath('project-cards-narrow.png'),
    });
    await actions.focus();
    await page.keyboard.press('Enter');
    await page
      .getByRole('menuitem', { name: 'Archive project', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(browser.getByRole('listitem')).toHaveCount(2);
    await expect(
      browser.getByRole('button', { name: 'Active', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      browser.getByRole('button', { name: 'Archived', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(browser.getByRole('listitem')).toHaveCount(1);
    await actions.focus();
    await page.keyboard.press('Enter');
    await page
      .getByRole('menuitem', { name: 'Restore project', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(
      browser.getByRole('button', { name: 'Archived', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(
      browser.getByRole('button', { name: 'Active', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(browser.getByRole('listitem')).toHaveCount(3);
    await browser
      .locator('.project-browser-row')
      .filter({ hasText: 'Road trip' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Road trip');
  });
}
