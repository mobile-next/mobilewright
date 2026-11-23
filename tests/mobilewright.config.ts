import { defineConfig } from '@playwright/test';

const SCREENSHOT_FROM_CONFIG_TEST = 'packages/test/src/screenshot-option-from-config.test.ts';

export default defineConfig({
  testDir: '..',
  testMatch: 'packages/*/src/**/*.test.ts',
  timeout: 60_000,
  projects: [
    { name: 'unit', testIgnore: SCREENSHOT_FROM_CONFIG_TEST },
    // proves a `use` value from the config reaches mobilewright's screenshot fixture
    { name: 'screenshot-from-config', testMatch: SCREENSHOT_FROM_CONFIG_TEST, use: { screenshot: 'on' } },
  ],
});
