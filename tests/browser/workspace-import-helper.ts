import { expect, type Page } from '@playwright/test';

/** Imports retain their result dialog until the user dismisses it. */
export async function closeMediaImport(page: Page) {
  const dialog = page.getByRole('dialog', {
    name: 'Import media',
    exact: true,
  });
  await expect(dialog).toContainText('Finished');
  await dialog.getByRole('button', { name: 'Okay', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
