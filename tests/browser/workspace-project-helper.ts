import { expect, type Page } from '@playwright/test';

/** Editor-only journeys create a workspace explicitly from the root catalog. */
export async function createWorkspace(page: Page, name = 'Test workspace') {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Open project', exact: true }),
  ).toContainText(name);
  return page.url();
}

/** Keep race-fixture handles alive while exercising browser-history navigation. */
export async function navigateWorkspace(page: Page, path: string) {
  await page.evaluate((path) => {
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
