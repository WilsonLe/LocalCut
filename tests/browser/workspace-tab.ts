import type { BrowserContext, Page } from '@playwright/test';

// Fixture contexts belong to one journey. Reuse their idle secondary page;
// Playwright closes the whole context (including failure paths) on teardown.
export async function secondaryTab(context: BrowserContext, primary: Page) {
  return (
    context.pages().find((page) => page !== primary && !page.isClosed()) ??
    (await context.newPage())
  );
}
