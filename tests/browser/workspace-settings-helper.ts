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

export async function openAISettings(page: Page) {
  await waitForWorkspaceSettings(page);
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

export async function addOpenRouter(page: Page) {
  const dialog = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await dialog.getByRole('tab', { name: 'Providers', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Add provider', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Provider type', exact: true })
    .click();
  await page.getByRole('option', { name: 'OpenRouter', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('');
  await page
    .getByRole('button', { name: 'Add OpenRouter account', exact: true })
    .click();
}

export async function prepareOpenRouterKey(page: Page) {
  const dialog = page.getByRole('dialog', {
    name: 'AI connection',
    exact: true,
  });
  await dialog.getByRole('tab', { name: 'Providers', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Add provider', exact: true }),
  ).toBeVisible();
  if (
    (await dialog
      .getByRole('button', { name: 'Disconnect OpenRouter', exact: true })
      .count()) === 0
  )
    await addOpenRouter(page);
  await dialog
    .getByRole('group', { name: 'OpenRouter connection', exact: true })
    .getByRole('button', { name: 'I have an API key', exact: true })
    .click();
  await expect(
    dialog.getByLabel('OpenRouter API key', { exact: true }),
  ).toBeVisible();
}

export async function selectAISettingsTab(
  page: Page,
  name: 'Providers' | 'LLM - Chat' | 'TTS - Speech' | 'STT - Transcription',
) {
  await page
    .getByRole('dialog', { name: 'AI connection', exact: true })
    .getByRole('tab', { name, exact: true })
    .click();
}
