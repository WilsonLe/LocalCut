import { expect, type Page } from '@playwright/test';

export async function waitForWorkspaceSettings(page: Page) {
  // Hidden does not mean the closing popup has released its focus manager.
  // Wait for the non-retained project dialog to unmount before opening a menu.
  await expect(
    page.getByRole('dialog', {
      name: 'New project',
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(0);
  // Restoration and popup cleanup schedule focus on animation frames.
  // Wait through the next paint so their focus handoff cannot close this menu.
  await expect(
    page.getByRole('region', { name: 'Project navigation', exact: true }),
  ).toBeHidden();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function openWorkspaceSettings(page: Page) {
  await waitForWorkspaceSettings(page);
  // A late project focus handoff can dismiss a menu just opened by the fixture.
  // Reopen a dismissed menu and require its real popup before choosing an item.
  const trigger = page.getByRole('button', {
    name: 'Workspace settings',
    exact: true,
  });
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true')
      await trigger.click({ timeout: 1000 });
    await expect(
      page.getByRole('menu', { name: 'Workspace settings', exact: true }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
}

export async function openWorkspaceGroup(page: Page, name: string) {
  await openWorkspaceSettings(page);
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
