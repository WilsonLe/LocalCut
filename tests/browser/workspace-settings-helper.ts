import type { Page } from '@playwright/test';

export async function openAISettings(page: Page) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'AI settings', exact: true })
    .click();
}
