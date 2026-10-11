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
