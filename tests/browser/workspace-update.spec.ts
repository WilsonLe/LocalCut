import { behaviorBases } from './coverage-bases';
import { expect, test } from '@playwright/test';

for (const base of behaviorBases) {
  test(`browser-managed updates keep headers clear and preserve projects on reload ${base}`, async ({
    page,
  }, testInfo) => {
    const updateRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/build-info.json'))
        updateRequests.push(request.url());
    });
    const assertHeader = async () => {
      await expect(
        page.getByRole('button', { name: 'Workspace settings', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Commands', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Check for update', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('dialog', { name: 'Update available', exact: true }),
      ).toHaveCount(0);
      expect(updateRequests).toEqual([]);
    };
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await assertHeader();
    const projectId = await page.evaluate(async (base) => {
      const { createEditor } = await import(`${base}editor.js`);
      const editor = await createEditor({ namespace: 'localcut' });
      try {
        return (await editor.projects.create('Keep through refresh')).id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${projectId}`);
    const project = page.getByRole('button', {
      name: 'Open project',
      exact: true,
    });
    await expect(project).toContainText('Keep through refresh');
    await assertHeader();
    await page.screenshot({ path: testInfo.outputPath('header-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertHeader();
    const tabs = page.getByRole('navigation', { name: 'Workspace sections' });
    for (const name of ['Chat', 'Expand media', 'Edit']) {
      await tabs.getByRole('button', { name, exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Check for update', exact: true }),
      ).toHaveCount(0);
    }
    await assertHeader();
    await page.screenshot({ path: testInfo.outputPath('header-mobile.png') });
    await page.reload();
    await expect(project).toContainText('Keep through refresh');
    await expect(page).toHaveURL(new RegExp(`#/project/${projectId}$`));
    await assertHeader();
  });
}
