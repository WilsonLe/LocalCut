import { dismissNotifications } from './workspace-notifications-helper';
import { expect, test } from '@playwright/test';

// System clipboard is shared by Chrome contexts; keep these assertions serial.
test.describe.configure({ mode: 'serial' });

for (const base of ['/', '/LocalCut/']) {
  test(`notification history table paginates and scrolls columns ${base}`, async ({
    page,
    context,
  }, testInfo) => {
    const entries = Array.from({ length: 81 }, (_, index) => ({
      id: `table-${index}`,
      type: index === 80 ? 'error' : 'info',
      message: `Notification ${index}`,
      description: 'Background activity',
      createdAt: 1800000000000 - index,
      updatedAt: 1800000000000 - index,
      read: false,
      ...(index === 80
        ? {
            report: {
              summary: 'Saved error',
              text: 'Saved error\nError: test report',
            },
          }
        : {}),
    }));
    await page.addInitScript((entries) => {
      localStorage.setItem(
        'localcut.notifications.v1',
        JSON.stringify({ version: 1, entries }),
      );
    }, entries);
    if (base === '/LocalCut/')
      await page.addInitScript(() =>
        localStorage.setItem(
          'localcut.appearance.v1',
          JSON.stringify({
            version: 1,
            preferences: { mode: 'dark', base: 'slate' },
          }),
        ),
      );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base);
    const bell = page.getByRole('button', { name: /^Notifications/ });
    await bell.click();
    const log = page.getByRole('dialog', {
      name: 'Notifications',
      exact: true,
    });
    const rows = log.getByRole('row', { name: /^Notification \d/ });
    const pages = log.getByRole('navigation', { name: 'Notifications pages' });
    const region = log.getByRole('region', { name: 'Notifications columns' });
    await expect(
      log.getByRole('table', { name: 'Saved notifications' }),
    ).toBeVisible();
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toHaveAttribute('aria-label', 'Notification 0');
    await expect(pages.locator('[aria-current="page"]')).toHaveText('1');
    await expect(pages.getByText('More pages')).toHaveCount(1);
    await pages
      .getByRole('button', { name: 'Go to page 2', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(rows.first()).toHaveAttribute('aria-label', 'Notification 10');
    await pages.getByRole('button', { name: 'Go to next page' }).click();
    await pages
      .getByRole('button', { name: 'Go to page 4', exact: true })
      .click();
    await pages
      .getByRole('button', { name: 'Go to page 5', exact: true })
      .click();
    await expect(pages.getByText('More pages')).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute('aria-label', 'Notification 40');
    await page.screenshot({
      path: testInfo.outputPath('notification-table-desktop.png'),
    });
    await page.setViewportSize({ width: 320, height: 480 });
    await expect(
      page.getByRole('navigation', { name: 'Workspace sections' }),
    ).toBeVisible();
    // The responsive header remounts its dialog trigger at the mobile boundary.
    if (!(await log.isVisible())) await bell.click();
    await pages
      .getByRole('button', { name: 'Go to page 2', exact: true })
      .click();
    await pages.getByRole('button', { name: 'Go to next page' }).click();
    await pages.getByRole('button', { name: 'Go to next page' }).click();
    await pages.getByRole('button', { name: 'Go to next page' }).click();
    const right = log.getByRole('button', { name: 'Scroll one column right' });
    const left = log.getByRole('button', { name: 'Scroll one column left' });
    const position = () => region.evaluate((element) => element.scrollLeft);
    await expect(right).toBeVisible();
    await expect(left).toHaveCount(0);
    await expect(right).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(right.locator('..')).toHaveCSS(
      'background-image',
      /linear-gradient/,
    );
    const boundary = await region.evaluate((element) => {
      const table = element.querySelector('table')!;
      const scale = element.clientWidth / element.getBoundingClientRect().width;
      return (
        (table.querySelectorAll('th')[1]!.getBoundingClientRect().left -
          table.getBoundingClientRect().left) *
        scale
      );
    });
    await right.click();
    await expect.poll(position).toBeCloseTo(boundary, 0);
    await left.click();
    await expect.poll(position).toBe(0);
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(position).toBeGreaterThan(0);
    const bounds = (await pages.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(480);
    // Retain the workspace's 44 px mobile targets within at most two rows.
    expect(bounds.height).toBeLessThanOrEqual(90);
    await page.screenshot({
      path: testInfo.outputPath('notification-table-mobile.png'),
    });
    await pages
      .getByRole('button', { name: 'Go to page 9', exact: true })
      .click();
    await expect(rows).toHaveCount(1);
    await expect(
      pages.getByRole('button', { name: 'Go to next page' }),
    ).toHaveCount(0);
    await log
      .getByRole('button', { name: 'View stack trace: Notification 80' })
      .click();
    const details = page.getByRole('dialog', {
      name: 'Error details',
      exact: true,
    });
    await expect(details.getByLabel('Full error report')).toContainText(
      'Error: test report',
    );
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    await bell.click();
    await expect(pages.locator('[aria-current="page"]')).toHaveText('1');
    await pages
      .getByRole('button', { name: 'Go to page 9', exact: true })
      .click();
    const other = await context.newPage();
    await other.goto(base);
    await other.evaluate(
      (entries) =>
        localStorage.setItem(
          'localcut.notifications.v1',
          JSON.stringify({ version: 1, entries }),
        ),
      entries.slice(0, 11),
    );
    await expect(pages.locator('[aria-current="page"]')).toHaveText('2');
    await expect(rows).toHaveCount(1);
    await other.evaluate(
      (entries) =>
        localStorage.setItem(
          'localcut.notifications.v1',
          JSON.stringify({ version: 1, entries }),
        ),
      entries,
    );
    await expect(rows).toHaveCount(10);
    await expect(pages.locator('[aria-current="page"]')).toHaveText('2');
    await log
      .getByRole('button', { name: 'Clear history', exact: true })
      .click();
    await expect(log).toContainText('No notifications yet.');
    await expect(pages).toHaveCount(0);
    await other.close();
  });

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
    await dismissNotifications(page);
    await expect(toast).toHaveCount(0);
    await bell.click();
    await expect(log).toContainText('Could not check for updates');
    await expect(bell.locator('[data-notification-unread]')).toHaveCount(0);
    await log.getByRole('button', { name: /^View stack trace:/ }).click();
    await expect(report).toHaveText(fullText!);
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(bell).toBeFocused();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Open project', exact: true }),
    ).toContainText('Diagnostic session');
    await expect(
      page.getByRole('button', { name: 'Undo', exact: true }),
    ).toBeVisible();
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
      navigator.locks.request('localcut.notifications.v1', () => {}),
    );
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
  test(`concurrent notification reports survive a shared write lock ${base}`, async ({
    page,
    context,
  }) => {
    const other = await context.newPage();
    await Promise.all([page.goto(base), other.goto(base)]);
    await Promise.all([
      page.route('**/build-info.json?*', (route) =>
        route.fulfill({ status: 500, body: 'Private body' }),
      ),
      other.route('**/build-info.json?*', (route) =>
        route.fulfill({ status: 500, body: 'Private body' }),
      ),
    ]);
    await page.evaluate(async () => {
      let ready!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.defineProperty(window, 'releaseNotificationWriteLock', {
        value: release,
      });
      void navigator.locks.request('localcut.notifications.v1', async () => {
        ready();
        await held;
      });
      await started;
    });
    await Promise.all([
      page
        .getByRole('button', { name: 'Check for update', exact: true })
        .click(),
      other
        .getByRole('button', { name: 'Check for update', exact: true })
        .click(),
    ]);
    await expect(
      page.locator('[data-sonner-toast][data-type="error"]'),
    ).toBeVisible();
    await expect(
      other.locator('[data-sonner-toast][data-type="error"]'),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem('localcut.notifications.v1'),
      ),
    ).toBeNull();
    await page.evaluate(() =>
      (
        window as unknown as { releaseNotificationWriteLock(): void }
      ).releaseNotificationWriteLock(),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem('localcut.notifications.v1') ??
                '{"entries":[]}',
            ).entries.length,
        ),
      )
      .toBe(2);
    const records = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('localcut.notifications.v1')!)
          .entries as { report: { text: string } }[],
    );
    expect(
      records.every((entry) =>
        entry.report.text.includes('Build information unavailable'),
      ),
    ).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const log = page.getByRole('dialog', {
      name: 'Notifications',
      exact: true,
    });
    await expect(
      log.getByRole('button', { name: /^View stack trace:/ }),
    ).toHaveCount(2);
    await other.close();
  });
}
