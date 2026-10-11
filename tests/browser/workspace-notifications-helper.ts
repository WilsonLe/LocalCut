import { expect, type Page } from '@playwright/test';

export async function dismissNotifications(page: Page) {
  // Toasts may expire or reindex while their closing animation is running.
  // Re-resolve the first real Close control, then assert the stack is empty.
  await expect(async () => {
    const close = page.getByRole('button', {
      name: 'Close toast',
      exact: true,
    });
    if (await close.count()) await close.first().click({ timeout: 1000 });
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, {
      timeout: 1000,
    });
  }).toPass({ timeout: 10000 });
}
