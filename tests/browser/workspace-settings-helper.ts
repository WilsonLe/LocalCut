import type { Page } from '@playwright/test';

export async function openAISettings(page: Page) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'AI settings', exact: true })
    .click();
}

export async function openWorkspaceGroup(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await page
    .getByRole('menu', { name: 'Workspace settings', exact: true })
    .getByRole('menuitem', { name, exact: true })
    .click();
  return page.getByRole('menu', { name, exact: true });
}

export async function openVersions(page: Page) {
  const group = await openWorkspaceGroup(page, 'Project');
  await group.getByRole('menuitem', { name: 'Versions', exact: true }).click();
}

export async function openVideoExport(page: Page) {
  const group = await openWorkspaceGroup(page, 'Export');
  await group
    .getByRole('menuitem', { name: 'Export video', exact: true })
    .click();
}
