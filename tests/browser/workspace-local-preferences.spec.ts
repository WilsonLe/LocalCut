import { test, expect } from '@playwright/test';
import { behaviorBases } from './coverage-bases';
import { settingsJourney } from './workspace-settings-journey';

for (const base of behaviorBases) {
  test(`local workspace settings retain grouped keyboard navigation ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    await settingsJourney(page, base);
  });
  test(`local preferences keep session editing usable when storage is denied ${base}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem,
        set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key === 'localcut.workspace-preferences.v1')
          throw new DOMException('Denied preferences', 'SecurityError');
        return get.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === 'localcut.workspace-preferences.v1')
          throw new DOMException('Full preferences', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    await page.goto(base);
    await expect(
      page.getByRole('main', { name: 'Video editor' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Expand media', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Collapse media', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Project media' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Collapse media', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Expand media', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Workspace preferences could not be saved. Allow browser storage to keep them after reload.',
        { exact: true },
      ),
    ).toBeVisible();
  });
}
