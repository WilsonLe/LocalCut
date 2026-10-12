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
  for (const name of names) {
    const state = await page.evaluate(async (name) => {
      const { createEditor } = (await import(
        location.pathname + 'editor.js'
      )) as { createEditor(): Promise<Editor> };
      const engine = await createEditor();
      try {
        const id = decodeURIComponent(
          location.hash.match(/^#\/project\/([^?]+)/)![1]!,
        );
        const project = await engine.projects.snapshot(id);
        const entries = (await engine.library.forProject(id).list()).entries;
        const entry = entries.find(
          (item) => item.assetId && item.name === name && !item.trashed,
        );
        if (!entry?.assetId)
          throw new Error('Imported fixture asset not found: ' + name);
        return { project, asset: await engine.assets.inspect(entry.assetId) };
      } finally {
        await engine.dispose();
      }
    }, name);
    const operations = appendAsset(state.project, state.asset as Asset);
    await page.evaluate(
      async ({ project, operations }) => {
        const { createEditor } = (await import(
          location.pathname + 'editor.js'
        )) as { createEditor(): Promise<Editor> };
        const engine = await createEditor();
        try {
          await engine.commands.apply({
            projectId: project.id,
            expectedRevision: project.revision,
            requestId: crypto.randomUUID(),
            operations,
          });
        } finally {
          await engine.dispose();
        }
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
}
