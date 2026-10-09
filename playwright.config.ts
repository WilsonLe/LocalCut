import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 120000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${process.env.LOCALCUT_TEST_PORT ?? 4178}`,
    channel: 'chrome',
    launchOptions: { executablePath: process.env.LOCALCUT_CHROME_EXECUTABLE },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: `http://127.0.0.1:${process.env.LOCALCUT_TEST_PORT ?? 4178}/health`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
