import { defineConfig } from '@playwright/test';
const requestedWorkers = process.env.LOCALCUT_BROWSER_WORKERS ?? '2';
if (!/^[1-4]$/.test(requestedWorkers))
  throw new Error('LOCALCUT_BROWSER_WORKERS must be an integer from 1 to 4.');
const browserWorkers = Number(requestedWorkers);
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 120000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  workers: browserWorkers,
  projects: [
    {
      name: 'chrome',
      testIgnore: ['**/transcription.spec.ts', '**/performance.spec.ts'],
      workers: browserWorkers,
    },
    {
      name: 'acceptance',
      default: false,
      testMatch: ['**/transcription.spec.ts', '**/performance.spec.ts'],
      fullyParallel: false,
      workers: 1,
    },
  ],
  retries: 0,
  maxFailures: process.env.CI ? 1 : undefined,
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
