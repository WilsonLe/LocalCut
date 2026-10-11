import { expect, test } from '@playwright/test';

// System clipboard is shared by Chrome contexts; keep these assertions serial.
test.describe.configure({ mode: 'serial' });

for (const base of ['/', '/LocalCut/']) {
  test(`error stack trace and persistent notification history ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(base);
    const bell = page.getByRole('button', { name: /^Notifications/ });
    await expect(bell.locator('[data-notification-unread]')).toHaveCount(0);
    await bell.click();
    const log = page.getByRole('dialog', {
      name: 'Notifications',
      exact: true,
    });
    await expect(log).toContainText('No notifications yet.');
    await log.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(bell).toBeFocused();
    const id = await page.evaluate(async (base) => {
      const { createEditor } = await import(base + 'editor.js');
      const editor = await createEditor({ namespace: 'localcut' });
      try {
        return (await editor.projects.create('Diagnostic session')).id;
      } finally {
        await editor.dispose();
      }
    }, base);
    await page.goto(`${base}#/project/${id}`);
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Diagnostic session');
    await page.route('**/build-info.json?*', (route) =>
      route.fulfill({ status: 500, body: 'private provider body' }),
    );
    await page
      .getByRole('button', { name: 'Check for update', exact: true })
      .click();
    const toast = page.locator('[data-sonner-toast][data-type="error"]').last();
    await expect(toast).toContainText('Could not check for updates');
    await expect(bell.locator('[data-notification-unread]')).toBeVisible();
    await toast
      .getByRole('button', { name: 'View stack trace', exact: true })
      .click();
    const details = page.getByRole('dialog', {
      name: 'Error details',
      exact: true,
    });
    const report = details.getByLabel('Full error report');
    await expect(report).toContainText('Error: Build information unavailable');
    await expect(report).toContainText(id);
    await expect(report).toContainText('playheadUs');
    await expect(report).toContainText('revision');
    await expect(report).not.toContainText('private provider body');
    const fullText = await report.textContent();
    await details
      .getByRole('button', { name: 'Copy error details', exact: true })
      .click();
    await expect(
      details
        .getByRole('button', { name: 'Copied error details', exact: true })
        .locator('[data-copy-feedback="copied"]'),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      fullText,
    );
    await expect(
      details.getByRole('button', { name: 'Copy error details', exact: true }),
    ).toBeVisible();
    await page.evaluate(() =>
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async () => {
          throw new Error('Clipboard denied');
        },
      }),
    );
    await details
      .getByRole('button', { name: 'Copy error details', exact: true })
      .click();
    await expect(details.getByRole('alert')).toContainText('Could not copy');
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    if (await toast.isVisible())
      await toast.getByRole('button', { name: /Close toast/ }).click();
    await expect(toast).toHaveCount(0);
    await bell.click();
    await expect(log).toContainText('Could not check for updates');
    await expect(bell.locator('[data-notification-unread]')).toHaveCount(0);
    await log.getByRole('button', { name: /^View stack trace:/ }).click();
    await expect(report).toHaveText(fullText!);
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(bell).toBeFocused();
    await page.reload();
    await bell.click();
    await expect(log).toContainText('Could not check for updates');
    await log.getByRole('button', { name: /^View stack trace:/ }).click();
    await expect(report).toHaveText(fullText!);
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    await page.unroute('**/build-info.json?*');
    await page
      .getByRole('button', { name: 'Check for update', exact: true })
      .click();
    await expect(
      page.locator('[data-sonner-toast][data-type="success"]'),
    ).toContainText('LocalCut is up to date');
    await expect(bell.locator('[data-notification-unread]')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await bell.click();
    await expect(log).toContainText('LocalCut is up to date');
    const bounds = (await log.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath('notification-history-mobile.png'),
    });
    await log.getByRole('button', { name: /^View stack trace:/ }).click();
    await expect(report).toHaveText(fullText!);
    await page.screenshot({
      path: testInfo.outputPath('error-details-mobile.png'),
    });
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    await bell.click();
    await log
      .getByRole('button', { name: 'Clear history', exact: true })
      .click();
    await expect(log).toContainText('No notifications yet.');
    await page.reload();
    await bell.click();
    await expect(log).toContainText('No notifications yet.');
  });
  test(`notification history recovers denied storage and synchronizes tabs ${base}`, async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      let blocked = true;
      Storage.prototype.setItem = function (key, value) {
        if (blocked && key === 'localcut.notifications.v1')
          throw new DOMException('Storage denied', 'QuotaExceededError');
        original.call(this, key, value);
      };
      Object.defineProperty(window, 'allowNotificationStorage', {
        value: () => {
          blocked = false;
        },
      });
    });
    await page.goto(base);
    await page.route('**/build-info.json?*', (route) =>
      route.fulfill({ status: 500, body: 'Private body' }),
    );
    await page
      .getByRole('button', { name: 'Check for update', exact: true })
      .click();
    const bell = page.getByRole('button', { name: /^Notifications/ });
    await expect(bell.locator('[data-notification-unread]')).toBeVisible();
    await bell.click();
    const log = page.getByRole('dialog', {
      name: 'Notifications',
      exact: true,
    });
    await expect(log.getByRole('alert')).toContainText('could not be saved');
    await log.getByRole('button', { name: /^View stack trace:/ }).click();
    const details = page.getByRole('dialog', {
      name: 'Error details',
      exact: true,
    });
    await expect(details.getByLabel('Full error report')).toContainText(
      'Build information unavailable',
    );
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    await bell.click();
    await page.evaluate(() =>
      (
        window as unknown as { allowNotificationStorage(): void }
      ).allowNotificationStorage(),
    );
    await log
      .getByRole('button', { name: 'Retry saving', exact: true })
      .click();
    await expect(log.getByRole('alert')).toHaveCount(0);
    await log.getByRole('button', { name: 'Close', exact: true }).click();
    const other = await context.newPage();
    await other.goto(base);
    const otherBell = other.getByRole('button', { name: /^Notifications/ });
    await otherBell.click();
    const otherLog = other.getByRole('dialog', {
      name: 'Notifications',
      exact: true,
    });
    await expect(otherLog).toContainText('Could not check for updates');
    await otherLog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.unroute('**/build-info.json?*');
    await page
      .getByRole('button', { name: 'Check for update', exact: true })
      .click();
    await expect(otherBell.locator('[data-notification-unread]')).toBeVisible();
    await otherBell.click();
    await expect(otherLog).toContainText('LocalCut is up to date');
    await expect(bell.locator('[data-notification-unread]')).toHaveCount(0);
    await otherLog
      .getByRole('button', { name: 'Clear history', exact: true })
      .click();
    await bell.click();
    await expect(log).toContainText('No notifications yet.');
    await other.close();
  });
}
