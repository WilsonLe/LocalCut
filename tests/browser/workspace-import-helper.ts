import { appendAsset } from '../../src/workspace/helpers';
import type { Editor, Asset } from '../../src/editor';
import { expect, type Page } from '@playwright/test';

/** Imports retain their result dialog until the user dismisses it. */
export async function closeMediaImport(page: Page) {
  const dialog = page.getByRole('dialog', {
    name: 'Import media',
    exact: true,
  });
  // Completion is an operation wait (the test's normal action deadline),
  // not a ten-second assertion on a potentially large queued selection.
  await dialog.getByText(/^Finished ·/).waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Okay', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

/** Editing fixtures explicitly place imported media; uploads themselves never edit. */
export async function closeMediaImportAndPlace(page: Page) {
  const dialog = page.getByRole('dialog', {
    name: 'Import media',
    exact: true,
  });
  await dialog.getByText(/^Finished ·/).waitFor({ state: 'visible' });
  const names = await dialog
    .locator('[data-status="completed"] .import-progress-name')
    .allTextContents();
  await closeMediaImport(page);
  const engine = await page.evaluateHandle(async () => {
    const { createEditor } = (await import(
      location.pathname + 'editor.js'
    )) as { createEditor(): Promise<Editor> };
    return createEditor();
  });
  try {
    const imported = await engine.evaluate(async (engine, names) => {
      const id = decodeURIComponent(
        location.hash.match(/^#\/project\/([^?]+)/)![1]!,
      );
      const entries = (await engine.library.forProject(id).list()).entries;
      return names.map((name) => {
        const entry = entries.find(
          (item) => item.assetId && item.name === name && !item.trashed,
        );
        if (!entry?.assetId)
          throw new Error('Imported fixture asset not found: ' + name);
        return { name, projectId: id, assetId: entry.assetId };
      });
    }, names);
    for (const { name, projectId, assetId } of imported) {
      const state = await engine.evaluate(
        async (engine, { projectId, assetId }) => ({
          project: await engine.projects.snapshot(projectId),
          asset: await engine.assets.inspect(assetId),
        }),
        { projectId, assetId },
      );
      const operations = appendAsset(state.project, state.asset as Asset);
      await engine.evaluate(
        async (engine, { project, operations }) => {
          await engine.commands.apply({
            projectId: project.id,
            expectedRevision: project.revision,
            requestId: crypto.randomUUID(),
            operations,
          });
        },
        { project: state.project, operations },
      );
      await expect(
        page.locator('.timeline-clip').filter({ hasText: name }).last(),
      ).toBeAttached();
      const clip = page
        .locator('.timeline-clip')
        .filter({ hasText: name })
        .last();
      if (await clip.isVisible()) await clip.click();
    }
  } finally {
    try {
      await engine.evaluate((engine) => engine.dispose());
    } finally {
      await engine.dispose();
    }
  }
}
