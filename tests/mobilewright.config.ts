import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '..',
  testMatch: 'packages/*/src/**/*.test.ts',
  timeout: 60_000,
});
