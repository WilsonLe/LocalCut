import { defineConfig } from '@playwright/test';
import config from './playwright.config';

/** Opt-in paid-provider verification. Never record secrets, prompts, or responses. */
export default defineConfig({
  ...config,
  testDir: 'tests/live',
  timeout: 180000,
  reporter: [['list']],
  outputDir: 'test-results/ai-live',
  use: {
    ...config.use,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
